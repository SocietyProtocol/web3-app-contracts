// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "./SocietyProtocolBadges.sol";
import "./CommunityWrapperFactory.sol";

/// @title CommunityRegistry
/// @notice Central hub for creating and managing communities in the Society Protocol.
/// @dev The communityId equals the Creator badge ID — whoever holds that badge IS the
///      community creator. No separate mapping lookup is needed to validate access.
///      Community badge indexing is off-chain via emitted events.
contract CommunityRegistry is Initializable, OwnableUpgradeable, UUPSUpgradeable {
    // -------------------------------------------------------------------------
    // Types
    // -------------------------------------------------------------------------

    /// @notice Stores community data. The mapping key (communityId) is also the Creator badge ID.
    struct Community {
        string name;
        string description;
        uint256 memberBadgeId;
        address wrapper;
        uint256 createdAt;
    }

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    /// @notice The Society Protocol Badges ERC1155 contract.
    SocietyProtocolBadges public badges;

    /// @notice The factory used to deploy CommunityWrapper ERC20 clones.
    CommunityWrapperFactory public wrapperFactory;

    /// @notice Total number of communities created.
    uint256 public communityCount;

    /// @notice Maps communityId (= Creator badge ID) to community data.
    mapping(uint256 => Community) public communities;

    /// @notice Maps communityId to additional (non-creator/member) badge IDs.
    mapping(uint256 => uint256[]) private _communityBadgeIds;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    /// @notice Emitted when a new community is created.
    /// @param communityId Also the Creator badge ID on the Badges contract.
    event CommunityCreated(
        uint256 indexed communityId,
        address indexed creator,
        uint256 memberBadgeId
    );

    /// @notice Emitted when a CommunityWrapper ERC20 is deployed for a community.
    event CommunityWrapperDeployed(
        uint256 indexed communityId,
        address indexed wrapper
    );

    /// @notice Emitted when an additional badge is created for a community.
    event CommunityBadgeCreated(
        uint256 indexed communityId,
        uint256 indexed badgeId
    );

    /// @notice Emitted when a community's name or description is updated.
    event CommunityDetailsUpdated(
        uint256 indexed communityId,
        string name,
        string description
    );

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    /// @notice Caller does not hold the community's Creator badge.
    error Unauthorized();

    /// @notice The referenced community ID does not exist.
    error CommunityDoesNotExist();

    /// @notice A CommunityWrapper has already been deployed for this community.
    error WrapperAlreadyDeployed();

    // -------------------------------------------------------------------------
    // Constructor / Initializer
    // -------------------------------------------------------------------------

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initializes the CommunityRegistry.
     * @param _badges Address of the SocietyProtocolBadges proxy.
     * @param _wrapperFactory Address of the CommunityWrapperFactory proxy.
     * @param _owner Address that will own this contract (admin).
     */
    function initialize(
        address _badges,
        address _wrapperFactory,
        address _owner
    ) public initializer {
        __Ownable_init(_owner);
        __UUPSUpgradeable_init();

        badges = SocietyProtocolBadges(_badges);
        wrapperFactory = CommunityWrapperFactory(_wrapperFactory);
    }

    // -------------------------------------------------------------------------
    // Modifiers
    // -------------------------------------------------------------------------

    /// @dev communityId == creatorBadgeId, so holding the badge is sufficient proof.
    modifier onlyCreator(uint256 communityId) {
        if (communities[communityId].memberBadgeId == 0) revert CommunityDoesNotExist();
        if (badges.balanceOf(msg.sender, communityId) == 0) revert Unauthorized();
        _;
    }

    // -------------------------------------------------------------------------
    // Core functions
    // -------------------------------------------------------------------------

    /**
     * @notice Creates a new community with a Creator badge and a Member badge.
     * @dev The returned communityId equals the Creator badge ID on the Badges contract.
     *      Both the creator badge and one member badge are minted to the caller immediately.
     *
     *      Creator badge permissions:
     *        - canMint: [] — only registry (via COMMUNITY_MANAGER_ROLE) can mint.
     *        - canTransfer: [PERM_SELF] — only the current holder can transfer.
     *        - canBurn: [] — non-burnable.
     *
     *      Member badge permissions:
     *        - canMint: [creatorBadgeId] — only Creator badge holder can mint.
     *        - canTransfer: [] — soulbound.
     *        - canBurn: [creatorBadgeId] — Creator badge holder can burn.
     *
     * @param name Community name.
     * @param description Community description.
     * @param creatorBadgeURI Metadata URI for the Creator badge.
     * @param memberBadgeURI Metadata URI for the Member badge.
     * @return communityId The Creator badge ID, used as the community's on-chain identifier.
     */
    function createCommunity(
        string calldata name,
        string calldata description,
        string calldata creatorBadgeURI,
        string calldata memberBadgeURI
    ) external returns (uint256 communityId) {
        uint256 creatorBadgeId = _createCreatorBadge(string.concat(name, " Creator"), creatorBadgeURI);
        uint256 memberBadgeId  = _createMemberBadge(string.concat(name, " Member"), memberBadgeURI, creatorBadgeId);

        // Mint creator badge and one member badge to the caller (privileged via COMMUNITY_MANAGER_ROLE)
        badges.mint(msg.sender, creatorBadgeId, 1, "");
        badges.mint(msg.sender, memberBadgeId,  1, "");

        communityId = creatorBadgeId;
        ++communityCount;
        communities[communityId] = Community({
            name: name,
            description: description,
            memberBadgeId: memberBadgeId,
            wrapper: address(0),
            createdAt: block.timestamp
        });

        emit CommunityCreated(communityId, msg.sender, memberBadgeId);
    }

    /// @dev Creates the Creator badge: only holder can transfer (PERM_SELF), non-mintable/burnable.
    function _createCreatorBadge(string memory name, string memory uri) internal returns (uint256) {
        uint256[] memory empty = new uint256[](0);
        uint256[] memory permSelf = new uint256[](1);
        permSelf[0] = badges.PERM_SELF();

        address[] memory editors = new address[](1);
        editors[0] = address(this);

        return badges.createBadge(name, false, true, address(0), uri, empty, permSelf, empty, editors);
    }

    /// @dev Creates the Member badge: creator-badge-gated mint and burn, non-transferable.
    function _createMemberBadge(string memory name, string memory uri, uint256 creatorBadgeId) internal returns (uint256) {
        uint256[] memory empty = new uint256[](0);
        uint256[] memory creatorGated = new uint256[](1);
        creatorGated[0] = creatorBadgeId;

        address[] memory editors = new address[](1);
        editors[0] = address(this);

        return badges.createBadge(name, false, true, address(0), uri, creatorGated, empty, creatorGated, editors);
    }

    /**
     * @notice Deploys a CommunityWrapper ERC20 token for a community.
     * @dev Callable only by the Creator badge holder. Can only be called once per community.
     * @param communityId The community to deploy a wrapper for (= Creator badge ID).
     * @param wrapperName ERC20 name for the wrapper token.
     * @param wrapperSymbol ERC20 symbol for the wrapper token.
     * @return wrapper Address of the deployed CommunityWrapper clone.
     */
    function deployCommunityWrapper(
        uint256 communityId,
        string calldata wrapperName,
        string calldata wrapperSymbol
    ) external onlyCreator(communityId) returns (address wrapper) {
        if (communities[communityId].wrapper != address(0)) revert WrapperAlreadyDeployed();

        uint256[] memory badgeIds = new uint256[](1);
        badgeIds[0] = communities[communityId].memberBadgeId;

        wrapper = wrapperFactory.createWrapper(wrapperName, wrapperSymbol, badgeIds);
        communities[communityId].wrapper = wrapper;

        emit CommunityWrapperDeployed(communityId, wrapper);
    }

    /**
     * @notice Creates an additional badge associated with a community.
     * @dev Callable only by the Creator badge holder.
     * @param communityId The community to add the badge to (= Creator badge ID).
     * @param name Badge name.
     * @param metadataURI Badge metadata URI.
     * @param minters canMint permission rules (badge IDs or PERM_* constants).
     * @param transferers canTransfer permission rules.
     * @param burners canBurn permission rules.
     * @return badgeId The newly created badge ID.
     */
    function createCommunityBadge(
        uint256 communityId,
        string calldata name,
        string calldata metadataURI,
        uint256[] calldata minters,
        uint256[] calldata transferers,
        uint256[] calldata burners
    ) external onlyCreator(communityId) returns (uint256 badgeId) {
        badgeId = _createAdditionalBadge(name, metadataURI, _toMemory(minters), _toMemory(transferers), _toMemory(burners));
        _communityBadgeIds[communityId].push(badgeId);
        emit CommunityBadgeCreated(communityId, badgeId);
    }

    /// @dev Copies a calldata uint256 array to memory (reduces stack slot usage at call sites).
    function _toMemory(uint256[] calldata arr) internal pure returns (uint256[] memory out) {
        out = arr;
    }

    /// @dev Wraps badges.createBadge for additional community badges, keeping the registry as editor.
    function _createAdditionalBadge(
        string memory name,
        string memory metadataURI,
        uint256[] memory minters,
        uint256[] memory transferers,
        uint256[] memory burners
    ) internal returns (uint256) {
        address[] memory editors = new address[](1);
        editors[0] = address(this);
        return badges.createBadge(name, false, true, address(0), metadataURI, minters, transferers, burners, editors);
    }

    /**
     * @notice Updates a community's name and description.
     * @param communityId The community to update (= Creator badge ID).
     * @param name New community name.
     * @param description New community description.
     */
    function updateCommunityDetails(
        uint256 communityId,
        string calldata name,
        string calldata description
    ) external onlyCreator(communityId) {
        communities[communityId].name = name;
        communities[communityId].description = description;
        emit CommunityDetailsUpdated(communityId, name, description);
    }

    // -------------------------------------------------------------------------
    // View functions
    // -------------------------------------------------------------------------

    /**
     * @notice Returns the data struct for a community.
     * @param communityId The community to query (= Creator badge ID).
     */
    function getCommunityDetails(
        uint256 communityId
    ) external view returns (Community memory) {
        if (communities[communityId].memberBadgeId == 0) revert CommunityDoesNotExist();
        return communities[communityId];
    }

    /**
     * @notice Returns all badge IDs belonging to a community.
     * @dev Index 0 = communityId (Creator badge), index 1 = Member badge, remaining = additional badges.
     * @param communityId The community to query (= Creator badge ID).
     */
    function getCommunityBadges(
        uint256 communityId
    ) external view returns (uint256[] memory) {
        if (communities[communityId].memberBadgeId == 0) revert CommunityDoesNotExist();
        uint256[] storage extra = _communityBadgeIds[communityId];
        uint256[] memory all = new uint256[](2 + extra.length);
        all[0] = communityId;
        all[1] = communities[communityId].memberBadgeId;
        for (uint256 i = 0; i < extra.length; i++) {
            all[2 + i] = extra[i];
        }
        return all;
    }

    /**
     * @notice Returns true if `account` currently holds the Creator badge for a community.
     * @param communityId The community to check (= Creator badge ID).
     * @param account The address to check.
     */
    function isCreator(
        uint256 communityId,
        address account
    ) external view returns (bool) {
        if (communities[communityId].memberBadgeId == 0) revert CommunityDoesNotExist();
        return badges.balanceOf(account, communityId) > 0;
    }

    // -------------------------------------------------------------------------
    // Admin
    // -------------------------------------------------------------------------

    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyOwner {}
}
