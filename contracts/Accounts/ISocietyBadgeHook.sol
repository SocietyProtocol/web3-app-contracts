// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title ISocietyBadgeHook
 * @notice Interface for custom logic hooks used by the SocietyProtocolBadges contract.
 * @dev Contracts implementing this interface can control minting, transferring, burning, and balance reporting for specific badges.
 */
interface ISocietyBadgeHook {
    /**
     * @notice Called before a badge is minted to evaluate if the operation should be allowed.
     * @param operator The address initiating the minting.
     * @param to The recipient of the new tokens.
     * @param id The badge ID being minted.
     * @param amount The quantity of tokens being minted.
     * @return True if the minting is authorized, false otherwise.
     */
    function onCheckMint(
        address operator,
        address to,
        uint256 id,
        uint256 amount
    ) external view returns (bool);

    /**
     * @notice Called before a badge is transferred between addresses.
     * @param operator The address initiating the transfer.
     * @param from The current holder of the tokens.
     * @param to The recipient of the tokens.
     * @param id The badge ID being transferred.
     * @param amount The quantity of tokens being transferred.
     * @return True if the transfer is authorized, false otherwise.
     */
    function onCheckTransfer(
        address operator,
        address from,
        address to,
        uint256 id,
        uint256 amount
    ) external view returns (bool);

    /**
     * @notice Called before tokens are burned from an account.
     * @param operator The address initiating the burn.
     * @param from The account from which tokens will be burned.
     * @param id The badge ID being burned.
     * @param amount The quantity of tokens being burned.
     * @return True if the burn is authorized, false otherwise.
     */
    function onCheckBurn(
        address operator,
        address from,
        uint256 id,
        uint256 amount
    ) external view returns (bool);

    /**
     * @notice Provides a dynamic balance for a specific badge ID and account.
     * @dev This allows for "virtual" badges that depend on other state (e.g., staking, governance, or external data).
     * @param account The address whose balance is being queried.
     * @param id The badge ID in question.
     * @return The effective balance of the badge for this account.
     */
    function onBalanceOf(
        address account,
        uint256 id
    ) external view returns (uint256);
}
