// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";

contract SocietyProtocolBadges is ERC1155, AccessControl, ERC1155Supply {
    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    struct BadgeInfo {
        string name;
        bool isOfficial;
        string metadataURI;
    }

    mapping(uint256 => BadgeInfo) public badges;
    
    // badgeId => operator => allowed
    mapping(uint256 => mapping(address => bool)) public canMint;
    mapping(uint256 => mapping(address => bool)) public canTransfer;
    mapping(uint256 => mapping(address => bool)) public canBurn;

    uint256 public nextTokenId;

    event BadgeCreated(uint256 indexed id, string name, bool isOfficial);
    event PermissionsUpdated(uint256 indexed id, address indexed operator, bool mint, bool transfer, bool burn);

    constructor() ERC1155("") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(GOVERNOR_ROLE, msg.sender);

        // Preconfigure 3 official badges
        // ID 1: Official Member (Soulbound - only Governor can mint/burn)
        address[] memory governors = new address[](1);
        governors[0] = msg.sender;
        _createBadge("Official Member", true, "ipfs://official-member", governors, new address[](0), governors);
        
        // ID 2: Community Partner (Transferable - Governor mints, everyone transfers?)
        // Note: For "everyone transfers", we might need a special flag or address(0) logic, 
        // but for now let's just allow Governor to transfer to demonstrate logic.
        // Or better, let's say Governor can mint, and Governor can transfer.
        // If we want "everyone" we need to handle that. 
        // The user said "WHO can transfer". 
        // Let's assume for now explicit whitelist.
        _createBadge("Community Partner", true, "ipfs://community-partner", governors, governors, governors);

        // ID 3: VIP Access (Soulbound)
        _createBadge("VIP Access", true, "ipfs://vip-access", governors, new address[](0), governors);
    }

    function createBadge(
        string memory name,
        string memory metadataURI,
        address[] memory minters,
        address[] memory transferers,
        address[] memory burners
    ) external returns (uint256) {
        bool isOfficial;
        if (hasRole(GOVERNOR_ROLE, msg.sender)) {
            isOfficial = true;
        } else if (hasRole(MINTER_ROLE, msg.sender)) {
            isOfficial = false;
        } else {
            revert("Caller is not authorized to create badges");
        }

        return _createBadge(name, isOfficial, metadataURI, minters, transferers, burners);
    }

    function _createBadge(
        string memory name,
        bool isOfficial,
        string memory metadataURI,
        address[] memory minters,
        address[] memory transferers,
        address[] memory burners
    ) internal returns (uint256) {
        nextTokenId++;
        uint256 id = nextTokenId;

        badges[id] = BadgeInfo({
            name: name,
            isOfficial: isOfficial,
            metadataURI: metadataURI
        });

        for (uint256 i = 0; i < minters.length; i++) {
            canMint[id][minters[i]] = true;
            emit PermissionsUpdated(id, minters[i], true, false, false);
        }
        for (uint256 i = 0; i < transferers.length; i++) {
            canTransfer[id][transferers[i]] = true;
            emit PermissionsUpdated(id, transferers[i], false, true, false);
        }
        for (uint256 i = 0; i < burners.length; i++) {
            canBurn[id][burners[i]] = true;
            emit PermissionsUpdated(id, burners[i], false, false, true);
        }

        emit BadgeCreated(id, name, isOfficial);
        return id;
    }

    function mint(
        address to,
        uint256 id,
        uint256 amount,
        bytes memory data
    ) public {
        require(id <= nextTokenId, "Badge does not exist");
        // Permission check is done in _update
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
            if (from == address(0)) {
                require(canMint[id][msg.sender], "Not authorized to mint");
            } else if (to == address(0)) {
                require(canBurn[id][msg.sender], "Not authorized to burn");
            } else {
                require(canTransfer[id][msg.sender], "Not authorized to transfer");
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
