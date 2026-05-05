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
    /// @notice Role required to create or modify "official" protocol badges.
    bytes32 public constant OFFICIAL_BADGE_CREATOR_ROLE =
        keccak256("OFFICIAL_BADGE_CREATOR_ROLE");
    /// @notice Role required to authorize contract upgrades.
    bytes32 public constant CONTRACT_UPGRADER_ROLE =
        keccak256("CONTRACT_UPGRADER_ROLE");
    /// @notice Role granted to CommunityRegistry, allowing it to create community badges and perform privileged mints.
    bytes32 public constant COMMUNITY_MANAGER_ROLE =
        keccak256("COMMUNITY_MANAGER_ROLE");

    /// @notice Permission type: Only the recipient can perform the action (e.g., self-minting).
    uint256 public constant PERM_SELF = 1;
    /// @notice Permission type: Anyone can perform the action.
    uint256 public constant PERM_EVERYONE = 2;
    /// @notice IDs up to and including this value are reserved. The first badge ID is STARTING_BADGE_ID + 1.
    uint256 public constant STARTING_BADGE_ID = 10;
    /// @notice Maximum number of rules allowed per permission array (canMint/canTransfer/canBurn).
    uint256 public constant MAX_PERMISSION_RULES = 10;

    /// @dev EIP-712 typehash for invitations.
    bytes32 private constant INVITE_TYPEHASH =
        keccak256("Invite(address inviter,string message)");

    /**
     * @notice Maps a user's address to the address of the person who invited them.
     * @dev Used for tracking the invitation graph and preventing circular/self invitations.
     */
    mapping(address => address) public invitedBy;

    /**
     * @dev Core information for a badge type.
     * @param name Human-readable name of the badge.
     * @param hook Optional address of a contract implementing ISocietyBadgeHook for dynamic logic.
     * @param isOfficial True if the badge is an official protocol-level badge.
     * @param isCommunity True if the badge has community-specific properties.
     * @param metadataURI The IPFS or HTTPS link to the badge's metadata.
     */
    struct BadgeInfo {
        string name;
        address hook;
        bool isOfficial;
        bool isCommunity;
        string metadataURI;
    }

    /// @notice Maps a badge ID to its detailed configuration.
    mapping(uint256 => BadgeInfo) public badges;

    /**
     * @notice Permissions for minting a badge.
     * @dev badgeId => uint256[] (array of required badge IDs or permission constants like PERM_EVERYONE).
     */
    mapping(uint256 => uint256[]) public canMint;
    /**
     * @notice Permissions for transferring a badge.
     * @dev badgeId => uint256[] (array of required badge IDs or permission constants like PERM_EVERYONE).
     */
    mapping(uint256 => uint256[]) public canTransfer;
    /**
     * @notice Permissions for burning a badge.
     * @dev badgeId => uint256[] (array of required badge IDs or permission constants like PERM_EVERYONE).
     */
    mapping(uint256 => uint256[]) public canBurn;

    /**
     * @notice Maps a badge ID and an address to whether that address has permission to edit the badge's settings.
     * @dev badgeId => editor => isAllowed.
     */
    mapping(uint256 => mapping(address => bool)) public canEdit;

    /**
     * @notice Maps a user's address to their unique profile badge ID.
     * @dev user => profileBadgeId. Each user can have only one profile badge.
     */
    mapping(address => uint256) public profileBadgeId;

    /// @notice True if the badge ID was created as a user profile badge.
    mapping(uint256 => bool) public isProfileBadge;

    /// @dev Per-badge mint mutex set during the ERC1155 callback window to block reentrant extra mints.
    mapping(uint256 => bool) private _profileMintLocked;

    /// @notice The most recently assigned badge ID. The next badge will receive nextTokenId + 1.
    uint256 public nextTokenId;

    /// @dev Returns true if the badge ID has been created.
    function _badgeExists(uint256 id) internal view returns (bool) {
        return id > STARTING_BADGE_ID && id <= nextTokenId;
    }

    /**
     * @notice Emitted when a new badge type is created.
     * @param id The unique ID assigned to the new badge.
     * @param name human-readable name of the badge.
     * @param isOfficial True if created as an official badge.
     * @param isCommunity True if created as a community badge.
     * @param creator The address that initiated the creation.
     */
    event BadgeCreated(
        uint256 indexed id,
        string name,
        bool isOfficial,
        bool isCommunity,
        address indexed creator
    );
    /**
     * @notice Emitted when an existing badge's metadata or status is updated.
     */
    event BadgeModified(
        uint256 indexed id,
        string name,
        bool isOfficial,
        bool isCommunity,
        string metadataURI
    );
    /**
     * @notice Emitted when an editor's permissions for a badge are updated.
     */
    event EditorsUpdated(
        uint256 indexed id,
        address indexed editor,
        bool isAllowed
    );
    /**
     * @notice Emitted to summarize the initial permissions assigned to a badge.
     */
    event BadgePermissions(
        uint256 indexed id,
        uint256[] minters,
        uint256[] transferers,
        uint256[] burners,
        address[] editors
    );
    /// @notice Emitted when the hook contract for a badge is changed.
    event HookUpdated(uint256 indexed id, address indexed hook);
    /// @notice Emitted when a user creates their unique profile badge.
    event ProfileCreated(address indexed user, uint256 indexed id);
    /// @notice Emitted when a user successfully accepts an invitation.
    event UserInvited(address indexed user, address indexed inviter);

    // --- Custom Errors ---
    /// @notice Generic unauthorized access error.
    error Unauthorized();
    /// @notice Attempted to interact with a badge that has not been created yet.
    error BadgeDoesNotExist();
    /// @notice Attempted to update a profile URI without ownership or if the badge isn't a profile.
    error NotProfileOwner();
    /// @notice User attempted to create a second profile badge.
    error ProfileAlreadyExists();
    /// @notice Attempted to mint more than one instance of a profile badge.
    error ProfileMustBeUnique();
    /// @notice The badge's hook contract denied the minting operation.
    error MintDeniedByHook();
    /// @notice The badge's hook contract denied the transfer operation.
    error TransferDeniedByHook();
    /// @notice The badge's hook contract denied the burning operation.
    error BurnDeniedByHook();
    /// @notice Standard credential-based minting permission check failed.
    error MintNotAuthorized();
    /// @notice Standard credential-based transfer permission check failed.
    error TransferNotAuthorized();
    /// @notice Standard credential-based burning permission check failed.
    error BurnNotAuthorized();
    /// @notice User has already been invited or accepted an invite.
    error AlreadyInvited();
    /// @notice Invitation signature verification failed.
    error InvalidSignature();
    /// @notice A user attempted to invite themselves.
    error SelfInvitation();
    /// @notice A circular invitation was detected (e.g., A invited B, and B attempted to invite A).
    error CircularInvitation();
    /// @notice A permission rule references an ID that is not a valid constant or existing badge.
    error InvalidPermissionRule(uint256 rule);
    /// @notice A permission array exceeds the maximum allowed length.
    error TooManyPermissionRules();
    /// @notice The hook address provided is already set on this badge.
    error HookAlreadySet();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initializes the Badge contract, setting up base roles and initializing required extensions.
     */
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

    /**
     * @notice Creates a new badge type with specific metadata and permissions.
     * @param name Human-readable name.
     * @param isOfficial If true, requires the caller to have `OFFICIAL_BADGE_CREATOR_ROLE`.
     * @param isCommunity Flag for community categorization.
     * @param hook Address of the custom logic contract (optional).
     * @param metadataURI IPFS/HTTPS link to metadata.
     * @param minters Array of IDs/constants allowed to mint.
     * @param transferers Array of IDs/constants allowed to transfer.
     * @param burners Array of IDs/constants allowed to burn.
     * @param editors Array of addresses allowed to modify this badge later.
     * @return id The newly assigned badge ID.
     */
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
        if (isCommunity) {
            if (!hasRole(COMMUNITY_MANAGER_ROLE, msg.sender)) {
                revert AccessControlUnauthorizedAccount(
                    msg.sender,
                    COMMUNITY_MANAGER_ROLE
                );
            }
        }
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

    /**
     * @notice Creates a user's unique (soulbound-by-default) profile badge.
     * @param metadataURI Metadata link for the user's profile.
     * @return pid The newly created profile badge ID.
     */
    function createProfile(
        string memory metadataURI
    ) external returns (uint256) {
        if (profileBadgeId[msg.sender] != 0) revert ProfileAlreadyExists();

        uint256[] memory empty = new uint256[](0);
        address[] memory noEditors = new address[](0);

        // Create the badge type — no editors: updateProfileURI has its own ownership check
        uint256 pid = _createBadge(
            "Profile",
            false,
            false,
            address(0),
            metadataURI,
            empty,
            empty,
            empty,
            noEditors
        );

        // Mark as profile badge before minting so _update can enforce the supply cap
        isProfileBadge[pid] = true;

        // Temporarily allow self-minting for the creation transaction
        canMint[pid].push(PERM_SELF);
        profileBadgeId[msg.sender] = pid;   // set before _mint (CEI)
        _mint(msg.sender, pid, 1, "");
        canMint[pid].pop();
        emit ProfileCreated(msg.sender, pid);
        return pid;
    }

    /**
     * @dev Internal helper for badge creation logic.
     */
    function _validateRules(uint256[] memory rules) internal view {
        if (rules.length > MAX_PERMISSION_RULES) revert TooManyPermissionRules();
        for (uint256 i = 0; i < rules.length; i++) {
            uint256 rule = rules[i];
            if (rule != PERM_SELF && rule != PERM_EVERYONE) {
                if (rule < STARTING_BADGE_ID || !_badgeExists(rule)) {
                    revert InvalidPermissionRule(rule);
                }
            }
        }
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
        _validateRules(minters);
        _validateRules(transferers);
        _validateRules(burners);

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

    /**
     * @notice Updates the hook contract for a specific badge ID.
     * @param id The badge type ID.
     * @param hook The new hook contract address.
     */
    function setBadgeHook(uint256 id, address hook) external {
        if (!canEdit[id][msg.sender]) revert Unauthorized();
        if (badges[id].hook == hook) revert HookAlreadySet();
        badges[id].hook = hook;
        emit HookUpdated(id, hook);
    }

    /**
     * @notice Modifies a badge's name, official status, and URI.
     * @dev Toggling official status requires `OFFICIAL_BADGE_CREATOR_ROLE`.
     *      The `isCommunity` flag is immutable after badge creation.
     */
    function modifyBadge(
        uint256 id,
        string memory name,
        bool isOfficial,
        string memory metadataURI
    ) external {
        if (!_badgeExists(id)) revert BadgeDoesNotExist();

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
        badge.metadataURI = metadataURI;

        emit BadgeModified(id, name, isOfficial, badge.isCommunity, metadataURI);
        emit URI(metadataURI, id);
    }

    /**
     * @notice Standard ERC1155 minting wrapper.
     */
    function mint(
        address to,
        uint256 id,
        uint256 amount,
        bytes memory data
    ) public {
        if (!_badgeExists(id)) revert BadgeDoesNotExist();
        // Permission check is done in _update
        _mint(to, id, amount, data);
    }

    /**
     * @notice Batch mint multiple badges to a single recipient.
     */
    function mintBatch(
        address to,
        uint256[] memory ids,
        uint256[] memory amounts,
        bytes memory data
    ) public {
        for (uint256 i = 0; i < ids.length; i++) {
            if (!_badgeExists(ids[i])) revert BadgeDoesNotExist();
        }
        // Permission check is done in _update
        _mintBatch(to, ids, amounts, data);
    }

    /**
     * @notice Transfers a badge from one address to another.
     * @dev SECURITY NOTE: Bypasses standard `isApprovedForAll` check to enable permission-based automated logic in `_update`.
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
     * @notice Batch transfers badges from one address to another.
     * @dev SECURITY NOTE: Bypasses standard `isApprovedForAll` check.
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
     * @notice Standard public burn function.
     */
    function burn(address from, uint256 id, uint256 value) public {
        if (!_badgeExists(id)) revert BadgeDoesNotExist();
        _burn(from, id, value);
    }

    /**
     * @notice Batch burn multiple badges.
     */
    function burnBatch(
        address from,
        uint256[] memory ids,
        uint256[] memory values
    ) public {
        for (uint256 i = 0; i < ids.length; i++) {
            if (!_badgeExists(ids[i])) revert BadgeDoesNotExist();
        }
        _burnBatch(from, ids, values);
    }

    /**
     * @notice Mints a single badge type to multiple different addresses in one call.
     */
    function mintToMultiple(
        address[] memory to,
        uint256 id,
        uint256 amount,
        bytes memory data
    ) public {
        if (!_badgeExists(id)) revert BadgeDoesNotExist();
        for (uint256 i = 0; i < to.length; i++) {
            // Permission check is done in _update for each mint
            _mint(to[i], id, amount, data);
        }
    }

    /**
     * @notice Updates the metadata URI for a badge.
     * @dev Reserved for badge editors.
     */
    function setURI(uint256 id, string memory newUri) external {
        if (!canEdit[id][msg.sender]) revert Unauthorized();
        badges[id].metadataURI = newUri;
        emit URI(newUri, id);
    }

    /**
     * @notice Specifically for profile badges, allows the user holding it to update their metadata link.
     */
    function updateProfileURI(uint256 id, string memory newUri) external {
        if (profileBadgeId[msg.sender] != id) revert NotProfileOwner();

        badges[id].metadataURI = newUri;
        emit URI(newUri, id);
    }

    /**
     * @notice Standard ERC1155 URI getter.
     */
    function uri(uint256 id) public view override returns (string memory) {
        return badges[id].metadataURI;
    }

    /**
     * @notice Returns the account balance for a specific badge.
     * @dev Redirects check to the badge's hook if one is configured.
     */
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

    /**
     * @notice Batch getter for badge balances.
     */
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

    /**
     * @notice Returns the credentials (badge IDs) required to mint this badge type.
     */
    function getBadgeMinters(
        uint256 id
    ) external view returns (uint256[] memory) {
        return canMint[id];
    }

    /**
     * @notice Returns the credentials (badge IDs) required to transfer this badge type.
     */
    function getBadgeTransferers(
        uint256 id
    ) external view returns (uint256[] memory) {
        return canTransfer[id];
    }

    /**
     * @notice Accepts an invitation signed by an existing protocol user.
     * @dev This prevents bots by requiring a signature from a valid user. 
     * Verifies that the signed message ends with the caller's hexadecimal address.
     * @param inviter The address of the user who signed the invitation.
     * @param message The signed string message.
     * @param signature The EIP-712 or personal sign signature.
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

        // Extract the trailing address string from the message
        bytes memory addressBytes = new bytes(42);
        for (uint256 i = 0; i < 42; i++) {
            addressBytes[i] = msgBytes[len - 42 + i];
        }

        // Validate that the message suffix matches the caller's address in hex
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

    /**
     * @notice Returns the credentials (badge IDs) required to burn this badge type.
     */
    function getBadgeBurners(
        uint256 id
    ) external view returns (uint256[] memory) {
        return canBurn[id];
    }

    /**
     * @notice Overridden internal update hook to enforce all badge permissions.
     * @dev This is the central security mechanism. It checks:
     * 1. Hook contracts (highest priority).
     * 2. Permission constants (PERM_EVERYONE, PERM_SELF).
     * 3. Badge-gated requirements (user MUST hold a specific badge ID).
     */
    function _update(
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory values
    ) internal override(ERC1155Upgradeable, ERC1155SupplyUpgradeable) {
        for (uint256 i = 0; i < ids.length; i++) {
            uint256 id = ids[i];

            // Profile badges are strictly one-of-one.
            // _profileMintLocked blocks reentrant extra mints during the ERC1155 callback window
            // (when totalSupply is still 0 but the first mint is in progress).
            // totalSupply >= 1 blocks any subsequent non-reentrant minting attempts.
            if (isProfileBadge[id] && from == address(0)) {
                if (totalSupply(id) >= 1 || _profileMintLocked[id]) revert ProfileMustBeUnique();
                _profileMintLocked[id] = true;
            }

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

                // CommunityRegistry can mint isCommunity badges without permission checks
                bool allowed = from == address(0)
                    && hasRole(COMMUNITY_MANAGER_ROLE, msg.sender)
                    && badges[id].isCommunity;
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
                        // User must hold the required badge effectively (hook check included)
                        if (super.balanceOf(msg.sender, rule) > 0) {
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

    /**
     * @notice Standard ERC1155/AccessControl interface support check.
     */
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
