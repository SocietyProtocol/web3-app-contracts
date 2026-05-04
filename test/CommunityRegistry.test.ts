import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import {
    SocietyProtocolBadges,
    CommunityWrapperFactory,
    CommunityWrapper,
    CommunityRegistry,
} from "../typechain-types";

describe("CommunityRegistry", function () {
    let badges: SocietyProtocolBadges;
    let factory: CommunityWrapperFactory;
    let wrapperImpl: CommunityWrapper;
    let registry: CommunityRegistry;

    let owner: any;
    let alice: any; // community creator
    let bob: any;   // member / other user
    let carol: any;

    const STARTING_BADGE_ID = 10n;
    // createCommunity() creates badges sequentially:
    //   communityId (= creatorBadgeId) = 11, memberBadgeId = 12
    const COMMUNITY_ID   = STARTING_BADGE_ID + 1n; // 11 — also the Creator badge ID
    const MEMBER_BADGE_ID = STARTING_BADGE_ID + 2n; // 12

    const COMMUNITY_MANAGER_ROLE = ethers.keccak256(
        ethers.toUtf8Bytes("COMMUNITY_MANAGER_ROLE")
    );

    beforeEach(async function () {
        [owner, alice, bob, carol] = await ethers.getSigners();

        const Badges = await ethers.getContractFactory("SocietyProtocolBadges");
        badges = (await upgrades.deployProxy(Badges, [], {
            initializer: "initialize",
        })) as unknown as SocietyProtocolBadges;
        await badges.waitForDeployment();

        const Wrapper = await ethers.getContractFactory("CommunityWrapper");
        wrapperImpl = (await Wrapper.deploy()) as unknown as CommunityWrapper;
        await wrapperImpl.waitForDeployment();

        const Factory = await ethers.getContractFactory("CommunityWrapperFactory");
        factory = (await upgrades.deployProxy(
            Factory,
            [await badges.getAddress(), await wrapperImpl.getAddress(), owner.address],
            { initializer: "initialize" }
        )) as unknown as CommunityWrapperFactory;
        await factory.waitForDeployment();

        const Registry = await ethers.getContractFactory("CommunityRegistry");
        registry = (await upgrades.deployProxy(
            Registry,
            [await badges.getAddress(), await factory.getAddress(), owner.address],
            { initializer: "initialize" }
        )) as unknown as CommunityRegistry;
        await registry.waitForDeployment();

        await badges.grantRole(COMMUNITY_MANAGER_ROLE, await registry.getAddress());
    });

    // ─── Initialization ────────────────────────────────────────────────────────

    describe("Initialization", function () {
        it("should set badges and wrapperFactory correctly", async function () {
            expect(await registry.badges()).to.equal(await badges.getAddress());
            expect(await registry.wrapperFactory()).to.equal(await factory.getAddress());
            expect(await registry.owner()).to.equal(owner.address);
        });

        it("should start with communityCount = 0", async function () {
            expect(await registry.communityCount()).to.equal(0);
        });
    });

    // ─── createCommunity ───────────────────────────────────────────────────────

    describe("createCommunity()", function () {
        it("should return communityId = creatorBadgeId (= 11)", async function () {
            const tx = await registry.connect(alice).createCommunity("Alpha", "Desc", "uri:c", "uri:m");
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => log.fragment?.name === "CommunityCreated") as any;
            expect(event.args[0]).to.equal(COMMUNITY_ID);
        });

        it("should emit CommunityCreated with (communityId, creator, memberBadgeId)", async function () {
            await expect(
                registry.connect(alice).createCommunity("Alpha", "Desc", "uri:c", "uri:m")
            )
                .to.emit(registry, "CommunityCreated")
                .withArgs(COMMUNITY_ID, alice.address, MEMBER_BADGE_ID);
        });

        it("should mint creator badge to the caller", async function () {
            await registry.connect(alice).createCommunity("Alpha", "Desc", "uri:c", "uri:m");
            expect(await badges.balanceOf(alice.address, COMMUNITY_ID)).to.equal(1);
        });

        it("should mint one member badge to the caller (creator is also a member)", async function () {
            await registry.connect(alice).createCommunity("Alpha", "Desc", "uri:c", "uri:m");
            expect(await badges.balanceOf(alice.address, MEMBER_BADGE_ID)).to.equal(1);
        });

        it("should store community data correctly", async function () {
            await registry.connect(alice).createCommunity("Alpha", "My community", "uri:c", "uri:m");
            const community = await registry.getCommunityDetails(COMMUNITY_ID);
            expect(community.name).to.equal("Alpha");
            expect(community.description).to.equal("My community");
            expect(community.memberBadgeId).to.equal(MEMBER_BADGE_ID);
            expect(community.wrapper).to.equal(ethers.ZeroAddress);
        });

        it("should increment communityCount for each community", async function () {
            await registry.connect(alice).createCommunity("A", "A", "u", "u");
            await registry.connect(bob).createCommunity("B", "B", "u", "u");
            expect(await registry.communityCount()).to.equal(2);
        });

        it("second community gets communityId = 13 (badge IDs are sequential)", async function () {
            await registry.connect(alice).createCommunity("A", "A", "u", "u");
            // Second createCommunity: creator badge ID = 13, member badge ID = 14
            await expect(
                registry.connect(bob).createCommunity("B", "B", "u", "u")
            )
                .to.emit(registry, "CommunityCreated")
                .withArgs(STARTING_BADGE_ID + 3n, bob.address, STARTING_BADGE_ID + 4n);
        });
    });

    // ─── Creator badge permissions ─────────────────────────────────────────────

    describe("Creator badge — permissions", function () {
        beforeEach(async function () {
            await registry.connect(alice).createCommunity("Alpha", "Desc", "uri:c", "uri:m");
        });

        it("only the holder can transfer the creator badge (PERM_SELF)", async function () {
            await expect(
                badges.connect(alice).safeTransferFrom(alice.address, bob.address, COMMUNITY_ID, 1, "0x")
            ).to.not.be.reverted;
            expect(await badges.balanceOf(bob.address, COMMUNITY_ID)).to.equal(1);
        });

        it("a non-holder cannot transfer the creator badge", async function () {
            await expect(
                badges.connect(bob).safeTransferFrom(alice.address, carol.address, COMMUNITY_ID, 1, "0x")
            ).to.be.revertedWithCustomError(badges, "TransferNotAuthorized");
        });

        it("creator badge cannot be burned", async function () {
            await expect(
                badges.connect(alice).burn(alice.address, COMMUNITY_ID, 1)
            ).to.be.revertedWithCustomError(badges, "BurnNotAuthorized");
        });

        it("nobody can mint an additional creator badge", async function () {
            await expect(
                badges.connect(alice).mint(bob.address, COMMUNITY_ID, 1, "0x")
            ).to.be.revertedWithCustomError(badges, "MintNotAuthorized");
        });

        it("creator can update creator badge URI via registry", async function () {
            await expect(
                registry.connect(alice).setBadgeURI(COMMUNITY_ID, COMMUNITY_ID, "ipfs://new-creator-uri")
            ).to.not.be.reverted;
        });

        it("creator can update member badge URI via registry", async function () {
            await expect(
                registry.connect(alice).setBadgeURI(COMMUNITY_ID, MEMBER_BADGE_ID, "ipfs://new-member-uri")
            ).to.not.be.reverted;
        });

        it("creator cannot update badge URI directly on badge contract", async function () {
            await expect(
                badges.connect(alice).setURI(COMMUNITY_ID, "ipfs://hack")
            ).to.be.revertedWithCustomError(badges, "Unauthorized");
        });

        it("non-creator cannot update badge URI via registry", async function () {
            await expect(
                registry.connect(bob).setBadgeURI(COMMUNITY_ID, COMMUNITY_ID, "ipfs://hack")
            ).to.be.revertedWithCustomError(registry, "Unauthorized");
        });

        it("creator cannot update a badge from a different community via registry", async function () {
            await registry.connect(bob).createCommunity("Beta", "Desc", "uri:c2", "uri:m2");
            const otherCommunityId = COMMUNITY_ID + 2n; // two badges created per community
            await expect(
                registry.connect(alice).setBadgeURI(COMMUNITY_ID, otherCommunityId, "ipfs://hack")
            ).to.be.revertedWithCustomError(registry, "BadgeNotInCommunity");
        });

        it("after badge transfer, new holder can update URI; old holder cannot", async function () {
            await badges.connect(alice).safeTransferFrom(alice.address, bob.address, COMMUNITY_ID, 1, "0x");
            await expect(
                registry.connect(bob).setBadgeURI(COMMUNITY_ID, MEMBER_BADGE_ID, "ipfs://bob-update")
            ).to.not.be.reverted;
            await expect(
                registry.connect(alice).setBadgeURI(COMMUNITY_ID, MEMBER_BADGE_ID, "ipfs://alice-update")
            ).to.be.revertedWithCustomError(registry, "Unauthorized");
        });

        it("creator badge transfers correctly and new holder gains creator powers", async function () {
            await badges.connect(alice).safeTransferFrom(alice.address, bob.address, COMMUNITY_ID, 1, "0x");

            // Bob can now mint member badges
            await expect(
                badges.connect(bob).mint(carol.address, MEMBER_BADGE_ID, 1, "0x")
            ).to.not.be.reverted;

            // Alice can no longer mint member badges
            await expect(
                badges.connect(alice).mint(carol.address, MEMBER_BADGE_ID, 1, "0x")
            ).to.be.revertedWithCustomError(badges, "MintNotAuthorized");
        });
    });

    // ─── Member badge permissions ──────────────────────────────────────────────

    describe("Member badge — permissions", function () {
        beforeEach(async function () {
            await registry.connect(alice).createCommunity("Alpha", "Desc", "uri:c", "uri:m");
        });

        it("creator badge holder can mint member badges to others", async function () {
            await expect(
                badges.connect(alice).mint(bob.address, MEMBER_BADGE_ID, 1, "0x")
            ).to.not.be.reverted;
            expect(await badges.balanceOf(bob.address, MEMBER_BADGE_ID)).to.equal(1);
        });

        it("non-creator cannot mint member badges", async function () {
            await expect(
                badges.connect(bob).mint(carol.address, MEMBER_BADGE_ID, 1, "0x")
            ).to.be.revertedWithCustomError(badges, "MintNotAuthorized");
        });

        it("member badge is soulbound — transfer reverts", async function () {
            await badges.connect(alice).mint(bob.address, MEMBER_BADGE_ID, 1, "0x");
            await expect(
                badges.connect(bob).safeTransferFrom(bob.address, carol.address, MEMBER_BADGE_ID, 1, "0x")
            ).to.be.revertedWithCustomError(badges, "TransferNotAuthorized");
        });

        it("creator can burn a member's badge", async function () {
            await badges.connect(alice).mint(bob.address, MEMBER_BADGE_ID, 1, "0x");
            await expect(
                badges.connect(alice).burn(bob.address, MEMBER_BADGE_ID, 1)
            ).to.not.be.reverted;
            expect(await badges.balanceOf(bob.address, MEMBER_BADGE_ID)).to.equal(0);
        });

        it("non-creator cannot burn a member's badge", async function () {
            await badges.connect(alice).mint(bob.address, MEMBER_BADGE_ID, 1, "0x");
            await expect(
                badges.connect(carol).burn(bob.address, MEMBER_BADGE_ID, 1)
            ).to.be.revertedWithCustomError(badges, "BurnNotAuthorized");
        });
    });

    // ─── deployCommunityWrapper ────────────────────────────────────────────────

    describe("deployCommunityWrapper()", function () {
        beforeEach(async function () {
            await registry.connect(alice).createCommunity("Alpha", "Desc", "uri:c", "uri:m");
        });

        it("creator can deploy a wrapper and it is stored", async function () {
            const tx = await registry.connect(alice).deployCommunityWrapper(COMMUNITY_ID, "Alpha Token", "ALPHA");
            const receipt = await tx.wait();
            const event = receipt?.logs.find(
                (log: any) => log.fragment?.name === "CommunityWrapperDeployed"
            ) as any;
            expect(event).to.not.be.undefined;

            const community = await registry.getCommunityDetails(COMMUNITY_ID);
            expect(community.wrapper).to.equal(event.args[1]);
            expect(community.wrapper).to.not.equal(ethers.ZeroAddress);
        });

        it("wrapper is tied to the member badge", async function () {
            const tx = await registry.connect(alice).deployCommunityWrapper(COMMUNITY_ID, "Alpha Token", "ALPHA");
            const receipt = await tx.wait();
            const event = receipt?.logs.find(
                (log: any) => log.fragment?.name === "CommunityWrapperDeployed"
            ) as any;
            const wrapper = await ethers.getContractAt("CommunityWrapper", event.args[1]);
            const ids = await wrapper.getAllowedBadgeIds();
            expect(ids.length).to.equal(1);
            expect(ids[0]).to.equal(MEMBER_BADGE_ID);
        });

        it("second call reverts with WrapperAlreadyDeployed", async function () {
            await registry.connect(alice).deployCommunityWrapper(COMMUNITY_ID, "Alpha Token", "ALPHA");
            await expect(
                registry.connect(alice).deployCommunityWrapper(COMMUNITY_ID, "Alpha Token 2", "ALPHA2")
            ).to.be.revertedWithCustomError(registry, "WrapperAlreadyDeployed");
        });

        it("non-creator cannot deploy a wrapper", async function () {
            await expect(
                registry.connect(bob).deployCommunityWrapper(COMMUNITY_ID, "Alpha Token", "ALPHA")
            ).to.be.revertedWithCustomError(registry, "Unauthorized");
        });
    });

    // ─── createCommunityBadge ─────────────────────────────────────────────────

    describe("createCommunityBadge()", function () {
        const PERM_EVERYONE = 2n;

        beforeEach(async function () {
            await registry.connect(alice).createCommunity("Alpha", "Desc", "uri:c", "uri:m");
        });

        it("creator can create an additional badge", async function () {
            const extraBadgeId = STARTING_BADGE_ID + 3n; // next after creator(11) and member(12)
            await expect(
                registry.connect(alice).createCommunityBadge(
                    COMMUNITY_ID, "Contributor", "uri:contributor", [PERM_EVERYONE], [], []
                )
            )
                .to.emit(registry, "CommunityBadgeCreated")
                .withArgs(COMMUNITY_ID, extraBadgeId);
        });

        it("additional badge appears in getCommunityBadges at index 2+", async function () {
            await registry.connect(alice).createCommunityBadge(
                COMMUNITY_ID, "Contributor", "uri:contributor", [PERM_EVERYONE], [], []
            );
            const ids = await registry.getCommunityBadges(COMMUNITY_ID);
            expect(ids.length).to.equal(3); // creator, member, contributor
            expect(ids[2]).to.equal(STARTING_BADGE_ID + 3n);
        });

        it("non-creator cannot create a badge", async function () {
            await expect(
                registry.connect(bob).createCommunityBadge(
                    COMMUNITY_ID, "Contributor", "uri:contributor", [PERM_EVERYONE], [], []
                )
            ).to.be.revertedWithCustomError(registry, "Unauthorized");
        });

        it("created badge has isCommunity = true", async function () {
            await registry.connect(alice).createCommunityBadge(
                COMMUNITY_ID, "Contributor", "uri:contributor", [PERM_EVERYONE], [], []
            );
            const info = await badges.badges(STARTING_BADGE_ID + 3n);
            expect(info.isCommunity).to.equal(true);
        });
    });

    // ─── updateCommunityDetails ────────────────────────────────────────────────

    describe("updateCommunityDetails()", function () {
        beforeEach(async function () {
            await registry.connect(alice).createCommunity("Alpha", "Old description", "uri:c", "uri:m");
        });

        it("creator can update name and description", async function () {
            await expect(
                registry.connect(alice).updateCommunityDetails(COMMUNITY_ID, "Alpha v2", "New description")
            )
                .to.emit(registry, "CommunityDetailsUpdated")
                .withArgs(COMMUNITY_ID, "Alpha v2", "New description");

            const community = await registry.getCommunityDetails(COMMUNITY_ID);
            expect(community.name).to.equal("Alpha v2");
            expect(community.description).to.equal("New description");
        });

        it("non-creator cannot update community details", async function () {
            await expect(
                registry.connect(bob).updateCommunityDetails(COMMUNITY_ID, "Hijack", "Hijacked")
            ).to.be.revertedWithCustomError(registry, "Unauthorized");
        });
    });

    // ─── View functions ────────────────────────────────────────────────────────

    describe("View functions", function () {
        beforeEach(async function () {
            await registry.connect(alice).createCommunity("Alpha", "Desc A", "uri:c", "uri:m");
        });

        it("getCommunityDetails reverts for non-existent communityId", async function () {
            await expect(registry.getCommunityDetails(999)).to.be.revertedWithCustomError(
                registry, "CommunityDoesNotExist"
            );
        });

        it("getCommunityBadges returns [creatorBadgeId, memberBadgeId] by default", async function () {
            const ids = await registry.getCommunityBadges(COMMUNITY_ID);
            expect(ids.length).to.equal(2);
            expect(ids[0]).to.equal(COMMUNITY_ID);   // creator badge
            expect(ids[1]).to.equal(MEMBER_BADGE_ID); // member badge
        });

        it("getCommunityBadges reverts for non-existent communityId", async function () {
            await expect(registry.getCommunityBadges(999)).to.be.revertedWithCustomError(
                registry, "CommunityDoesNotExist"
            );
        });

        it("isCreator returns true for the current creator badge holder", async function () {
            expect(await registry.isCreator(COMMUNITY_ID, alice.address)).to.equal(true);
            expect(await registry.isCreator(COMMUNITY_ID, bob.address)).to.equal(false);
        });

        it("isCreator reflects new holder after creator badge transfer", async function () {
            await badges.connect(alice).safeTransferFrom(alice.address, carol.address, COMMUNITY_ID, 1, "0x");
            expect(await registry.isCreator(COMMUNITY_ID, alice.address)).to.equal(false);
            expect(await registry.isCreator(COMMUNITY_ID, carol.address)).to.equal(true);
        });

        it("onlyCreator functions accept new holder after transfer", async function () {
            await badges.connect(alice).safeTransferFrom(alice.address, carol.address, COMMUNITY_ID, 1, "0x");
            await expect(
                registry.connect(carol).updateCommunityDetails(COMMUNITY_ID, "New name", "New desc")
            ).to.not.be.reverted;
            await expect(
                registry.connect(alice).updateCommunityDetails(COMMUNITY_ID, "Alice back", "Nope")
            ).to.be.revertedWithCustomError(registry, "Unauthorized");
        });
    });

    // ─── Badge contract restriction ────────────────────────────────────────────

    describe("SocietyProtocolBadges — isCommunity restriction", function () {
        it("direct createBadge(isCommunity=true) by non-registry reverts", async function () {
            await expect(
                (badges as any).connect(alice).createBadge(
                    "Rogue", false, true, ethers.ZeroAddress, "uri",
                    [], [], [], []
                )
            ).to.be.revertedWithCustomError(badges, "AccessControlUnauthorizedAccount");
        });

        it("direct createBadge(isCommunity=false) still works for anyone", async function () {
            await expect(
                (badges as any).connect(alice).createBadge(
                    "Personal", false, false, ethers.ZeroAddress, "uri",
                    [], [], [], []
                )
            ).to.not.be.reverted;
        });
    });

    // ─── Upgradeability ────────────────────────────────────────────────────────

    describe("CommunityRegistry upgradeability", function () {
        it("owner can upgrade the registry", async function () {
            const RegistryV2 = await ethers.getContractFactory("CommunityRegistry");
            const upgraded = await upgrades.upgradeProxy(await registry.getAddress(), RegistryV2);
            expect(await upgraded.getAddress()).to.equal(await registry.getAddress());
        });

        it("non-owner cannot upgrade the registry", async function () {
            const RegistryV2 = await ethers.getContractFactory("CommunityRegistry");
            await expect(
                upgrades.upgradeProxy(await registry.getAddress(), RegistryV2.connect(alice))
            ).to.be.reverted;
        });
    });
});
