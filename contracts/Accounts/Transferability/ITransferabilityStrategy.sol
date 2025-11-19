// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ITransferabilityStrategy {
    function canMint(
        address operator,
        address to,
        uint256 id,
        uint256 amount
    ) external view returns (bool);

    function canTransfer(
        address operator,
        address from,
        address to,
        uint256 id,
        uint256 amount
    ) external view returns (bool);

    function canBurn(
        address operator,
        address from,
        uint256 id,
        uint256 amount
    ) external view returns (bool);
}
