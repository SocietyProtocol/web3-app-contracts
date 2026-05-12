// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "./ISocietyBadgeHook.sol";
import "./SocietyProtocolBadges.sol";

/**
 * @title Society VIP Manager
 * @notice Manages personal VIP tiers (Bronze, Silver, Gold) via staking, and community tiers via
 *         owner-granted time-limited grants.
 * @dev Implements ISocietyBadgeHook for personal VIP badges only.
 *      Community tiers are stored in a plain mapping keyed by communityId (= manager badge ID) and
 *      queried via getCommunityTier(communityId). Each active grant also assigns a representative
 *      whose VIP badge visibility is surfaced through onBalanceOf() for the duration of the grant.
 */
contract SocietyVipManager is
    Initializable,
    OwnableUpgradeable,
    UUPSUpgradeable,
    ISocietyBadgeHook
{
    using SafeERC20 for IERC20;

    // -------------------------------------------------------------------------
    // Personal VIP state
    // -------------------------------------------------------------------------

    /// @notice The Society Protocol Badges contract.
    SocietyProtocolBadges public badges;

    /// @notice The ERC20 token used for staking.
    IERC20 public stakingToken;

    /// @notice Badge ID for the Bronze VIP tier.
    uint256 public bronzeBadgeId;
    /// @notice Badge ID for the Silver VIP tier.
    uint256 public silverBadgeId;
    /// @notice Badge ID for the Gold VIP tier.
    uint256 public goldBadgeId;

    /// @notice Amount of stakingToken required for the Bronze tier.
    uint256 public bronzeAmount;
    /// @notice Amount of stakingToken required for the Silver tier.
    uint256 public silverAmount;
    /// @notice Amount of stakingToken required for the Gold tier.
    uint256 public goldAmount;

    /// @notice The minimum duration required for the stake to be locked.
    uint256 public constant MIN_LOCK_DURATION = 30 days;
    /// @notice The maximum allowed lock duration.
    uint256 public constant MAX_LOCK_DURATION = 4 * 365 days;

    /**
     * @dev Struct to store user locking information.
     * @param tierId The tier the user locked into: 1 = Bronze, 2 = Silver, 3 = Gold. Snapshot at lock time.
     * @param amount The total amount of staking tokens locked by the user.
     * @param unlockTime The timestamp when the lock expires and tokens can be withdrawn.
     */
    struct LockInfo {
        uint256 tierId;
        uint256 amount;
        uint256 unlockTime;
    }

    /// @notice Maps user addresses to their corresponding lock information.
    mapping(address => LockInfo) public locks;

    // -------------------------------------------------------------------------
    // Community tier state
    // -------------------------------------------------------------------------

    /**
     * @dev Stores an owner-granted community tier.
     * @param tierId An owner-defined tier identifier (e.g. 1 = Bronze, 2 = Silver, 3 = Gold).
     * @param expiry Unix timestamp after which the tier is no longer active.
     * @param representative Address that receives the same VIP tier badge via onBalanceOf.
     */
    struct CommunityTierGrant {
        uint256 tierId;
        uint256 expiry;
        address representative;
    }

    /// @notice communityId (= manager badge ID) => active community tier grant.
    mapping(uint256 => CommunityTierGrant) public communityTiers;

    /// @notice Tracks which communityId a given address is currently representing (0 = none).
    mapping(address => uint256) public representativeCommunity;

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    /// @notice Error thrown when the requested lock duration is shorter than the minimum allowed.
    error LockDurationTooShort();
    /// @notice Error thrown when attempting to unlock tokens while the lock is still active.
    error LockStillActive();
    /// @notice Error thrown when a user attempts to unlock without having any tokens locked.
    error NoTokensLocked();
    /// @notice Error thrown when a zero address is provided where a valid address is required.
    error InvalidAddress();
    /// @notice Error thrown when tier amounts are zero or not strictly increasing.
    error InvalidTierAmounts();
    /// @notice Error thrown when a user tries to create a new lock while an expired lock still holds tokens.
    error ExpiredLockMustBeUnlockedFirst();
    /// @notice Error thrown when the tierId is not 1 (Bronze), 2 (Silver), or 3 (Gold).
    error InvalidTier();
    /// @notice Error thrown when a user tries to call lock() while already having an active lock.
    error LockAlreadyActive();
    /// @notice Error thrown when upgradeTier is called with the same or a lower tier.
    error CannotDowngradeTier();
    /// @notice Error thrown when the requested lock duration exceeds the maximum allowed.
    error LockDurationTooLong();
    /// @notice Error thrown when changeRepresentative is called on a community with no active tier grant.
    error NoCommunityTierGrant();
    /// @notice Error thrown when the chosen representative already has an active staking lock.
    error RepresentativeAlreadyLocked();
    /// @notice Error thrown when a provided badge ID does not exist on the badges contract.
    error InvalidBadgeId();
    /// @notice Error thrown when an address is already an active representative for another community.
    error AlreadyARepresentative();

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event TokensLocked(address indexed user, uint256 tierId, uint256 amount, uint256 unlockTime);
    event TokensUnlocked(address indexed user, uint256 amount);
    event TierUpgraded(address indexed user, uint256 newTierId, uint256 newAmount, uint256 unlockTime);
    event AmountsUpdated(uint256 bronze, uint256 silver, uint256 gold);
    /// @notice Emitted when a community tier grant is created or overwritten.
    event CommunityTierGranted(uint256 indexed communityId, uint256 tierId, uint256 expiry, address indexed representative);
    /// @notice Emitted when a community tier grant is revoked before expiry.
    event CommunityTierRevoked(uint256 indexed communityId);
    /// @notice Emitted when the representative of a community tier grant is changed.
    event RepresentativeChanged(uint256 indexed communityId, address indexed oldRepresentative, address indexed newRepresentative);

    // -------------------------------------------------------------------------
    // Constructor / Initializer
    // -------------------------------------------------------------------------

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initializes the VIP Manager.
     * @param _badges Address of the SocietyProtocolBadges contract.
     * @param _stakingToken Address of the ERC20 token to use for staking.
     * @param _bronzeBadgeId ID of the pre-created Bronze VIP badge.
     * @param _silverBadgeId ID of the pre-created Silver VIP badge.
     * @param _goldBadgeId ID of the pre-created Gold VIP badge.
     * @param _bronzeAmount Minimum tokens required for Bronze tier.
     * @param _silverAmount Minimum tokens required for Silver tier (must be >= bronze).
     * @param _goldAmount Minimum tokens required for Gold tier (must be >= silver).
     */
    function initialize(
        address _badges,
        address _stakingToken,
        uint256 _bronzeBadgeId,
        uint256 _silverBadgeId,
        uint256 _goldBadgeId,
        uint256 _bronzeAmount,
        uint256 _silverAmount,
        uint256 _goldAmount
    ) public initializer {
        if (_badges == address(0) || _stakingToken == address(0)) revert InvalidAddress();
        if (_bronzeAmount == 0 || _silverAmount < _bronzeAmount || _goldAmount < _silverAmount)
            revert InvalidTierAmounts();

        SocietyProtocolBadges b = SocietyProtocolBadges(_badges);
        if (!b.badgeExists(_bronzeBadgeId)) revert InvalidBadgeId();
        if (!b.badgeExists(_silverBadgeId)) revert InvalidBadgeId();
        if (!b.badgeExists(_goldBadgeId))   revert InvalidBadgeId();

        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        badges = b;
        stakingToken = IERC20(_stakingToken);

        bronzeBadgeId = _bronzeBadgeId;
        silverBadgeId = _silverBadgeId;
        goldBadgeId   = _goldBadgeId;

        bronzeAmount = _bronzeAmount;
        silverAmount = _silverAmount;
        goldAmount   = _goldAmount;
    }

    // -------------------------------------------------------------------------
    // Personal VIP — staking
    // -------------------------------------------------------------------------

    /**
     * @notice Updates the required amounts for each VIP tier.
     */
    function setTierAmounts(
        uint256 _bronze,
        uint256 _silver,
        uint256 _gold
    ) external onlyOwner {
        if (_bronze == 0 || _silver < _bronze || _gold < _silver) revert InvalidTierAmounts();
        bronzeAmount = _bronze;
        silverAmount = _silver;
        goldAmount   = _gold;
        emit AmountsUpdated(_bronze, _silver, _gold);
    }

    /**
     * @notice Returns the required staking amount for a given tier.
     * @param tierId 1 = Bronze, 2 = Silver, 3 = Gold.
     */
    function _tierAmount(uint256 tierId) internal view returns (uint256) {
        if (tierId == 1) return bronzeAmount;
        if (tierId == 2) return silverAmount;
        if (tierId == 3) return goldAmount;
        revert InvalidTier();
    }

    /**
     * @notice Locks the required token amount for the chosen VIP tier.
     * @dev The amount transferred is determined by the tier: 1 = bronzeAmount, 2 = silverAmount, 3 = goldAmount.
     *      Reverts if the caller already has an active lock (use upgradeTier instead).
     *      Reverts if the caller has an expired lock with unclaimed tokens (call unlock first).
     * @param tierId  The target tier: 1 (Bronze), 2 (Silver), or 3 (Gold).
     * @param duration Lock duration in seconds. Must be >= MIN_LOCK_DURATION.
     */
    function lock(uint256 tierId, uint256 duration) external {
        uint256 amount = _tierAmount(tierId); // also validates tierId
        if (duration < MIN_LOCK_DURATION) revert LockDurationTooShort();
        if (duration > MAX_LOCK_DURATION) revert LockDurationTooLong();

        LockInfo storage userLock = locks[msg.sender];

        if (userLock.amount > 0) {
            if (block.timestamp < userLock.unlockTime) {
                revert LockAlreadyActive();
            } else {
                revert ExpiredLockMustBeUnlockedFirst();
            }
        }
        if (userLock.tierId != 0 && block.timestamp < userLock.unlockTime) {
            revert LockAlreadyActive();
        }

        userLock.tierId = tierId;
        userLock.amount = amount;
        userLock.unlockTime = block.timestamp + duration;

        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        emit TokensLocked(msg.sender, tierId, amount, userLock.unlockTime);
    }

    /**
     * @notice Upgrades an active lock to a higher VIP tier.
     * @dev Only the difference between the new and current locked amount is transferred.
     *      The unlock time is unchanged. Cannot downgrade or stay at the same tier.
     * @param newTierId The target tier: 1 (Bronze), 2 (Silver), or 3 (Gold). Must be higher than current tier.
     */
    function upgradeTier(uint256 newTierId) external {
        LockInfo storage userLock = locks[msg.sender];
        if (userLock.amount == 0) revert NoTokensLocked();
        if (block.timestamp >= userLock.unlockTime) revert ExpiredLockMustBeUnlockedFirst();

        uint256 newAmount = _tierAmount(newTierId); // also validates newTierId
        if (newAmount <= userLock.amount) revert CannotDowngradeTier();

        uint256 topUp = newAmount - userLock.amount;
        userLock.tierId = newTierId;
        userLock.amount = newAmount;

        stakingToken.safeTransferFrom(msg.sender, address(this), topUp);
        emit TierUpgraded(msg.sender, newTierId, newAmount, userLock.unlockTime);
    }

    /**
     * @notice Withdraws all locked tokens after the lock period has expired.
     */
    function unlock() external {
        LockInfo storage userLock = locks[msg.sender];
        if (userLock.amount == 0) revert NoTokensLocked();
        if (block.timestamp < userLock.unlockTime) revert LockStillActive();

        uint256 amount = userLock.amount;
        userLock.tierId = 0;
        userLock.amount = 0;
        userLock.unlockTime = 0;

        stakingToken.safeTransfer(msg.sender, amount);
        emit TokensUnlocked(msg.sender, amount);
    }

    // -------------------------------------------------------------------------
    // Community tier management
    // -------------------------------------------------------------------------

    /**
     * @notice Grants a community tier to a community for a fixed duration.
     * @dev Only the contract owner can call this. Overwrites any existing grant.
     *      The representative receives the same VIP tier badge via onBalanceOf for the grant's duration.
     *      If regranting with a different representative, the old representative's tier is cleared.
     * @param communityId The community's identifier (= manager badge ID).
     * @param tierId An identifier for the tier level (1 = Bronze, 2 = Silver, 3 = Gold).
     * @param duration Duration in seconds before the tier expires.
     * @param representative Address that receives the VIP badge for the duration of the grant.
     */
    function grantCommunityTier(
        uint256 communityId,
        uint256 tierId,
        uint256 duration,
        address representative
    ) external onlyOwner {
        if (tierId == 0 || tierId > 3) revert InvalidTier();
        if (duration == 0) revert LockDurationTooShort();
        if (representative == address(0)) revert InvalidAddress();

        CommunityTierGrant storage existingGrant = communityTiers[communityId];
        address oldRepresentative = existingGrant.representative;
        if (locks[representative].amount > 0) revert RepresentativeAlreadyLocked();
        uint256 existingCommunity = representativeCommunity[representative];
        if (existingCommunity != 0 && existingCommunity != communityId) {
            if (block.timestamp < communityTiers[existingCommunity].expiry) revert AlreadyARepresentative();
            delete representativeCommunity[representative];
        }

        uint256 expiry = block.timestamp + duration;
        if (oldRepresentative != address(0) && oldRepresentative != representative) {
            if (locks[oldRepresentative].amount == 0) delete locks[oldRepresentative];
            delete representativeCommunity[oldRepresentative];
        }
        communityTiers[communityId] = CommunityTierGrant({ tierId: tierId, expiry: expiry, representative: representative });
        locks[representative] = LockInfo({ tierId: tierId, amount: 0, unlockTime: expiry });
        representativeCommunity[representative] = communityId;
        emit CommunityTierGranted(communityId, tierId, expiry, representative);
    }

    /**
     * @notice Revokes an active community tier grant immediately.
     * @dev No-ops silently if the community has no active grant.
     * @param communityId The community whose tier is being revoked.
     */
    function revokeCommunityTier(uint256 communityId) external onlyOwner {
        if (communityTiers[communityId].expiry == 0) return;
        address rep = communityTiers[communityId].representative;
        delete communityTiers[communityId];
        delete representativeCommunity[rep];
        if (locks[rep].amount == 0) delete locks[rep];
        emit CommunityTierRevoked(communityId);
    }

    /**
     * @notice Transfers the community VIP grant to a new representative, preserving the original expiry.
     * @dev Removes the lock from the old representative and assigns it to the new one.
     * @param communityId The community whose representative is being changed.
     * @param newRepresentative The address that will receive the VIP tier lock.
     */
    function changeRepresentative(uint256 communityId, address newRepresentative) external onlyOwner {
        if (newRepresentative == address(0)) revert InvalidAddress();
        CommunityTierGrant storage grant = communityTiers[communityId];
        if (grant.expiry == 0 || block.timestamp >= grant.expiry) revert NoCommunityTierGrant();

        if (locks[newRepresentative].amount > 0) revert RepresentativeAlreadyLocked();
        uint256 existingCommunity = representativeCommunity[newRepresentative];
        if (existingCommunity != 0) {
            if (block.timestamp < communityTiers[existingCommunity].expiry) revert AlreadyARepresentative();
            delete representativeCommunity[newRepresentative];
        }

        address oldRep = grant.representative;
        if (locks[oldRep].amount == 0) delete locks[oldRep];
        delete representativeCommunity[oldRep];
        grant.representative = newRepresentative;
        locks[newRepresentative] = LockInfo({ tierId: grant.tierId, amount: 0, unlockTime: grant.expiry });
        representativeCommunity[newRepresentative] = communityId;
        emit RepresentativeChanged(communityId, oldRep, newRepresentative);
    }

    /**
     * @notice Returns the active community tier for a given community.
     * @dev Returns (0, 0) if the community has no grant or the grant has expired.
     * @param communityId The community to query (= manager badge ID).
     * @return tierId The active tier identifier, or 0 if none.
     * @return expiry The unix timestamp when the tier expires, or 0 if none.
     */
    function getCommunityTier(uint256 communityId) external view returns (uint256 tierId, uint256 expiry) {
        CommunityTierGrant storage g = communityTiers[communityId];
        if (g.expiry == 0 || block.timestamp >= g.expiry) return (0, 0);
        return (g.tierId, g.expiry);
    }

    // -------------------------------------------------------------------------
    // ISocietyBadgeHook — personal VIP only
    // -------------------------------------------------------------------------

    /// @dev VIP badges cannot be minted directly. Always returns false.
    function onCheckMint(address, address, uint256, uint256) external pure returns (bool) {
        return false;
    }

    /// @dev VIP badges are non-transferable. Always returns false.
    function onCheckTransfer(address, address, address, uint256, uint256) external pure returns (bool) {
        return false;
    }

    /// @dev VIP badges are not burnable directly. Always returns false.
    function onCheckBurn(address, address, uint256, uint256) external pure returns (bool) {
        return false;
    }

    /**
     * @notice Returns 1 if the account holds the personal VIP badge based on their staked amount.
     * @dev Community-tier representatives are also reflected through the same lock mapping.
     *      Tier visibility is exclusive: Bronze shows only Bronze, Silver only Silver, Gold only Gold.
     */
    function onBalanceOf(address account, uint256 id) external view returns (uint256) {
        LockInfo storage userLock = locks[account];
        if (block.timestamp >= userLock.unlockTime || userLock.tierId == 0) return 0;

        if (id == goldBadgeId)   return userLock.tierId == 3 ? 1 : 0;
        if (id == silverBadgeId) return userLock.tierId == 2 ? 1 : 0;
        if (id == bronzeBadgeId) return userLock.tierId == 1 ? 1 : 0;

        return 0;
    }

    // -------------------------------------------------------------------------
    // Admin
    // -------------------------------------------------------------------------

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
