// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

contract SocietyProfiles {
    struct AccountProfile {
        string profileCid;   // IPFS/Arweave URI with bio + PFP + links
        address inviter;      // referral relation
        bytes32 didHash;      // keccak256 of DID string (optional)
        bool exists;
    }

    mapping(address => AccountProfile) public profiles;

    event ProfileCreated(address indexed user, address indexed inviter, string profileCid);
    event ProfileCidUpdated(address indexed user, string newCid);
    event DidHashUpdated(address indexed user, bytes32 newDidHash);

    function createProfile(
        string memory profileCid,
        bytes32 didHash,
        address inviter
    ) external {
        require(!profiles[msg.sender].exists, "Profile already exists");
        
        if (inviter != address(0)) {
            require(profiles[inviter].exists, "Inviter does not exist");
        }

        profiles[msg.sender] = AccountProfile({
            profileCid: profileCid,
            inviter: inviter,
            didHash: didHash,
            exists: true
        });

        emit ProfileCreated(msg.sender, inviter, profileCid);
    }

    function updateProfileCid(string memory newCid) external {
        require(profiles[msg.sender].exists, "Profile does not exist");
        profiles[msg.sender].profileCid = newCid;
        emit ProfileCidUpdated(msg.sender, newCid);
    }

    function updateDidHash(bytes32 newDidHash) external {
        require(profiles[msg.sender].exists, "Profile does not exist");
        profiles[msg.sender].didHash = newDidHash;
        emit DidHashUpdated(msg.sender, newDidHash);
    }

    function getProfile(address user) external view returns (AccountProfile memory) {
        return profiles[user];
    }
}
