// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "./ISocietyBadgeHook.sol";

/**
 * @title Society VIP Manager
 * @notice Manages personal VIP tiers (Bronze, Silver, Gold) via staking, and community tiers via
 *         owner-granted time-limited grants.
 * @dev Implements ISocietyBadgeHook for personal VIP badges only.
 *      Community tiers are stored in a plain mapping and queried via getCommunityTier(communityId).
 *      To check whether a specific address holds a community tier, call getCommunityTier(communityId)
 *      and verify they hold the creator badge via badges.balanceOf(account, communityId) > 0.
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

    /**
     * @dev Struct to store user locking information.
     * @param amount The total amount of staking tokens locked by the user.
     * @param unlockTime The timestamp when the lock expires and tokens can be withdrawn.
     */
    struct LockInfo {
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
     */
    struct CommunityTierGrant {
        uint256 tierId;
        uint256 expiry;
    }

    /// @notice communityId (= creator badge ID) => active community tier grant.
    mapping(uint256 => CommunityTierGrant) public communityTiers;

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    /// @notice Error thrown when the staking amount is less than the bronze tier requirement.
    error InsufficientAmount();
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

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event TokensLocked(address indexed user, uint256 amount, uint256 unlockTime);
    event TokensUnlocked(address indexed user, uint256 amount);
    event AmountsUpdated(uint256 bronze, uint256 silver, uint256 gold);
    /// @notice Emitted when a community tier grant is created or overwritten.
    event CommunityTierGranted(uint256 indexed communityId, uint256 tierId, uint256 expiry);
    /// @notice Emitted when a community tier grant is revoked before expiry.
    event CommunityTierRevoked(uint256 indexed communityId);

    // -------------------------------------------------------------------------
    // Constructor / Initializer
    // -------------------------------------------------------------------------

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initializes the VIP Manager.
     * @param _stakingToken Address of the ERC20 token to use for staking.
     * @param _bronzeBadgeId ID of the pre-created Bronze VIP badge.
     * @param _silverBadgeId ID of the pre-created Silver VIP badge.
     * @param _goldBadgeId ID of the pre-created Gold VIP badge.
     * @param _bronzeAmount Minimum tokens required for Bronze tier.
     * @param _silverAmount Minimum tokens required for Silver tier (must be >= bronze).
     * @param _goldAmount Minimum tokens required for Gold tier (must be >= silver).
     */
    function initialize(
        address _stakingToken,
        uint256 _bronzeBadgeId,
        uint256 _silverBadgeId,
        uint256 _goldBadgeId,
        uint256 _bronzeAmount,
        uint256 _silverAmount,
        uint256 _goldAmount
    ) public initializer {
        if (_stakingToken == address(0)) revert InvalidAddress();
        if (_bronzeAmount == 0 || _silverAmount < _bronzeAmount || _goldAmount < _silverAmount)
            revert InvalidTierAmounts();

        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
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
     * @notice Locks tokens into a VIP tier for a specified duration.
     * @dev Extends existing lock time if the new unlockTime is further in the future.
     */
    function lock(uint256 amount, uint256 duration) external {
        if (amount < bronzeAmount) revert InsufficientAmount();
        if (duration < MIN_LOCK_DURATION) revert LockDurationTooShort();

        LockInfo storage userLock = locks[msg.sender];

        if (userLock.amount > 0 && block.timestamp < userLock.unlockTime) {
            userLock.amount += amount;
            uint256 newUnlockTime = block.timestamp + duration;
            if (newUnlockTime > userLock.unlockTime) {
                userLock.unlockTime = newUnlockTime;
            }
        } else {
            // New lock or expired lock — start fresh
            userLock.amount = amount;
            userLock.unlockTime = block.timestamp + duration;
        }

        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        emit TokensLocked(msg.sender, amount, userLock.unlockTime);
    }

    /**
     * @notice Withdraws all locked tokens after the lock period has expired.
     */
    function unlock() external {
        LockInfo storage userLock = locks[msg.sender];
        if (userLock.amount == 0) revert NoTokensLocked();
        if (block.timestamp < userLock.unlockTime) revert LockStillActive();

        uint256 amount = userLock.amount;
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
     *      Community tier ownership is not expressed as an ERC1155 badge balance — use
     *      getCommunityTier(communityId) to read the tier and verify creator-badge ownership
     *      separately via badges.balanceOf(account, communityId) > 0.
     * @param communityId The community's identifier (= creator badge ID).
     * @param tierId An identifier for the tier level (e.g. 1 = Bronze, 2 = Silver, 3 = Gold).
     * @param duration Duration in seconds before the tier expires.
     */
    function grantCommunityTier(
        uint256 communityId,
        uint256 tierId,
        uint256 duration
    ) external onlyOwner {
        if (tierId == 0) revert InvalidTierAmounts();
        if (duration == 0) revert LockDurationTooShort();

        uint256 expiry = block.timestamp + duration;
        communityTiers[communityId] = CommunityTierGrant({ tierId: tierId, expiry: expiry });
        emit CommunityTierGranted(communityId, tierId, expiry);
    }

    /**
     * @notice Revokes an active community tier grant immediately.
     * @dev No-ops silently if the community has no active grant.
     * @param communityId The community whose tier is being revoked.
     */
    function revokeCommunityTier(uint256 communityId) external onlyOwner {
        if (communityTiers[communityId].expiry == 0) return;
        delete communityTiers[communityId];
        emit CommunityTierRevoked(communityId);
    }

    /**
     * @notice Returns the active community tier for a given community.
     * @dev Returns (0, 0) if the community has no grant or the grant has expired.
     *      Pair with badges.balanceOf(account, communityId) > 0 to confirm the queried
     *      address currently holds the creator badge.
     * @param communityId The community to query (= creator badge ID).
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
     * @dev Community tier badges are not routed through this hook — use getCommunityTier instead.
     */
    function onBalanceOf(address account, uint256 id) external view returns (uint256) {
        LockInfo storage userLock = locks[account];
        if (block.timestamp >= userLock.unlockTime || userLock.amount == 0) return 0;

        if (id == goldBadgeId)   return userLock.amount >= goldAmount   ? 1 : 0;
        if (id == silverBadgeId) return userLock.amount >= silverAmount ? 1 : 0;
        if (id == bronzeBadgeId) return userLock.amount >= bronzeAmount ? 1 : 0;

        return 0;
    }

    // -------------------------------------------------------------------------
    // Admin
    // -------------------------------------------------------------------------

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
