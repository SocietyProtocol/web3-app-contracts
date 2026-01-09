// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts-upgradeable/token/ERC1155/ERC1155Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC1155/extensions/ERC1155SupplyUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "./ISocietyBadgeHook.sol";

/// @title Society Protocol Badges
/// @notice Manages badges and user profiles for the Society Protocol
/// @dev Implements ERC1155 with AccessControl, UUPS Upgradeability, and custom hooks
contract SocietyProtocolBadges is
    Initializable,
    ERC1155Upgradeable,
    AccessControlUpgradeable,
    ERC1155SupplyUpgradeable,
    UUPSUpgradeable
{
    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");
    bytes32 public constant OFFICIAL_BADGE_MINTER_ROLE =
        keccak256("OFFICIAL_BADGE_MINTER_ROLE");

    struct BadgeInfo {
        string name;
        bool isOfficial;
        bool isCommunity;
        string metadataURI;
        address creator;
    }

    mapping(uint256 => BadgeInfo) public badges;

    // badgeId => operator => allowed
    mapping(uint256 => mapping(address => bool)) public canMint;
    mapping(uint256 => mapping(address => bool)) public canTransfer;
    mapping(uint256 => mapping(address => bool)) public canBurn;

    // badgeId => hook address
    mapping(uint256 => address) public badgeHooks;

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
    event PermissionsUpdated(
        uint256 indexed id,
        address indexed operator,
        bool mint,
        bool transfer,
        bool burn
    );
    event HookUpdated(uint256 indexed id, address indexed hook);
    event ProfileCreated(address indexed user, uint256 indexed id);

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

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize() public initializer {
        __ERC1155_init("");
        __AccessControl_init();
        __ERC1155Supply_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(GOVERNOR_ROLE, msg.sender);
    }

    /// @notice Creates a new badge
    /// @dev Consolidated function for official and community badges
    function createBadge(
        string memory name,
        bool isOfficial,
        bool isCommunity,
        string memory metadataURI,
        address[] calldata minters,
        address[] calldata transferers,
        address[] calldata burners
    ) external returns (uint256) {
        if (isOfficial) {
            // Check for OFFICIAL_BADGE_MINTER_ROLE
            if (
                !hasRole(OFFICIAL_BADGE_MINTER_ROLE, msg.sender) &&
                !hasRole(GOVERNOR_ROLE, msg.sender)
            ) {
                revert AccessControlUnauthorizedAccount(
                    msg.sender,
                    OFFICIAL_BADGE_MINTER_ROLE
                );
            }
        }
        // No restriction for community badges - anyone can create
        return
            _createBadge(
                name,
                isOfficial,
                isCommunity,
                metadataURI,
                minters,
                transferers,
                burners
            );
    }

    /// @notice Creates a unique profile badge for the caller
    /// @dev One profile per address
    function createProfile(
        string memory metadataURI
    ) external returns (uint256) {
        if (profileBadgeId[msg.sender] != 0) revert ProfileAlreadyExists();

        address[] memory empty = new address[](0);

        // Create the badge type
        uint256 id = _createBadge(
            "Profile",
            false,
            false,
            metadataURI,
            empty,
            empty,
            empty
        );

        // Grant temporary mint permission to msg.sender so _update check passes
        canMint[id][msg.sender] = true;
        _mint(msg.sender, id, 1, "");
        canMint[id][msg.sender] = false; // Revoke immediately

        profileBadgeId[msg.sender] = id;
        emit ProfileCreated(msg.sender, id);
        return id;
    }

    function _createBadge(
        string memory name,
        bool isOfficial,
        bool isCommunity,
        string memory metadataURI,
        address[] memory minters,
        address[] memory transferers,
        address[] memory burners
    ) internal returns (uint256) {
        nextTokenId++;
        uint256 id = nextTokenId;

        badges[id] = BadgeInfo({
            name: name,
            isOfficial: isOfficial,
            isCommunity: isCommunity,
            metadataURI: metadataURI,
            creator: msg.sender
        });

        for (uint256 i = 0; i < minters.length; i++) {
            canMint[id][minters[i]] = true;
            emit PermissionsUpdated(id, minters[i], true, false, false);
        }
        for (uint256 i = 0; i < transferers.length; i++) {
            canTransfer[id][transferers[i]] = true;
            emit PermissionsUpdated(id, transferers[i], false, true, false);
        }
        for (uint256 i = 0; i < burners.length; i++) {
            canBurn[id][burners[i]] = true;
            emit PermissionsUpdated(id, burners[i], false, false, true);
        }

        emit BadgeCreated(id, name, isOfficial, isCommunity, msg.sender);
        return id;
    }

    /// @notice Sets a hook contract for a specific badge
    /// @dev Only callable by GOVERNOR_ROLE
    function setBadgeHook(
        uint256 id,
        address hook
    ) external onlyRole(GOVERNOR_ROLE) {
        badgeHooks[id] = hook;
        emit HookUpdated(id, hook);
    }

    /// @notice Modifies an existing badge
    /// @dev Only callable by Governor or Badge Creator
    function modifyBadge(
        uint256 id,
        string memory name,
        bool isOfficial,
        bool isCommunity,
        string memory metadataURI
    ) external {
        if (id > nextTokenId) revert BadgeDoesNotExist();

        BadgeInfo storage badge = badges[id];

        bool isGovernor = hasRole(GOVERNOR_ROLE, msg.sender);
        bool isCreator = (badge.creator == msg.sender);

        if (!isGovernor && !isCreator) revert Unauthorized();

        // Only Governor can toggle isOfficial
        if (badge.isOfficial != isOfficial) {
            if (!isGovernor) revert Unauthorized();
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

    /// @notice Updates the metadata URI for a badge
    /// @dev Only callable by GOVERNOR_ROLE
    function setURI(
        uint256 id,
        string memory newUri
    ) external onlyRole(GOVERNOR_ROLE) {
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

    function _update(
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory values
    ) internal override(ERC1155Upgradeable, ERC1155SupplyUpgradeable) {
        for (uint256 i = 0; i < ids.length; i++) {
            uint256 id = ids[i];
            address hook = badgeHooks[id];

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
                // Fallback to internal mappings
                if (from == address(0)) {
                    if (!canMint[id][msg.sender]) revert MintNotAuthorized();
                } else if (to == address(0)) {
                    if (!canBurn[id][msg.sender]) revert BurnNotAuthorized();
                } else {
                    if (!canTransfer[id][msg.sender])
                        revert TransferNotAuthorized();
                }
            }
        }
        super._update(from, to, ids, values);
    }

    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyRole(GOVERNOR_ROLE) {}

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
