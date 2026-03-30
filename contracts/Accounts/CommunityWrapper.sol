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
    /// @notice The contract address of the SocietyProtocolBadges ERC1155.
    address public badgeContract;
    /**
     * @notice The list of badge IDs that a user must hold to have a balance in this wrapper.
     * @dev A user must hold at least one of each listed ID to be considered a "member".
     */
    uint256[] public allowedBadgeIds;
    /// @notice The maximum number of badge IDs that can be required for membership.
    uint256 public constant MAX_BADGES = 5;

    /// @notice Error thrown when trying to add more than MAX_BADGES to the requirement list.
    error MaxBadgesReached();
    /// @notice Error thrown when attempting to add a badge ID that is already in the list.
    error BadgeAlreadyAdded();
    /// @notice Error thrown when trying to remove a badge ID that is not in the requirement list.
    error BadgeNotFound();
    /// @notice Error thrown when a transfer is attempted (all transfers are disabled).
    error TransfersDisabled();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initializes the wrapper as a clone.
     * @param name The ERC20 name for this community wrapper (e.g., "Developer Community").
     * @param symbol The ERC20 symbol (e.g., "DEVC").
     * @param _badgeContract The address of the main Badge contract.
     * @param _initialBadgeIds The initial list of badge IDs required for membership.
     * @param _owner The address that will have administrative rights over this wrapper.
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
     * @notice Calculates the user's balance.
     * @dev Returns 1 if the account holds ALL required badges, 0 otherwise. 
     * This turns the ERC20 into a binary "proof of membership" token.
     * @param account The address to check membership for.
     * @return 1 for members, 0 for non-members.
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
     * @notice Adds a new badge ID to the membership requirement list.
     * @dev Only callable by the wrapper owner.
     * @param badgeId The new badge ID to require.
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
     * @notice Removes a badge ID from the membership requirement list.
     * @dev Only callable by the wrapper owner.
     * @param badgeId The badge ID to remove.
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
     * @notice Returns the array of current badge IDs required for membership.
     * @return An array of uint256 IDs.
     */
    function getAllowedBadgeIds() external view returns (uint256[] memory) {
        return allowedBadgeIds;
    }

    /**
     * @notice The total supply of this token is conceptually 0 as it's a dynamic wrapper.
     * @return Always 0.
     */
    function totalSupply() public pure override returns (uint256) {
        return 0;
    }

    /**
     * @notice This token is non-transferable.
     * @dev Always reverts with `TransfersDisabled`.
     */
    function transfer(address, uint256) public pure override returns (bool) {
        revert TransfersDisabled();
    }

    /**
     * @notice This token is non-transferable.
     * @dev Always reverts with `TransfersDisabled`.
     */
    function transferFrom(
        address,
        address,
        uint256
    ) public pure override returns (bool) {
        revert TransfersDisabled();
    }
}
