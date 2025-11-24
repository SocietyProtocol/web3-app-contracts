import { expect } from "chai";
import { ethers } from "hardhat";
import { SocietyProfiles } from "../typechain-types";

describe("Society Profiles", function () {
    let profiles: SocietyProfiles;
    let owner: any;
    let user1: any;
    let user2: any;

    beforeEach(async function () {
        [owner, user1, user2] = await ethers.getSigners();

        // Deploy Profiles
        const Profiles = await ethers.getContractFactory("SocietyProfiles");
        profiles = await Profiles.deploy();
        await profiles.waitForDeployment();
    });

    describe("Profiles", function () {
        it("Should create a profile", async function () {
            const didHash = ethers.keccak256(ethers.toUtf8Bytes("did:eth:123"));
            await profiles.connect(user1).createProfile("ipfs://profile-cid", didHash, ethers.ZeroAddress);
            const profile = await profiles.getProfile(user1.address);
            expect(profile.profileCid).to.equal("ipfs://profile-cid");
            expect(profile.didHash).to.equal(didHash);
            expect(profile.exists).to.be.true;
        });

        it("Should fail if inviter does not exist", async function () {
            const didHash = ethers.keccak256(ethers.toUtf8Bytes("did:eth:123"));
            await expect(
                profiles.connect(user1).createProfile("ipfs://profile-cid", didHash, user2.address)
            ).to.be.revertedWith("Inviter does not exist");
        });

        it("Should create profile with valid inviter", async function () {
            const didHash1 = ethers.keccak256(ethers.toUtf8Bytes("did:eth:1"));
            const didHash2 = ethers.keccak256(ethers.toUtf8Bytes("did:eth:2"));

            await profiles.connect(user1).createProfile("ipfs://p1", didHash1, ethers.ZeroAddress);
            await profiles.connect(user2).createProfile("ipfs://p2", didHash2, user1.address);

            const profile = await profiles.getProfile(user2.address);
            expect(profile.inviter).to.equal(user1.address);
        });

        it("Should update profile CID", async function () {
            const didHash = ethers.keccak256(ethers.toUtf8Bytes("did:eth:123"));
            await profiles.connect(user1).createProfile("ipfs://old", didHash, ethers.ZeroAddress);
            await profiles.connect(user1).updateProfileCid("ipfs://new");

            const profile = await profiles.getProfile(user1.address);
            expect(profile.profileCid).to.equal("ipfs://new");
        });
    });
});
