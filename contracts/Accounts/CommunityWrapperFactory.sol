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

    /// @notice The contract address of the SocietyProtocolBadges ERC1155.
    address public badgeContract;
    /**
     * @notice The implementation contract address used as a template for new clones.
     * @dev This address is used by `Clones.clone` to create minimal proxies.
     */
    address public wrapperImplementation;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initializes the factory as a UUPS-upgradeable contract.
     * @param _badgeContract The address of the main Badge contract.
     * @param _wrapperImplementation The logic contract address to use for clones.
     * @param _owner The address that will own and manage the factory.
     */
    function initialize(
        address _badgeContract,
        address _wrapperImplementation,
        address _owner
    ) public initializer {
        __Ownable_init(_owner);
        __UUPSUpgradeable_init();

        require(_badgeContract != address(0), "Invalid badge contract");
        require(_wrapperImplementation.code.length > 0, "Implementation must be a contract");

        badgeContract = _badgeContract;
        wrapperImplementation = _wrapperImplementation;
    }

    /**
     * @notice Updates the logic contract used for future wrapper deployments.
     * @dev Does not affect already deployed wrappers (clones keep their original implementation logic).
     * @param _newImplementation The address of the new CommunityWrapper logic contract.
     */
    function setWrapperImplementation(
        address _newImplementation
    ) external onlyOwner {
        require(_newImplementation.code.length > 0, "Implementation must be a contract");
        wrapperImplementation = _newImplementation;
        emit ImplementationUpdated(_newImplementation);
    }

    /**
     * @notice Deploys a new, standalone CommunityWrapper using the EIP-1167 Clones pattern.
     * @param name The name for the new ERC20 wrapper.
     * @param symbol The symbol for the new ERC20 wrapper.
     * @param initialBadgeIds The set of badge IDs that will define membership for this community.
     * @return clone The address of the newly created wrapper proxy.
     */
    function createWrapper(
        string calldata name,
        string calldata symbol,
        uint256[] calldata initialBadgeIds,
        uint256 managerBadgeId
    ) external returns (address) {
        address clone = Clones.clone(wrapperImplementation);

        CommunityWrapper(clone).initialize(
            name,
            symbol,
            badgeContract,
            initialBadgeIds,
            managerBadgeId
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
