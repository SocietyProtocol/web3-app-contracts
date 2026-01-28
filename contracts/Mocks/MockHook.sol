// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "../Accounts/ISocietyBadgeHook.sol";

contract MockHook is ISocietyBadgeHook {
    bool public allowMint;
    bool public allowTransfer;
    bool public allowBurn;

    constructor(bool _mint, bool _transfer, bool _burn) {
        allowMint = _mint;
        allowTransfer = _transfer;
        allowBurn = _burn;
    }

    function setPermissions(bool _mint, bool _transfer, bool _burn) external {
        allowMint = _mint;
        allowTransfer = _transfer;
        allowBurn = _burn;
    }

    function onCheckMint(
        address,
        address,
        uint256,
        uint256
    ) external view returns (bool) {
        return allowMint;
    }

    function onCheckTransfer(
        address,
        address,
        address,
        uint256,
        uint256
    ) external view returns (bool) {
        return allowTransfer;
    }

    function onCheckBurn(
        address,
        address,
        uint256,
        uint256
    ) external view returns (bool) {
        return allowBurn;
    }

    function onBalanceOf(address, uint256) external pure returns (uint256) {
        return 0;
    }
}
