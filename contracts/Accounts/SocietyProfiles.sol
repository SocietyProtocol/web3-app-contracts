// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

contract SocietyProfiles {
    struct Profile {
        string pfp;
        string bio;
        string did;
        address referrer;
        bool isVerified;
        bool exists;
    }

    mapping(address => Profile) public profiles;

    event ProfileCreated(address indexed user, address indexed referrer);
    event BioUpdated(address indexed user, string newBio);
    event PfpUpdated(address indexed user, string newPfp);
    event DidUpdated(address indexed user, string newDid);

    function createProfile(
        string memory pfp,
        string memory bio,
        string memory did,
        address referrer
    ) external {
        require(!profiles[msg.sender].exists, "Profile already exists");
        
        if (referrer != address(0)) {
            require(profiles[referrer].exists, "Referrer does not exist");
        }

        profiles[msg.sender] = Profile({
            pfp: pfp,
            bio: bio,
            did: did,
            referrer: referrer,
            isVerified: false, // Verification logic can be added later
            exists: true
        });

        emit ProfileCreated(msg.sender, referrer);
    }

    function updateBio(string memory newBio) external {
        require(profiles[msg.sender].exists, "Profile does not exist");
        profiles[msg.sender].bio = newBio;
        emit BioUpdated(msg.sender, newBio);
    }

    function updatePfp(string memory newPfp) external {
        require(profiles[msg.sender].exists, "Profile does not exist");
        profiles[msg.sender].pfp = newPfp;
        emit PfpUpdated(msg.sender, newPfp);
    }

    function updateDid(string memory newDid) external {
        require(profiles[msg.sender].exists, "Profile does not exist");
        profiles[msg.sender].did = newDid;
        emit DidUpdated(msg.sender, newDid);
    }

    function getProfile(address user) external view returns (Profile memory) {
        return profiles[user];
    }
}
