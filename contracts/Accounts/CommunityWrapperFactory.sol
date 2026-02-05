// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "./CommunityWrapper.sol";

/**
 * @title CommunityWrapperFactory
 * @notice Factory to deploy CommunityWrapper contracts for different communities using Clones.
 * @dev This contract is upgradeable via UUPS.
 */
contract CommunityWrapperFactory is
    Initializable,
    OwnableUpgradeable,
    UUPSUpgradeable
{
    event WrapperDeployed(
        address indexed wrapper,
        address indexed creator,
        string name,
        string symbol,
        address implementation
    );
    event ImplementationUpdated(address indexed newImplementation);

    address public badgeContract;
    address public wrapperImplementation;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initializes the factory.
     * @param _badgeContract Address of the ERC1155 badge contract.
     * @param _wrapperImplementation Initial implementation address for wrappers.
     * @param _owner Owner of the factory.
     */
    function initialize(
        address _badgeContract,
        address _wrapperImplementation,
        address _owner
    ) public initializer {
        __Ownable_init(_owner);
        __UUPSUpgradeable_init();

        require(_badgeContract != address(0), "Invalid badge contract");
        require(_wrapperImplementation != address(0), "Invalid implementation");

        badgeContract = _badgeContract;
        wrapperImplementation = _wrapperImplementation;
    }

    /**
     * @notice Updates the wrapper implementation for new deployments.
     * @param _newImplementation The new logic contract address.
     */
    function setWrapperImplementation(
        address _newImplementation
    ) external onlyOwner {
        require(_newImplementation != address(0), "Invalid implementation");
        wrapperImplementation = _newImplementation;
        emit ImplementationUpdated(_newImplementation);
    }

    /**
     * @notice Deploys a new CommunityWrapper using Clones.
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
        address clone = Clones.clone(wrapperImplementation);

        CommunityWrapper(clone).initialize(
            name,
            symbol,
            badgeContract,
            initialBadgeIds,
            msg.sender
        );

        emit WrapperDeployed(
            clone,
            msg.sender,
            name,
            symbol,
            wrapperImplementation
        );
        return clone;
    }

    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyOwner {}
}
