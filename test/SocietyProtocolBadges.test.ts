import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SocietyProtocolBadges, MockHook } from "../typechain-types";

const PERM_NONE = 0n;
const PERM_SELF = 1n;
const PERM_EVERYONE = 2n;
const STARTING_BADGE_ID = 10n;

describe("Society Protocol Badges (Upgradeable) - Refactored", function () {
    let badges: SocietyProtocolBadges;
    let hook: MockHook;
    let owner: any;
    let creator: any;
    let upgrader: any;
    let user1: any;
    let user2: any;

    beforeEach(async function () {
        [owner, creator, upgrader, user1, user2] = await ethers.getSigners();

        // Deploy Badges via Proxy
        const Badges = await ethers.getContractFactory("SocietyProtocolBadges");
        badges = (await upgrades.deployProxy(Badges, [], { initializer: 'initialize' })) as unknown as SocietyProtocolBadges;
        await badges.waitForDeployment();

        // Setup Roles
        const OFFICIAL_CREATOR_ROLE = await badges.OFFICIAL_BADGE_CREATOR_ROLE();
        const UPGRADER_ROLE = await badges.CONTRACT_UPGRADER_ROLE();

        // Grant roles to other accounts
        await badges.grantRole(OFFICIAL_CREATOR_ROLE, creator.address);
        await badges.grantRole(UPGRADER_ROLE, upgrader.address);

        // Deploy Mock Hook
        const Hook = await ethers.getContractFactory("MockHook");
        hook = await Hook.deploy(true, true, true);
        await hook.waitForDeployment();
    });

    describe("Initialization", function () {
        it("Should initialize with correct roles", async function () {
            expect(await badges.hasRole(await badges.OFFICIAL_BADGE_CREATOR_ROLE(), owner.address)).to.be.true;
            expect(await badges.hasRole(await badges.CONTRACT_UPGRADER_ROLE(), owner.address)).to.be.true;
            expect(await badges.nextTokenId()).to.equal(STARTING_BADGE_ID);
        });
    });

    describe("Badge Creation", function () {
        it("Official Creator should be able to create official badges", async function () {
            await badges.connect(creator).createBadge(
                "Official Badge",
                true,
                false,
                "ipfs://official",
                [PERM_EVERYONE], // Mint
                [PERM_EVERYONE], // Transfer
                [PERM_EVERYONE],  // Burn
                [creator.address] // Editors
            );
            const id = STARTING_BADGE_ID + 1n;
            const badge = await badges.badges(id);
            expect(badge.name).to.equal("Official Badge");
            expect(badge.isOfficial).to.be.true;

            const mintRule = await badges.canMint(id, 0);
            expect(mintRule).to.equal(PERM_EVERYONE);

            expect(await badges.canEdit(id, creator.address)).to.be.true;
        });

        it("Anyone should be able to create community badges", async function () {
            await badges.connect(user1).createBadge(
                "Public Badge",
                false,
                true,
                "ipfs://public",
                [], [], [], [user1.address]
            );
            const id = STARTING_BADGE_ID + 1n;
            const badge = await badges.badges(id);
            expect(badge.name).to.equal("Public Badge");
            expect(badge.isOfficial).to.be.false;
        });

        it("Non-official creator should NOT be able to create official badges", async function () {
            await expect(
                badges.connect(user1).createBadge("Fail", true, false, "ipfs://fail", [], [], [], [])
            ).to.be.revertedWithCustomError(badges, "AccessControlUnauthorizedAccount");
        });
    });

    describe("Permissions Logic (Badge-Gating)", function () {
        let authBadgeId: bigint;
        let gatedBadgeId: bigint;

        beforeEach(async function () {
            // Create an "Auth" badge that everyone can mint freely
            await badges.createBadge("Auth Badge", false, false, "ipfs://auth", [PERM_EVERYONE], [PERM_EVERYONE], [], [owner.address]);
            authBadgeId = STARTING_BADGE_ID + 1n;

            // Create a "Gated" badge that requires holding "Auth Badge" to mint
            await badges.createBadge("Gated Badge", false, false, "ipfs://gated", [authBadgeId], [PERM_EVERYONE], [], [owner.address]);
            gatedBadgeId = STARTING_BADGE_ID + 2n;
        });

        it("Should allow minting if user holds required badge", async function () {
            // User1 mints Auth badge
            await badges.connect(user1).mint(user1.address, authBadgeId, 1, "0x");
            expect(await badges.balanceOf(user1.address, authBadgeId)).to.equal(1n);

            // User1 tries to mint Gated badge -> Should succeed
            await badges.connect(user1).mint(user1.address, gatedBadgeId, 1, "0x");
            expect(await badges.balanceOf(user1.address, gatedBadgeId)).to.equal(1n);
        });

        it("Should DENY minting if user does not hold required badge", async function () {
            // User2 has no Auth badge
            // User2 tries to mint Gated badge -> Should fail
            await expect(
                badges.connect(user2).mint(user2.address, gatedBadgeId, 1, "0x")
            ).to.be.revertedWithCustomError(badges, "MintNotAuthorized");
        });

        it("Should allow actions with PERM_EVERYONE", async function () {
            // Auth badge has PERM_EVERYONE for minting
            await badges.connect(user2).mint(user2.address, authBadgeId, 1, "0x");
            expect(await badges.balanceOf(user2.address, authBadgeId)).to.equal(1);
        });
    });

    describe("Modifications & Editors", function () {
        let badgeId: bigint;

        beforeEach(async function () {
            await badges.connect(creator).createBadge("Editable", false, false, "ipfs://edit", [], [], [], [creator.address]);
            badgeId = STARTING_BADGE_ID + 1n;
        });

        it("Editor should be able to modify badge", async function () {
            await badges.connect(creator).modifyBadge(badgeId, "Edited", true, true, "ipfs://new");
            const badge = await badges.badges(badgeId);
            expect(badge.name).to.equal("Edited");
            expect(badge.isOfficial).to.be.true;
        });

        it("Non-editor should NOT be able to modify badge", async function () {
            await expect(
                badges.connect(user1).modifyBadge(badgeId, "Hacked", false, false, "ipfs://hacked")
            ).to.be.revertedWithCustomError(badges, "Unauthorized");
        });

        it("Editor should be able to set URI", async function () {
            await badges.connect(creator).setURI(badgeId, "ipfs://uri-updated");
            expect(await badges.uri(badgeId)).to.equal("ipfs://uri-updated");
        });
    });

    describe("Getters & Events", function () {
        it("Should emit BadgePermissions event on badge creation", async function () {
            const id = STARTING_BADGE_ID + 1n;
            const minters = [PERM_EVERYONE];
            const transferers = [STARTING_BADGE_ID];
            const burners = [] as bigint[];
            const editors = [creator.address, user1.address];

            const tx = await badges.connect(creator).createBadge(
                "Test Badge",
                true,
                false,
                "ipfs://test",
                minters,
                transferers,
                burners,
                editors
            );

            const receipt = await tx.wait();
            const event = receipt?.logs.find(
                (log) => {
                    try {
                        return badges.interface.parseLog(log)?.name === "BadgePermissions"
                    } catch (e) {
                        return false;
                    }
                }
            );

            expect(event).to.not.be.undefined;
            const parsedLog = badges.interface.parseLog(event!);
            expect(parsedLog?.args.id).to.equal(id);
            expect(parsedLog?.args.minters).to.deep.equal(minters);
            expect(parsedLog?.args.transferers).to.deep.equal(transferers);
            expect(parsedLog?.args.burners).to.deep.equal(burners);
            expect(parsedLog?.args.editors).to.deep.equal(editors);
        });

        it("Should return correct permissions via getters", async function () {
            const minters = [PERM_EVERYONE, STARTING_BADGE_ID];
            const transferers = [STARTING_BADGE_ID];
            const burners = [PERM_EVERYONE];
            const editors = [owner.address, creator.address];

            await badges.connect(creator).createBadge(
                "Getter Test",
                true,
                false,
                "ipfs://getter",
                minters,
                transferers,
                burners,
                editors
            );

            const id = STARTING_BADGE_ID + 1n;

            const storedMinters = await badges.getBadgeMinters(id);
            const storedTransferers = await badges.getBadgeTransferers(id);
            const storedBurners = await badges.getBadgeBurners(id);
            const storedEditors = await badges.getBadgeEditors(id);

            expect(storedMinters).to.deep.equal(minters);
            expect(storedTransferers).to.deep.equal(transferers);
            expect(storedBurners).to.deep.equal(burners);
            expect(storedEditors).to.deep.equal(editors);
        });
    });

    describe("Security & Official Status", function () {
        it("Should only allow OFFICIAL_BADGE_CREATOR_ROLE to promote a badge to official", async function () {
            await badges.createBadge("Community", false, true, "ipfs://1", [], [], [], [user1.address]);
            const id = STARTING_BADGE_ID + 1n;

            await expect(
                badges.connect(user1).modifyBadge(id, "Community", true, true, "ipfs://1")
            ).to.be.revertedWithCustomError(badges, "AccessControlUnauthorizedAccount");

            await expect(
                badges.connect(creator).modifyBadge(id, "Community", true, true, "ipfs://1")
            ).to.be.revertedWithCustomError(badges, "Unauthorized");

            await badges.createBadge("For Promotion", false, true, "ipfs://2", [], [], [], [creator.address]);
            const id2 = STARTING_BADGE_ID + 2n;

            await expect(badges.connect(creator).modifyBadge(id2, "Now Official", true, true, "ipfs://2"))
                .to.emit(badges, "BadgeModified");

            const badge = await badges.badges(id2);
            expect(badge.isOfficial).to.be.true;
        });

        it("Should only allow OFFICIAL_BADGE_CREATOR_ROLE to demote an official badge", async function () {
            await badges.connect(creator).createBadge("Official", true, false, "ipfs://3", [], [], [], [user1.address, creator.address]);
            const id = STARTING_BADGE_ID + 1n;

            await expect(
                badges.connect(user1).modifyBadge(id, "Official", false, true, "ipfs://3")
            ).to.be.revertedWithCustomError(badges, "AccessControlUnauthorizedAccount");

            await expect(badges.connect(creator).modifyBadge(id, "Demoted", false, true, "ipfs://3"))
                .to.emit(badges, "BadgeModified");

            const badge = await badges.badges(id);
            expect(badge.isOfficial).to.be.false;
        });
    });

    describe("Profiles", function () {
        it("Should create a profile and allow self-minting internally", async function () {
            await badges.connect(user1).createProfile("ipfs://profile");
            const pid = await badges.profileBadgeId(user1.address);

            expect(await badges.balanceOf(user1.address, pid)).to.equal(1);

            // createProfile prevents creating another.
            await expect(badges.connect(user1).createProfile("ipfs://2")).to.be.revertedWithCustomError(badges, "ProfileAlreadyExists");
        });
    });

    describe("Upgradeability", function () {
        it("Should be upgradeable by Upgrader", async function () {
            const BadgesV2 = await ethers.getContractFactory("SocietyProtocolBadges");
            await upgrades.upgradeProxy(await badges.getAddress(), BadgesV2);
        });

        it("Should NOT be upgradeable by non-Upgrader", async function () {
            const UPGRADER_ROLE = await badges.CONTRACT_UPGRADER_ROLE();
            await badges.revokeRole(UPGRADER_ROLE, owner.address);

            const BadgesV2 = await ethers.getContractFactory("SocietyProtocolBadges");
            await expect(
                upgrades.upgradeProxy(await badges.getAddress(), BadgesV2)
            ).to.be.reverted; // AccessControl revert
        });
    });
});
