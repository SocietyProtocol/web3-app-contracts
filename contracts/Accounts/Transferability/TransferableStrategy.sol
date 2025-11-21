// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./ITransferabilityStrategy.sol";

contract TransferableStrategy is ITransferabilityStrategy {
    function canMint(
        address /*operator*/,
        address /*to*/,
        uint256 /*id*/,
        uint256 /*amount*/
    ) external pure override returns (bool) {
        return true;
    }

    function canTransfer(
        address /*operator*/,
        address /*from*/,
        address /*to*/,
        uint256 /*id*/,
        uint256 /*amount*/
    ) external pure override returns (bool) {
        return true;
    }

    function canBurn(
        address /*operator*/,
        address /*from*/,
        uint256 /*id*/,
        uint256 /*amount*/
    ) external pure override returns (bool) {
        return true;
    }
}
