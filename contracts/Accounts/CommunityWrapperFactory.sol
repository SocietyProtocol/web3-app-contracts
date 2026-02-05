// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "./CommunityWrapper.sol";

/**
 * @title CommunityWrapperFactory
 * @notice Factory to deploy CommunityWrapper contracts for different communities.
 */
contract CommunityWrapperFactory {
    event WrapperDeployed(
        address indexed wrapper,
        address indexed creator,
        string name,
        string symbol
    );

    address public immutable badgeContract;

    constructor(address _badgeContract) {
        require(_badgeContract != address(0), "Invalid badge contract");
        badgeContract = _badgeContract;
    }

    /**
     * @notice Deploys a new CommunityWrapper.
     * @param name ERC20 name for the wrapper.
     * @param symbol ERC20 symbol for the wrapper.
     * @param initialBadgeIds Initial list of required badge IDs.
     * @return Address of the newly deployed wrapper.
     */
    function createWrapper(
        string calldata name,
        string calldata symbol,
        uint256[] calldata initialBadgeIds
    ) external returns (address) {
        CommunityWrapper newWrapper = new CommunityWrapper(
            name,
            symbol,
            badgeContract,
            initialBadgeIds,
            msg.sender
        );
        emit WrapperDeployed(address(newWrapper), msg.sender, name, symbol);
        return address(newWrapper);
    }
}
