// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165.sol";

interface IBadgesForReentrant {
    function createProfile(string calldata metadataURI) external returns (uint256);
    function mint(address to, uint256 id, uint256 amount, bytes calldata data) external;
}

/// @dev Test helper: attempts to mint an extra profile badge inside the ERC1155 callback.
contract MockReentrantProfileReceiver is IERC1155Receiver, ERC165 {
    IBadgesForReentrant public immutable badges;

    bool public reentryAttempted;
    bool public reentrySucceeded;

    constructor(address _badges) {
        badges = IBadgesForReentrant(_badges);
    }

    /// @notice Called by the test to initiate profile creation from this contract.
    function createProfile(string calldata uri) external returns (uint256) {
        return badges.createProfile(uri);
    }

    function onERC1155Received(
        address,
        address,
        uint256 id,
        uint256,
        bytes calldata
    ) external override returns (bytes4) {
        reentryAttempted = true;
        // Try to mint one extra copy of the just-created profile badge.
        // This should be blocked by _profileMintLocked / ProfileMustBeUnique.
        try badges.mint(address(this), id, 1, "") {
            reentrySucceeded = true;
        } catch {
            reentrySucceeded = false;
        }
        return IERC1155Receiver.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(
        address,
        address,
        uint256[] calldata,
        uint256[] calldata,
        bytes calldata
    ) external pure override returns (bytes4) {
        return IERC1155Receiver.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC165, IERC165)
        returns (bool)
    {
        return
            interfaceId == type(IERC1155Receiver).interfaceId ||
            super.supportsInterface(interfaceId);
    }
}
