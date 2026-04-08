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
 * @notice Manages VIP tiers (Bronze, Silver, Gold) via staking.
 * @dev Implements ISocietyBadgeHook to provide dynamic ownership of VIP badges based on locked amounts.
 */
contract SocietyVipManager is
    Initializable,
    OwnableUpgradeable,
    UUPSUpgradeable,
    ISocietyBadgeHook
{
    using SafeERC20 for IERC20;

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

    /**
     * @notice Emitted when tokens are locked by a user.
     * @param user The address of the user who locked tokens.
     * @param amount The amount of tokens locked.
     * @param unlockTime The timestamp when the lock will expire.
     */
    event TokensLocked(
        address indexed user,
        uint256 amount,
        uint256 unlockTime
    );
    /**
     * @notice Emitted when tokens are unlocked by a user.
     * @param user The address of the user who unlocked tokens.
     * @param amount The amount of tokens unlocked.
     */
    event TokensUnlocked(address indexed user, uint256 amount);
    /**
     * @notice Emitted when the staking amounts for tiers are updated by the owner.
     * @param bronze The new amount for the Bronze tier.
     * @param silver The new amount for the Silver tier.
     * @param gold The new amount for the Gold tier.
     */
    event AmountsUpdated(uint256 bronze, uint256 silver, uint256 gold);

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
        goldBadgeId = _goldBadgeId;

        bronzeAmount = _bronzeAmount;
        silverAmount = _silverAmount;
        goldAmount = _goldAmount;
    }

    /**
     * @notice Updates the required amounts for each VIP tier.
     * @dev Only callable by the contract owner.
     * @param _bronze The new Bronze tier required amount.
     * @param _silver The new Silver tier required amount.
     * @param _gold The new Gold tier required amount.
     */
    function setTierAmounts(
        uint256 _bronze,
        uint256 _silver,
        uint256 _gold
    ) external onlyOwner {
        if (_bronze == 0 || _silver < _bronze || _gold < _silver) revert InvalidTierAmounts();
        bronzeAmount = _bronze;
        silverAmount = _silver;
        goldAmount = _gold;
        emit AmountsUpdated(_bronze, _silver, _gold);
    }

    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyOwner {}

    /**
     * @notice Locks tokens into a VIP tier for a specified duration.
     * @dev Extends existing lock time if the new unlockTime is further in the future.
     * @param amount The amount of stakingToken to lock.
     * @param duration The duration for which the tokens will be locked.
     */
    function lock(uint256 amount, uint256 duration) external {
        if (amount < bronzeAmount) revert InsufficientAmount();
        if (duration < MIN_LOCK_DURATION) revert LockDurationTooShort();

        LockInfo storage userLock = locks[msg.sender];

        // If they already have a lock, they can add to it or extend it
        if (userLock.amount > 0 && block.timestamp < userLock.unlockTime) {
            // Adding to existing lock
            userLock.amount += amount;
            uint256 newUnlockTime = block.timestamp + duration;
            if (newUnlockTime > userLock.unlockTime) {
                userLock.unlockTime = newUnlockTime;
            }
        } else {
            // New lock or expired lock — start fresh, don't accumulate old expired tokens
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

    // --- ISocietyBadgeHook ---

    /**
     * @notice Implementation of `onCheckMint` for dynamic badges.
     * @dev VIP tier badges cannot be minted directly; they are earned by staking. Always returns false.
     */
    function onCheckMint(
        address,
        address,
        uint256,
        uint256
    ) external pure returns (bool) {
        return false;
    }

    /**
     * @notice Implementation of `onCheckTransfer` for dynamic badges.
     * @dev VIP tier badges are non-transferable. Always returns false.
     */
    function onCheckTransfer(
        address,
        address,
        address,
        uint256,
        uint256
    ) external pure returns (bool) {
        return false;
    }

    /**
     * @notice Implementation of `onCheckBurn` for dynamic badges.
     * @dev VIP tier badges are not burnable in the standard sense. Always returns false.
     */
    function onCheckBurn(
        address,
        address,
        uint256,
        uint256
    ) external pure returns (bool) {
        return false;
    }

    /**
     * @notice Implementation of `onBalanceOf` to determine tiered badge ownership.
     * @dev Returns 1 if the `account` has locked enough tokens for the tier and the lock hasn't expired.
     * @param account The address querying ownership.
     * @param id The badge ID assigned to the VIP tier.
     * @return 1 if the user owns the badge, 0 otherwise.
     */
    function onBalanceOf(
        address account,
        uint256 id
    ) external view returns (uint256) {
        LockInfo storage userLock = locks[account];

        // If lock expired, balance is 0
        if (block.timestamp >= userLock.unlockTime || userLock.amount == 0) {
            return 0;
        }

        // Tier logic: higher tier locks are inclusive of the lower ones.
        if (id == goldBadgeId) {
            return userLock.amount >= goldAmount ? 1 : 0;
        } else if (id == silverBadgeId) {
            return userLock.amount >= silverAmount ? 1 : 0;
        } else if (id == bronzeBadgeId) {
            return userLock.amount >= bronzeAmount ? 1 : 0;
        }

        return 0;
    }
}
