import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SocietyProtocolBadges, MockHook } from "../typechain-types";

describe("Society Protocol Badges (Upgradeable)", function () {
    let badges: SocietyProtocolBadges;
    let hook: MockHook;
    let owner: any;
    let minter: any;
    let user1: any;
    let user2: any;

    beforeEach(async function () {
        [owner, minter, user1, user2] = await ethers.getSigners();

        // Deploy Badges via Proxy
        const Badges = await ethers.getContractFactory("SocietyProtocolBadges");
        badges = (await upgrades.deployProxy(Badges, [], { initializer: 'initialize' })) as unknown as SocietyProtocolBadges;
        await badges.waitForDeployment();

        // Grant MINTER_ROLE
        const MINTER_ROLE = await badges.MINTER_ROLE();
        await badges.grantRole(MINTER_ROLE, minter.address);

        // Deploy Mock Hook
        const Hook = await ethers.getContractFactory("MockHook");
        hook = await Hook.deploy(true, true, true);
        await hook.waitForDeployment();
    });

    describe("Initialization", function () {
        it("Should initialize with correct roles", async function () {
            expect(await badges.hasRole(await badges.GOVERNOR_ROLE(), owner.address)).to.be.true;
        });
    });

    describe("Badge Creation", function () {
        it("Governor should be able to create official badges", async function () {
            await badges.createOfficialBadge(
                "Official Badge",
                "ipfs://official",
                [owner.address],
                [],
                []
            );
            const id = 1;
            const badge = await badges.badges(id);
            expect(badge.name).to.equal("Official Badge");
            expect(badge.isOfficial).to.be.true;
        });

        it("Minter should be able to create community badges", async function () {
            await badges.connect(minter).createCommunityBadge(
                "Community Badge",
                "ipfs://community",
                [minter.address],
                [],
                []
            );
            const id = 1;
            const badge = await badges.badges(id);
            expect(badge.name).to.equal("Community Badge");
            expect(badge.isOfficial).to.be.false;
        });

        it("Minter should NOT be able to create official badges", async function () {
            await expect(
                badges.connect(minter).createOfficialBadge("Fail", "ipfs://fail", [], [], [])
            ).to.be.revertedWithCustomError(badges, "AccessControlUnauthorizedAccount"); // AccessControl revert (still string or custom depending on OZ version, usually AccessControlUnauthorizedAccount)
        });

        it("Non-minter should NOT be able to create community badges", async function () {
            await expect(
                badges.connect(user1).createCommunityBadge("Fail", "ipfs://fail", [], [], [])
            ).to.be.revertedWithCustomError(badges, "AccessControlUnauthorizedAccount"); // AccessControl
        });
    });

    describe("Profiles", function () {
        it("Should create a profile (Unique NFT)", async function () {
            await badges.connect(user1).createProfile("ipfs://profile");
            const id = 1; // First token since no preconfigured badges

            expect(await badges.balanceOf(user1.address, id)).to.equal(1);
            expect(await badges.uri(id)).to.equal("ipfs://profile");
            expect(await badges.userProfileId(user1.address)).to.equal(id);
        });

        it("Should NOT allow multiple profiles per user", async function () {
            await badges.connect(user1).createProfile("ipfs://profile1");
            await expect(
                badges.connect(user1).createProfile("ipfs://profile2")
            ).to.be.revertedWithCustomError(badges, "ProfileAlreadyExists");
        });

        it("Owner should be able to update profile URI", async function () {
            await badges.connect(user1).createProfile("ipfs://old");
            const id = 1;

            await badges.connect(user1).updateProfileURI(id, "ipfs://new");
            expect(await badges.uri(id)).to.equal("ipfs://new");
        });

        it("Non-owner should NOT be able to update profile URI", async function () {
            await badges.connect(user1).createProfile("ipfs://old");
            const id = 1;

            await expect(
                badges.connect(user2).updateProfileURI(id, "ipfs://hack")
            ).to.be.revertedWithCustomError(badges, "NotProfileOwner");
        });
    });

    describe("Hooks", function () {
        it("Should use Hook priority over mappings", async function () {
            // Create badge with NO internal permissions
            await badges.createOfficialBadge("Hooked Badge", "ipfs://hooked", [], [], []);
            const id = 1;

            // Set Hook
            await badges.setBadgeHook(id, await hook.getAddress());

            // Hook allows mint (default true) -> Should succeed even if internal mapping is false
            await badges.mint(user1.address, id, 1, "0x");
            expect(await badges.balanceOf(user1.address, id)).to.equal(1);

            // Update Hook to deny transfer
            await hook.setPermissions(true, false, true);

            // Try transfer -> Should fail
            await expect(
                badges.connect(user1).safeTransferFrom(user1.address, user2.address, id, 1, "0x")
            ).to.be.revertedWithCustomError(badges, "TransferDeniedByHook");
        });
    });

    describe("Upgradeability", function () {
        it("Should be upgradeable by Governor", async function () {
            const BadgesV2 = await ethers.getContractFactory("SocietyProtocolBadges");
            await upgrades.upgradeProxy(await badges.getAddress(), BadgesV2);
        });

        it("Should NOT be upgradeable by non-Governor", async function () {
            const BadgesV2 = await ethers.getContractFactory("SocietyProtocolBadges", user1);
            await expect(
                upgrades.upgradeProxy(await badges.getAddress(), BadgesV2)
            ).to.be.reverted; // AccessControl revert
        });
    });
});
