// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "./ISocietyBadgeHook.sol";
import "./SocietyProtocolBadges.sol";

contract SocietyVipManager is
    Initializable,
    OwnableUpgradeable,
    UUPSUpgradeable,
    ISocietyBadgeHook
{
    using SafeERC20 for IERC20;

    IERC20 public stakingToken;
    SocietyProtocolBadges public badgesContract;
    uint256 public governorBadgeId;

    uint256 public bronzeBadgeId;
    uint256 public silverBadgeId;
    uint256 public goldBadgeId;

    uint256 public bronzeAmount;
    uint256 public silverAmount;
    uint256 public goldAmount;

    uint256 public constant MIN_LOCK_DURATION = 30 days;

    struct LockInfo {
        uint256 amount;
        uint256 unlockTime;
    }

    mapping(address => LockInfo) public locks;

    error InsufficientAmount();
    error LockDurationTooShort();
    error LockStillActive();
    error NoTokensLocked();
    error InvalidBadgeId();

    event TokensLocked(
        address indexed user,
        uint256 amount,
        uint256 unlockTime
    );
    event TokensUnlocked(address indexed user, uint256 amount);
    event AmountsUpdated(uint256 bronze, uint256 silver, uint256 gold);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _stakingToken,
        address _badgesContract,
        uint256 _governorBadgeId
    ) public initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        stakingToken = IERC20(_stakingToken);
        badgesContract = SocietyProtocolBadges(_badgesContract);
        governorBadgeId = _governorBadgeId;

        bronzeAmount = 100e18;
        silverAmount = 1000e18;
        goldAmount = 10000e18;

        uint256[] memory govRules = new uint256[](1);
        govRules[0] = _governorBadgeId;

        address[] memory editors = new address[](1);
        editors[0] = owner();

        // Create badges (as community/non-official)
        bronzeBadgeId = _createVipBadge(
            "Bronze VIP",
            "ipfs://bronze",
            govRules,
            govRules,
            govRules,
            editors
        );
        silverBadgeId = _createVipBadge(
            "Silver VIP",
            "ipfs://silver",
            govRules,
            govRules,
            govRules,
            editors
        );
        goldBadgeId = _createVipBadge(
            "Gold VIP",
            "ipfs://gold",
            govRules,
            govRules,
            govRules,
            editors
        );
    }

    function _createVipBadge(
        string memory name,
        string memory uri,
        uint256[] memory minters,
        uint256[] memory transferers,
        uint256[] memory burners,
        address[] memory editors
    ) internal returns (uint256) {
        return
            badgesContract.createBadge(
                name,
                false, // Created non-official, updateable by owner
                false, // isCommunity = false
                address(this),
                uri,
                minters,
                transferers,
                burners,
                editors
            );
    }

    function setTierAmounts(
        uint256 _bronze,
        uint256 _silver,
        uint256 _gold
    ) external onlyOwner {
        bronzeAmount = _bronze;
        silverAmount = _silver;
        goldAmount = _gold;
        emit AmountsUpdated(_bronze, _silver, _gold);
    }

    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyOwner {}

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
            // New lock or old one expired
            userLock.amount += amount;
            userLock.unlockTime = block.timestamp + duration;
        }

        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        emit TokensLocked(msg.sender, amount, userLock.unlockTime);
    }

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

    function onCheckMint(
        address,
        address,
        uint256,
        uint256
    ) external pure returns (bool) {
        return false; // Dynamic badges aren't minted directly
    }

    function onCheckTransfer(
        address,
        address,
        address,
        uint256,
        uint256
    ) external pure returns (bool) {
        return false; // Dynamic badges aren't transferred
    }

    function onCheckBurn(
        address,
        address,
        uint256,
        uint256
    ) external pure returns (bool) {
        return false; // Dynamic badges aren't burned
    }

    function onBalanceOf(
        address account,
        uint256 id
    ) external view returns (uint256) {
        LockInfo storage userLock = locks[account];

        // If lock expired, balance is 0
        if (block.timestamp >= userLock.unlockTime || userLock.amount == 0) {
            return 0;
        }

        // Tier logic: only the highest tier badge is "held"
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
