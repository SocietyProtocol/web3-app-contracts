// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract SPECToken is ERC20 {
    constructor() ERC20("Society Protocol", "SPEC") {
        _mint(msg.sender, 1_000_000_000 * 10 ** decimals());
    }
}
