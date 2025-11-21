// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import "./Transferability/ITransferabilityStrategy.sol";
import "./Transferability/SoulboundStrategy.sol";
import "./Transferability/TransferableStrategy.sol";

contract SocietyProtocolBadges is ERC1155, AccessControl, ERC1155Supply {
    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    struct BadgeInfo {
        string name;
        bool isOfficial;
        address strategy;
        string metadataURI;
    }

    mapping(uint256 => BadgeInfo) public badges;
    uint256 public nextTokenId;

    event BadgeCreated(uint256 indexed id, string name, bool isOfficial, address strategy);

    constructor() ERC1155("") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(GOVERNOR_ROLE, msg.sender);

        // Deploy default strategies
        SoulboundStrategy soulbound = new SoulboundStrategy();
        TransferableStrategy transferable = new TransferableStrategy();

        // Preconfigure 3 official badges
        // ID 1: Official Member (Soulbound)
        _createBadge("Official Member", true, address(soulbound), "ipfs://official-member");
        
        // ID 2: Community Partner (Transferable)
        _createBadge("Community Partner", true, address(transferable), "ipfs://community-partner");

        // ID 3: VIP Access (Soulbound)
        _createBadge("VIP Access", true, address(soulbound), "ipfs://vip-access");
    }

    function createBadge(
        string memory name,
        address strategy,
        string memory metadataURI
    ) external returns (uint256) {
        bool isOfficial;
        if (hasRole(GOVERNOR_ROLE, msg.sender)) {
            isOfficial = true;
        } else if (hasRole(MINTER_ROLE, msg.sender)) {
            isOfficial = false;
        } else {
            revert("Caller is not authorized to create badges");
        }

        return _createBadge(name, isOfficial, strategy, metadataURI);
    }

    function _createBadge(
        string memory name,
        bool isOfficial,
        address strategy,
        string memory metadataURI
    ) internal returns (uint256) {
        nextTokenId++;
        uint256 id = nextTokenId;

        badges[id] = BadgeInfo({
            name: name,
            isOfficial: isOfficial,
            strategy: strategy,
            metadataURI: metadataURI
        });

        emit BadgeCreated(id, name, isOfficial, strategy);
        return id;
    }

    function mint(
        address to,
        uint256 id,
        uint256 amount,
        bytes memory data
    ) public {
        require(id <= nextTokenId, "Badge does not exist");
        BadgeInfo memory badge = badges[id];
        
        // Only Governor can mint official badges
        if (badge.isOfficial) {
            require(hasRole(GOVERNOR_ROLE, msg.sender), "Only Governor can mint official badges");
        } else {
            // Minter role or badge creator logic could go here, for now restricted to MINTER_ROLE for simplicity
             require(hasRole(MINTER_ROLE, msg.sender) || hasRole(GOVERNOR_ROLE, msg.sender), "Not authorized to mint");
        }

        if (badge.strategy != address(0)) {
            require(ITransferabilityStrategy(badge.strategy).canMint(msg.sender, to, id, amount), "Minting not allowed by strategy");
        }

        _mint(to, id, amount, data);
    }

    function setURI(uint256 id, string memory newUri) external {
        require(hasRole(GOVERNOR_ROLE, msg.sender), "Only Governor can set URI");
        badges[id].metadataURI = newUri;
        emit URI(newUri, id);
    }

    function uri(uint256 id) public view override returns (string memory) {
        return badges[id].metadataURI;
    }

    function _update(
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory values
    ) internal override(ERC1155, ERC1155Supply) {
        for (uint256 i = 0; i < ids.length; i++) {
            uint256 id = ids[i];
            address strategy = badges[id].strategy;
            if (strategy != address(0)) {
                if (from == address(0)) {
                     // Minting checked in mint function, but double check here if needed or rely on hook
                } else if (to == address(0)) {
                    require(ITransferabilityStrategy(strategy).canBurn(msg.sender, from, id, values[i]), "Burning not allowed by strategy");
                } else {
                    require(ITransferabilityStrategy(strategy).canTransfer(msg.sender, from, to, id, values[i]), "Transfer not allowed by strategy");
                }
            }
        }
        super._update(from, to, ids, values);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC1155, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
