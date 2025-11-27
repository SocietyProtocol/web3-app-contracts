// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface ISocietyBadgeHook {
    function onCheckMint(
        address operator,
        address to,
        uint256 id,
        uint256 amount
    ) external view returns (bool);

    function onCheckTransfer(
        address operator,
        address from,
        address to,
        uint256 id,
        uint256 amount
    ) external view returns (bool);

    function onCheckBurn(
        address operator,
        address from,
        uint256 id,
        uint256 amount
    ) external view returns (bool);
}
