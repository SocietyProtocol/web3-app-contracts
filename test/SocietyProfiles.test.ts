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
            await profiles.connect(user1).createProfile("pfp_url", "bio_text", "did:eth:123", ethers.ZeroAddress);
            const profile = await profiles.getProfile(user1.address);
            expect(profile.pfp).to.equal("pfp_url");
            expect(profile.bio).to.equal("bio_text");
            expect(profile.exists).to.be.true;
        });

        it("Should fail if referrer does not exist", async function () {
            await expect(
                profiles.connect(user1).createProfile("pfp", "bio", "did", user2.address)
            ).to.be.revertedWith("Referrer does not exist");
        });

        it("Should create profile with valid referrer", async function () {
            await profiles.connect(user1).createProfile("pfp1", "bio1", "did1", ethers.ZeroAddress);
            await profiles.connect(user2).createProfile("pfp2", "bio2", "did2", user1.address);

            const profile = await profiles.getProfile(user2.address);
            expect(profile.referrer).to.equal(user1.address);
        });
    });
});
