// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";

/**
 * @title CommunityWrapper
 * @notice A non-transferable ERC20 wrapper that returns a binary balance based on ERC1155 badge ownership.
 * @dev Balance is 1 if the user holds all required badges, 0 otherwise.
 * @dev This contract is designed to be used with the Clones pattern.
 */
contract CommunityWrapper is
    Initializable,
    ERC20Upgradeable,
    OwnableUpgradeable
{
    address public badgeContract;
    uint256[] public allowedBadgeIds;
    uint256 public constant MAX_BADGES = 5;

    error MaxBadgesReached();
    error BadgeAlreadyAdded();
    error BadgeNotFound();
    error TransfersDisabled();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initializes the wrapper.
     * @param name ERC20 name for the wrapper.
     * @param symbol ERC20 symbol for the wrapper.
     * @param _badgeContract Address of the ERC1155 badge contract.
     * @param _initialBadgeIds Initial list of required badge IDs.
     * @param _owner Address that will own the wrapper.
     */
    function initialize(
        string memory name,
        string memory symbol,
        address _badgeContract,
        uint256[] memory _initialBadgeIds,
        address _owner
    ) public initializer {
        __ERC20_init(name, symbol);
        __Ownable_init(_owner);

        require(_badgeContract != address(0), "Invalid badge contract");
        if (_initialBadgeIds.length > MAX_BADGES) revert MaxBadgesReached();

        badgeContract = _badgeContract;
        allowedBadgeIds = _initialBadgeIds;
    }

    /**
     * @notice Returns 1 if the account holds ALL required badges, 0 otherwise.
     */
    function balanceOf(address account) public view override returns (uint256) {
        uint256 length = allowedBadgeIds.length;
        if (length == 0) return 0;

        for (uint256 i = 0; i < length; i++) {
            if (
                IERC1155(badgeContract).balanceOf(
                    account,
                    allowedBadgeIds[i]
                ) == 0
            ) {
                return 0;
            }
        }
        return 1;
    }

    /**
     * @notice Adds a new required badge ID.
     * @dev Limited to MAX_BADGES.
     */
    function addBadgeId(uint256 badgeId) external onlyOwner {
        if (allowedBadgeIds.length >= MAX_BADGES) revert MaxBadgesReached();

        uint256 length = allowedBadgeIds.length;
        for (uint256 i = 0; i < length; i++) {
            if (allowedBadgeIds[i] == badgeId) revert BadgeAlreadyAdded();
        }

        allowedBadgeIds.push(badgeId);
    }

    /**
     * @notice Removes a required badge ID.
     */
    function removeBadgeId(uint256 badgeId) external onlyOwner {
        uint256 length = allowedBadgeIds.length;
        for (uint256 i = 0; i < length; i++) {
            if (allowedBadgeIds[i] == badgeId) {
                allowedBadgeIds[i] = allowedBadgeIds[length - 1];
                allowedBadgeIds.pop();
                return;
            }
        }
        revert BadgeNotFound();
    }

    /**
     * @notice Returns the list of required badge IDs.
     */
    function getAllowedBadgeIds() external view returns (uint256[] memory) {
        return allowedBadgeIds;
    }

    /**
     * @notice Always 0 as this is a wrapper.
     */
    function totalSupply() public pure override returns (uint256) {
        return 0;
    }

    /**
     * @notice Transfers are disabled for this wrapper.
     */
    function transfer(address, uint256) public pure override returns (bool) {
        revert TransfersDisabled();
    }

    /**
     * @notice Transfers are disabled for this wrapper.
     */
    function transferFrom(
        address,
        address,
        uint256
    ) public pure override returns (bool) {
        revert TransfersDisabled();
    }
}
