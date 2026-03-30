// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts-upgradeable/token/ERC1155/ERC1155Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC1155/extensions/ERC1155SupplyUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "./ISocietyBadgeHook.sol";

/// @title Society Protocol Badges
/// @notice Manages badges and user profiles for the Society Protocol
/// @dev Implements ERC1155 with AccessControl, UUPS Upgradeability, and custom hooks
contract SocietyProtocolBadges is
    Initializable,
    ERC1155Upgradeable,
    AccessControlUpgradeable,
    ERC1155SupplyUpgradeable,
    UUPSUpgradeable,
    EIP712Upgradeable
{
    bytes32 public constant OFFICIAL_BADGE_CREATOR_ROLE =
        keccak256("OFFICIAL_BADGE_CREATOR_ROLE");
    bytes32 public constant CONTRACT_UPGRADER_ROLE =
        keccak256("CONTRACT_UPGRADER_ROLE");

    uint256 public constant PERM_SELF = 1;
    uint256 public constant PERM_EVERYONE = 2;
    uint256 public constant STARTING_BADGE_ID = 10;

    bytes32 private constant INVITE_TYPEHASH =
        keccak256("Invite(address inviter,string message)");

    mapping(address => address) public invitedBy;

    struct BadgeInfo {
        string name;
        address hook;
        bool isOfficial;
        bool isCommunity;
        string metadataURI;
    }

    mapping(uint256 => BadgeInfo) public badges;

    // badgeId => allowedBadgeIds to mint
    mapping(uint256 => uint256[]) public canMint;
    // badgeId => allowedBadgeIds to transfer
    mapping(uint256 => uint256[]) public canTransfer;
    // badgeId => allowedBadgeIds to burn
    mapping(uint256 => uint256[]) public canBurn;

    // badgeId => editor => isAllowed
    mapping(uint256 => mapping(address => bool)) public canEdit;

    // user => profileBadgeId
    mapping(address => uint256) public profileBadgeId;



    uint256 public nextTokenId;

    event BadgeCreated(
        uint256 indexed id,
        string name,
        bool isOfficial,
        bool isCommunity,
        address indexed creator
    );
    event BadgeModified(
        uint256 indexed id,
        string name,
        bool isOfficial,
        bool isCommunity,
        string metadataURI
    );
    event EditorsUpdated(
        uint256 indexed id,
        address indexed editor,
        bool isAllowed
    );
    event BadgePermissions(
        uint256 indexed id,
        uint256[] minters,
        uint256[] transferers,
        uint256[] burners,
        address[] editors
    );
    event HookUpdated(uint256 indexed id, address indexed hook);
    event ProfileCreated(address indexed user, uint256 indexed id);
    event UserInvited(address indexed user, address indexed inviter);

    // Custom Errors
    error Unauthorized();
    error BadgeDoesNotExist();
    error NotProfileOwner();
    error ProfileAlreadyExists();
    error MintDeniedByHook();
    error TransferDeniedByHook();
    error BurnDeniedByHook();
    error MintNotAuthorized();
    error TransferNotAuthorized();
    error BurnNotAuthorized();
    error AlreadyInvited();
    error InvalidSignature();
    error SelfInvitation();
    error CircularInvitation();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize() public initializer {
        __ERC1155_init("");
        __AccessControl_init();
        __ERC1155Supply_init();
        __UUPSUpgradeable_init();
        __EIP712_init("SocietyProtocol", "1");

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(CONTRACT_UPGRADER_ROLE, msg.sender);
        _grantRole(OFFICIAL_BADGE_CREATOR_ROLE, msg.sender);

        nextTokenId = STARTING_BADGE_ID;
    }

    /// @notice Creates a new badge
    /// @dev Open to anyone; official badges additionally require OFFICIAL_BADGE_CREATOR_ROLE
    function createBadge(
        string memory name,
        bool isOfficial,
        bool isCommunity,
        address hook,
        string memory metadataURI,
        uint256[] memory minters,
        uint256[] memory transferers,
        uint256[] memory burners,
        address[] memory editors
    ) external returns (uint256) {
        if (isOfficial) {
            // Check for OFFICIAL_BADGE_CREATOR_ROLE
            if (!hasRole(OFFICIAL_BADGE_CREATOR_ROLE, msg.sender)) {
                revert AccessControlUnauthorizedAccount(
                    msg.sender,
                    OFFICIAL_BADGE_CREATOR_ROLE
                );
            }
        }
        // Anyone can create a badge
        return
            _createBadge(
                name,
                isOfficial,
                isCommunity,
                hook,
                metadataURI,
                minters,
                transferers,
                burners,
                editors
            );
    }

    /// @notice Creates a unique profile badge for the caller
    /// @dev One profile per address
    function createProfile(
        string memory metadataURI
    ) external returns (uint256) {
        if (profileBadgeId[msg.sender] != 0) revert ProfileAlreadyExists();

        uint256[] memory empty = new uint256[](0);
        address[] memory editors = new address[](1);
        editors[0] = msg.sender;

        // Create the badge type
        uint256 pid = _createBadge(
            "Profile",
            false,
            false,
            address(0),
            metadataURI,
            empty,
            empty,
            empty,
            editors
        );

        canMint[pid].push(PERM_SELF);
        _mint(msg.sender, pid, 1, "");
        canMint[pid].pop();

        profileBadgeId[msg.sender] = pid;
        emit ProfileCreated(msg.sender, pid);
        return pid;
    }

    function _createBadge(
        string memory name,
        bool isOfficial,
        bool isCommunity,
        address hook,
        string memory metadataURI,
        uint256[] memory minters,
        uint256[] memory transferers,
        uint256[] memory burners,
        address[] memory editors
    ) internal returns (uint256) {
        nextTokenId++;
        uint256 id = nextTokenId;

        badges[id] = BadgeInfo({
            name: name,
            hook: hook,
            isOfficial: isOfficial,
            isCommunity: isCommunity,
            metadataURI: metadataURI
        });

        if (hook != address(0)) {
            emit HookUpdated(id, hook);
        }

        canMint[id] = minters;
        canTransfer[id] = transferers;
        canBurn[id] = burners;

        // Setup editors
        for (uint256 i = 0; i < editors.length; i++) {
            canEdit[id][editors[i]] = true;
            emit EditorsUpdated(id, editors[i], true);
        }

        emit BadgeCreated(id, name, isOfficial, isCommunity, msg.sender);
        emit BadgePermissions(id, minters, transferers, burners, editors);
        return id;
    }

    /// @notice Sets a hook contract for a specific badge
    /// @dev Only callable by badge editors (canEdit[id][msg.sender])
    function setBadgeHook(uint256 id, address hook) external {
        if (!canEdit[id][msg.sender]) revert Unauthorized();
        badges[id].hook = hook;
        emit HookUpdated(id, hook);
    }

    /// @notice Modifies an existing badge
    /// @dev Callable by badge editors; toggling isOfficial additionally requires OFFICIAL_BADGE_CREATOR_ROLE
    function modifyBadge(
        uint256 id,
        string memory name,
        bool isOfficial,
        bool isCommunity,
        string memory metadataURI
    ) external {
        if (id > nextTokenId) revert BadgeDoesNotExist();

        // Check edit permission
        if (!canEdit[id][msg.sender]) revert Unauthorized();

        BadgeInfo storage badge = badges[id];

        // Check for official badge status toggling
        // Only OFFICIAL_BADGE_CREATOR_ROLE can change isOfficial status (promotion or demotion)
        if (isOfficial != badge.isOfficial) {
            if (!hasRole(OFFICIAL_BADGE_CREATOR_ROLE, msg.sender)) {
                revert AccessControlUnauthorizedAccount(
                    msg.sender,
                    OFFICIAL_BADGE_CREATOR_ROLE
                );
            }
        }

        badge.name = name;
        badge.isOfficial = isOfficial;
        badge.isCommunity = isCommunity;
        badge.metadataURI = metadataURI;

        emit BadgeModified(id, name, isOfficial, isCommunity, metadataURI);
        emit URI(metadataURI, id);
    }

    function mint(
        address to,
        uint256 id,
        uint256 amount,
        bytes memory data
    ) public {
        if (id > nextTokenId) revert BadgeDoesNotExist();
        // Permission check is done in _update
        _mint(to, id, amount, data);
    }

    /**
     * @notice Mints multiple badges to a single recipient
     * @param to The recipient address
     * @param ids Array of badge IDs to mint
     * @param amounts Array of amounts for each badge ID
     * @param data Additional data for the minting operation
     */
    function mintBatch(
        address to,
        uint256[] memory ids,
        uint256[] memory amounts,
        bytes memory data
    ) public {
        for (uint256 i = 0; i < ids.length; i++) {
            if (ids[i] > nextTokenId) revert BadgeDoesNotExist();
        }
        // Permission check is done in _update
        _mintBatch(to, ids, amounts, data);
    }

    /**
     * @notice Overrides standard safeTransferFrom to allow transfers based on badge permissions
     * @dev Bypasses standard isApprovedForAll check. Security is enforced in _update hook.
     */
    function safeTransferFrom(
        address from,
        address to,
        uint256 id,
        uint256 value,
        bytes memory data
    ) public override {
        // We skip the standard approval check since we want our badge-based
        // permissions in _update to be the sole authority.
        _safeTransferFrom(from, to, id, value, data);
    }

    /**
     * @notice Overrides standard safeBatchTransferFrom to allow transfers based on badge permissions
     * @dev Bypasses standard isApprovedForAll check. Security is enforced in _update hook.
     */
    function safeBatchTransferFrom(
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory values,
        bytes memory data
    ) public override {
        // We skip the standard approval check since we want our badge-based
        // permissions in _update to be the sole authority.
        _safeBatchTransferFrom(from, to, ids, values, data);
    }

    /**
     * @notice Burns tokens from a specified address
     * @dev Bypasses standard isApprovedForAll check. Security is enforced in _update hook.
     * @param from The address to burn from
     * @param id The badge ID to burn
     * @param value The amount to burn
     */
    function burn(address from, uint256 id, uint256 value) public {
        if (id > nextTokenId) revert BadgeDoesNotExist();
        _burn(from, id, value);
    }

    /**
     * @notice Burns multiple badges from a specified address
     * @dev Bypasses standard isApprovedForAll check. Security is enforced in _update hook.
     * @param from The address to burn from
     * @param ids Array of badge IDs to burn
     * @param values Array of amounts to burn for each badge ID
     */
    function burnBatch(
        address from,
        uint256[] memory ids,
        uint256[] memory values
    ) public {
        for (uint256 i = 0; i < ids.length; i++) {
            if (ids[i] > nextTokenId) revert BadgeDoesNotExist();
        }
        _burnBatch(from, ids, values);
    }

    /**
     * @notice Mints a single badge to multiple recipients
     * @param to Array of recipient addresses
     * @param id The badge ID to mint
     * @param amount The amount to mint for each recipient
     * @param data Additional data for the minting operation
     */
    function mintToMultiple(
        address[] memory to,
        uint256 id,
        uint256 amount,
        bytes memory data
    ) public {
        if (id > nextTokenId) revert BadgeDoesNotExist();
        for (uint256 i = 0; i < to.length; i++) {
            // Permission check is done in _update for each mint
            _mint(to[i], id, amount, data);
        }
    }

    /// @notice Updates the metadata URI for a badge
    /// @dev Only callable by editors
    function setURI(uint256 id, string memory newUri) external {
        if (!canEdit[id][msg.sender]) revert Unauthorized();
        badges[id].metadataURI = newUri;
        emit URI(newUri, id);
    }

    /// @notice Updates the metadata URI for a user's profile
    /// @dev Only callable by the profile owner
    function updateProfileURI(uint256 id, string memory newUri) external {
        // Allow update if sender owns the token and it's a unique NFT (Profile)
        if (totalSupply(id) != 1 || balanceOf(msg.sender, id) != 1)
            revert NotProfileOwner();

        badges[id].metadataURI = newUri;
        emit URI(newUri, id);
    }

    function uri(uint256 id) public view override returns (string memory) {
        return badges[id].metadataURI;
    }

    function balanceOf(
        address account,
        uint256 id
    ) public view override returns (uint256) {
        address hook = badges[id].hook;
        if (hook != address(0)) {
            return ISocietyBadgeHook(hook).onBalanceOf(account, id);
        }
        return super.balanceOf(account, id);
    }

    function balanceOfBatch(
        address[] memory accounts,
        uint256[] memory ids
    ) public view override returns (uint256[] memory) {
        uint256[] memory batchBalances = new uint256[](accounts.length);
        for (uint256 i = 0; i < accounts.length; ++i) {
            batchBalances[i] = balanceOf(accounts[i], ids[i]);
        }
        return batchBalances;
    }

    /// @notice Returns the list of badges required to mint the given badgeId
    function getBadgeMinters(
        uint256 id
    ) external view returns (uint256[] memory) {
        return canMint[id];
    }

    /// @notice Returns the list of badges required to transfer the given badgeId
    function getBadgeTransferers(
        uint256 id
    ) external view returns (uint256[] memory) {
        return canTransfer[id];
    }

    /**
     * @notice Accepts an invitation from another user
     * @param inviter The address that issued the invite
     * @param message The message that was signed
     * @param signature The EIP-712 signature from the inviter
     */
    function acceptInvite(
        address inviter,
        string calldata message,
        bytes calldata signature
    ) external {
        if (invitedBy[msg.sender] != address(0)) revert AlreadyInvited();
        if (inviter == msg.sender) revert SelfInvitation();
        if (invitedBy[inviter] == msg.sender) revert CircularInvitation();

        bytes memory msgBytes = bytes(message);
        uint256 len = msgBytes.length;
        if (len < 42) revert InvalidSignature();

        bytes memory addressBytes = new bytes(42);
        for (uint256 i = 0; i < 42; i++) {
            addressBytes[i] = msgBytes[len - 42 + i];
        }

        if (
            keccak256(addressBytes) !=
            keccak256(bytes(Strings.toHexString(msg.sender)))
        ) {
            revert InvalidSignature();
        }

        bytes32 structHash = keccak256(
            abi.encode(INVITE_TYPEHASH, inviter, keccak256(bytes(message)))
        );
        bytes32 hash = _hashTypedDataV4(structHash);

        if (!SignatureChecker.isValidSignatureNow(inviter, hash, signature)) {
            // Try matching against EthSignedMessageHash (personal_sign)
            bytes32 ethSignedHash = MessageHashUtils.toEthSignedMessageHash(
                bytes(message)
            );
            if (
                !SignatureChecker.isValidSignatureNow(
                    inviter,
                    ethSignedHash,
                    signature
                )
            ) {
                revert InvalidSignature();
            }
        }

        invitedBy[msg.sender] = inviter;
        emit UserInvited(msg.sender, inviter);
    }

    /// @notice Returns the list of badges required to burn the given badgeId
    function getBadgeBurners(
        uint256 id
    ) external view returns (uint256[] memory) {
        return canBurn[id];
    }



    function _update(
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory values
    ) internal override(ERC1155Upgradeable, ERC1155SupplyUpgradeable) {
        for (uint256 i = 0; i < ids.length; i++) {
            uint256 id = ids[i];
            address hook = badges[id].hook;

            if (hook != address(0)) {
                // Hook has priority
                if (from == address(0)) {
                    if (
                        !ISocietyBadgeHook(hook).onCheckMint(
                            msg.sender,
                            to,
                            id,
                            values[i]
                        )
                    ) revert MintDeniedByHook();
                } else if (to == address(0)) {
                    if (
                        !ISocietyBadgeHook(hook).onCheckBurn(
                            msg.sender,
                            from,
                            id,
                            values[i]
                        )
                    ) revert BurnDeniedByHook();
                } else {
                    if (
                        !ISocietyBadgeHook(hook).onCheckTransfer(
                            msg.sender,
                            from,
                            to,
                            id,
                            values[i]
                        )
                    ) revert TransferDeniedByHook();
                }
            } else {
                // Fallback to badge-based permission logic
                uint256[] storage rules;
                if (from == address(0)) {
                    rules = canMint[id];
                } else if (to == address(0)) {
                    rules = canBurn[id];
                } else {
                    rules = canTransfer[id];
                }

                bool allowed = false;
                for (uint256 j = 0; j < rules.length; j++) {
                    uint256 rule = rules[j];

                    if (rule == PERM_EVERYONE) {
                        allowed = true;
                        break;
                    }
                    if (rule == PERM_SELF) {
                        if (from == address(0)) {
                            if (to == msg.sender) {
                                allowed = true;
                                break;
                            }
                        } else {
                            if (from == msg.sender) {
                                allowed = true;
                                break;
                            }
                        }
                    }
                    if (rule >= STARTING_BADGE_ID) {
                        if (balanceOf(msg.sender, rule) > 0) {
                            allowed = true;
                            break;
                        }
                    }
                }

                if (!allowed) {
                    if (from == address(0)) revert MintNotAuthorized();
                    else if (to == address(0)) revert BurnNotAuthorized();
                    else revert TransferNotAuthorized();
                }
            }
        }
        super._update(from, to, ids, values);
    }

    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyRole(CONTRACT_UPGRADER_ROLE) {}

    function supportsInterface(
        bytes4 interfaceId
    )
        public
        view
        override(ERC1155Upgradeable, AccessControlUpgradeable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
