// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";

/**
 * @title CommunityWrapper
 * @notice A non-transferable ERC20 wrapper that returns a cumulative balance based on ERC1155 badge ownership.
 * @dev Balance is the sum of the account's balances for all required badge IDs.
 * @dev This contract is designed to be used with the Clones pattern.
 */
contract CommunityWrapper is
    Initializable,
    ERC20Upgradeable
{
    /// @notice The contract address of the SocietyProtocolBadges ERC1155.
    address public badgeContract;
    /// @notice The badge ID that grants admin rights over this wrapper. Whoever holds it is the owner.
    uint256 public creatorBadgeId;
    /**
     * @notice The list of badge IDs that a user must hold to have a balance in this wrapper.
     * @dev A user must hold at least one of each listed ID to be considered a "member".
     */
    uint256[] public allowedBadgeIds;
    /// @notice The maximum number of badge IDs that can be required for membership.
    uint256 public constant MAX_BADGES = 5;

    /// @notice Caller does not hold the creator badge for this wrapper.
    error Unauthorized();
    /// @notice New badge list exceeds the MAX_BADGES cap.
    error MaxBadgesReached();
    /// @notice Error thrown when a transfer is attempted (all transfers are disabled).
    error TransfersDisabled();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    modifier onlyCreator() {
        if (IERC1155(badgeContract).balanceOf(msg.sender, creatorBadgeId) == 0) revert Unauthorized();
        _;
    }

    /**
     * @notice Initializes the wrapper as a clone.
     * @param name The ERC20 name for this community wrapper (e.g., "Developer Community").
     * @param symbol The ERC20 symbol (e.g., "DEVC").
     * @param _badgeContract The address of the main Badge contract.
     * @param _initialBadgeIds The initial list of badge IDs required for membership.
     * @param _creatorBadgeId The badge ID whose holder has admin rights. Ownership follows the badge.
     */
    function initialize(
        string memory name,
        string memory symbol,
        address _badgeContract,
        uint256[] memory _initialBadgeIds,
        uint256 _creatorBadgeId
    ) public initializer {
        __ERC20_init(name, symbol);

        require(_badgeContract != address(0), "Invalid badge contract");
        if (_initialBadgeIds.length > MAX_BADGES) revert MaxBadgesReached();

        badgeContract = _badgeContract;
        creatorBadgeId = _creatorBadgeId;

        // Deduplicate initial badge IDs
        for (uint256 i = 0; i < _initialBadgeIds.length; i++) {
            uint256 id = _initialBadgeIds[i];
            bool found = false;
            for (uint256 j = 0; j < allowedBadgeIds.length; j++) {
                if (allowedBadgeIds[j] == id) { found = true; break; }
            }
            if (!found) allowedBadgeIds.push(id);
        }
    }

    /**
     * @notice Replaces the entire membership badge list.
     * @dev Duplicates in the input are silently ignored. Only callable by the creator badge holder.
     * @param newBadgeIds The new set of badge IDs required for membership.
     */
    function setBadgeIds(uint256[] calldata newBadgeIds) external onlyCreator {
        if (newBadgeIds.length > MAX_BADGES) revert MaxBadgesReached();
        delete allowedBadgeIds;
        for (uint256 i = 0; i < newBadgeIds.length; i++) {
            uint256 id = newBadgeIds[i];
            bool found = false;
            for (uint256 j = 0; j < allowedBadgeIds.length; j++) {
                if (allowedBadgeIds[j] == id) { found = true; break; }
            }
            if (!found) allowedBadgeIds.push(id);
        }
    }

    /**
     * @notice Calculates the user's total balance.
     * @dev Returns the sum of the account's balances for all required badge IDs. 
     * Each individual badge held adds to the total balance of this wrapper.
     * @param account The address to check total badge balance for.
     * @return The combined balance across all required badges.
     */
    function balanceOf(address account) public view override returns (uint256) {
        uint256 total = 0;
        uint256 length = allowedBadgeIds.length;
        for (uint256 i = 0; i < length; i++) {
            total += IERC1155(badgeContract).balanceOf(account, allowedBadgeIds[i]);
        }
        return total;
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

    /**
     * @notice Approvals are disabled since transfers are disabled.
     * @dev Always reverts with `TransfersDisabled`.
     */
    function approve(address, uint256) public pure override returns (bool) {
        revert TransfersDisabled();
    }
}
