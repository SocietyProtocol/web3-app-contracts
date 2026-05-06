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
    let alice: any; // community manager
    let bob: any;   // member / other user
    let carol: any;

    const STARTING_BADGE_ID = 10n;
    // createCommunity() creates badges sequentially:
    //   communityId (= managerBadgeId) = 11, assistantBadgeId = 12, memberBadgeId = 13
    const COMMUNITY_ID       = STARTING_BADGE_ID + 1n; // 11 — also the Manager badge ID
    const ASSISTANT_BADGE_ID = STARTING_BADGE_ID + 2n; // 12
    const MEMBER_BADGE_ID    = STARTING_BADGE_ID + 3n; // 13

    const COMMUNITY_MANAGER_ROLE = ethers.keccak256(
        ethers.toUtf8Bytes("COMMUNITY_MANAGER_ROLE")
    );

    async function createCommunity(signer: any, name = "Alpha", desc = "Desc") {
        return registry.connect(signer).createCommunity(name, desc, "uri:m", "uri:a", "uri:mb");
    }

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
        it("should return communityId = managerBadgeId (= 11)", async function () {
            const tx = await createCommunity(alice);
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => log.fragment?.name === "CommunityCreated") as any;
            expect(event.args[0]).to.equal(COMMUNITY_ID);
        });

        it("should emit CommunityCreated with (communityId, creator, assistantBadgeId, memberBadgeId)", async function () {
            await expect(createCommunity(alice))
                .to.emit(registry, "CommunityCreated")
                .withArgs(COMMUNITY_ID, alice.address, ASSISTANT_BADGE_ID, MEMBER_BADGE_ID);
        });

        it("should mint manager badge to the caller", async function () {
            await createCommunity(alice);
            expect(await badges.balanceOf(alice.address, COMMUNITY_ID)).to.equal(1);
        });

        it("should mint one member badge to the caller (manager is also a member)", async function () {
            await createCommunity(alice);
            expect(await badges.balanceOf(alice.address, MEMBER_BADGE_ID)).to.equal(1);
        });

        it("should NOT mint assistant badge to the caller automatically", async function () {
            await createCommunity(alice);
            expect(await badges.balanceOf(alice.address, ASSISTANT_BADGE_ID)).to.equal(0);
        });

        it("should store community data correctly", async function () {
            await createCommunity(alice, "Alpha", "My community");
            const community = await registry.getCommunityDetails(COMMUNITY_ID);
            expect(community.name).to.equal("Alpha");
            expect(community.description).to.equal("My community");
            expect(community.assistantBadgeId).to.equal(ASSISTANT_BADGE_ID);
            expect(community.memberBadgeId).to.equal(MEMBER_BADGE_ID);
            expect(community.wrapper).to.equal(ethers.ZeroAddress);
            expect(community.createdAt).to.be.gt(0n);
        });

        it("should increment communityCount for each community", async function () {
            await createCommunity(alice, "A");
            await createCommunity(bob, "B");
            expect(await registry.communityCount()).to.equal(2);
        });

        it("second community gets communityId = 14 (3 badges created per community)", async function () {
            await createCommunity(alice, "A");
            // Second createCommunity: manager=14, assistant=15, member=16
            await expect(createCommunity(bob, "B"))
                .to.emit(registry, "CommunityCreated")
                .withArgs(STARTING_BADGE_ID + 4n, bob.address, STARTING_BADGE_ID + 5n, STARTING_BADGE_ID + 6n);
        });
    });

    // ─── Manager badge permissions ─────────────────────────────────────────────

    describe("Manager badge — permissions", function () {
        beforeEach(async function () {
            await createCommunity(alice);
        });

        it("only the holder can transfer the manager badge (PERM_SELF)", async function () {
            await expect(
                badges.connect(alice).safeTransferFrom(alice.address, bob.address, COMMUNITY_ID, 1, "0x")
            ).to.not.be.reverted;
            expect(await badges.balanceOf(bob.address, COMMUNITY_ID)).to.equal(1);
        });

        it("a non-holder cannot transfer the manager badge", async function () {
            await expect(
                badges.connect(bob).safeTransferFrom(alice.address, carol.address, COMMUNITY_ID, 1, "0x")
            ).to.be.revertedWithCustomError(badges, "TransferNotAuthorized");
        });

        it("manager badge cannot be burned", async function () {
            await expect(
                badges.connect(alice).burn(alice.address, COMMUNITY_ID, 1)
            ).to.be.revertedWithCustomError(badges, "BurnNotAuthorized");
        });

        it("nobody can mint an additional manager badge", async function () {
            await expect(
                badges.connect(alice).mint(bob.address, COMMUNITY_ID, 1, "0x")
            ).to.be.revertedWithCustomError(badges, "MintNotAuthorized");
        });

        it("manager can update manager badge URI via registry", async function () {
            await expect(
                registry.connect(alice).setBadgeURI(COMMUNITY_ID, COMMUNITY_ID, "ipfs://new-manager-uri")
            ).to.not.be.reverted;
        });

        it("manager can update assistant badge URI via registry", async function () {
            await expect(
                registry.connect(alice).setBadgeURI(COMMUNITY_ID, ASSISTANT_BADGE_ID, "ipfs://new-assistant-uri")
            ).to.not.be.reverted;
        });

        it("manager can update member badge URI via registry", async function () {
            await expect(
                registry.connect(alice).setBadgeURI(COMMUNITY_ID, MEMBER_BADGE_ID, "ipfs://new-member-uri")
            ).to.not.be.reverted;
        });

        it("manager cannot update badge URI directly on badge contract", async function () {
            await expect(
                badges.connect(alice).setURI(COMMUNITY_ID, "ipfs://hack")
            ).to.be.revertedWithCustomError(badges, "Unauthorized");
        });

        it("non-manager cannot update badge URI via registry", async function () {
            await expect(
                registry.connect(bob).setBadgeURI(COMMUNITY_ID, COMMUNITY_ID, "ipfs://hack")
            ).to.be.revertedWithCustomError(registry, "Unauthorized");
        });

        it("manager cannot update a badge from a different community via registry", async function () {
            await createCommunity(bob, "Beta");
            const otherCommunityId = COMMUNITY_ID + 3n; // 3 badges per community
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

        it("manager badge transfers correctly and new holder gains manager powers", async function () {
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

    // ─── Assistant badge permissions ───────────────────────────────────────────

    describe("Assistant badge — permissions", function () {
        beforeEach(async function () {
            await createCommunity(alice);
        });

        it("manager can mint assistant badge to another address", async function () {
            await expect(
                badges.connect(alice).mint(bob.address, ASSISTANT_BADGE_ID, 1, "0x")
            ).to.not.be.reverted;
            expect(await badges.balanceOf(bob.address, ASSISTANT_BADGE_ID)).to.equal(1);
        });

        it("non-manager cannot mint assistant badge", async function () {
            await expect(
                badges.connect(bob).mint(carol.address, ASSISTANT_BADGE_ID, 1, "0x")
            ).to.be.revertedWithCustomError(badges, "MintNotAuthorized");
        });

        it("assistant badge is soulbound — transfer reverts", async function () {
            await badges.connect(alice).mint(bob.address, ASSISTANT_BADGE_ID, 1, "0x");
            await expect(
                badges.connect(bob).safeTransferFrom(bob.address, carol.address, ASSISTANT_BADGE_ID, 1, "0x")
            ).to.be.revertedWithCustomError(badges, "TransferNotAuthorized");
        });

        it("manager can burn assistant badge", async function () {
            await badges.connect(alice).mint(bob.address, ASSISTANT_BADGE_ID, 1, "0x");
            await expect(
                badges.connect(alice).burn(bob.address, ASSISTANT_BADGE_ID, 1)
            ).to.not.be.reverted;
            expect(await badges.balanceOf(bob.address, ASSISTANT_BADGE_ID)).to.equal(0);
        });

        it("non-manager cannot burn assistant badge", async function () {
            await badges.connect(alice).mint(bob.address, ASSISTANT_BADGE_ID, 1, "0x");
            await expect(
                badges.connect(carol).burn(bob.address, ASSISTANT_BADGE_ID, 1)
            ).to.be.revertedWithCustomError(badges, "BurnNotAuthorized");
        });

        it("assistant badge holder can mint member badges", async function () {
            await badges.connect(alice).mint(bob.address, ASSISTANT_BADGE_ID, 1, "0x");
            await expect(
                badges.connect(bob).mint(carol.address, MEMBER_BADGE_ID, 1, "0x")
            ).to.not.be.reverted;
            expect(await badges.balanceOf(carol.address, MEMBER_BADGE_ID)).to.equal(1);
        });

        it("assistant badge holder can burn member badges", async function () {
            await badges.connect(alice).mint(bob.address, ASSISTANT_BADGE_ID, 1, "0x");
            await badges.connect(alice).mint(carol.address, MEMBER_BADGE_ID, 1, "0x");
            await expect(
                badges.connect(bob).burn(carol.address, MEMBER_BADGE_ID, 1)
            ).to.not.be.reverted;
            expect(await badges.balanceOf(carol.address, MEMBER_BADGE_ID)).to.equal(0);
        });

        it("revoking assistant removes their ability to mint/burn member badges", async function () {
            await badges.connect(alice).mint(bob.address, ASSISTANT_BADGE_ID, 1, "0x");
            await badges.connect(alice).burn(bob.address, ASSISTANT_BADGE_ID, 1);
            await expect(
                badges.connect(bob).mint(carol.address, MEMBER_BADGE_ID, 1, "0x")
            ).to.be.revertedWithCustomError(badges, "MintNotAuthorized");
        });
    });

    // ─── Member badge permissions ──────────────────────────────────────────────

    describe("Member badge — permissions", function () {
        beforeEach(async function () {
            await createCommunity(alice);
        });

        it("manager badge holder can mint member badges to others", async function () {
            await expect(
                badges.connect(alice).mint(bob.address, MEMBER_BADGE_ID, 1, "0x")
            ).to.not.be.reverted;
            expect(await badges.balanceOf(bob.address, MEMBER_BADGE_ID)).to.equal(1);
        });

        it("non-manager/non-assistant cannot mint member badges", async function () {
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

        it("manager can burn a member's badge", async function () {
            await badges.connect(alice).mint(bob.address, MEMBER_BADGE_ID, 1, "0x");
            await expect(
                badges.connect(alice).burn(bob.address, MEMBER_BADGE_ID, 1)
            ).to.not.be.reverted;
            expect(await badges.balanceOf(bob.address, MEMBER_BADGE_ID)).to.equal(0);
        });

        it("non-manager/non-assistant cannot burn a member's badge", async function () {
            await badges.connect(alice).mint(bob.address, MEMBER_BADGE_ID, 1, "0x");
            await expect(
                badges.connect(carol).burn(bob.address, MEMBER_BADGE_ID, 1)
            ).to.be.revertedWithCustomError(badges, "BurnNotAuthorized");
        });
    });

    // ─── deployCommunityWrapper ────────────────────────────────────────────────

    describe("deployCommunityWrapper()", function () {
        beforeEach(async function () {
            await createCommunity(alice);
        });

        it("manager can deploy a wrapper and it is stored", async function () {
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

        it("non-manager cannot deploy a wrapper", async function () {
            await expect(
                registry.connect(bob).deployCommunityWrapper(COMMUNITY_ID, "Alpha Token", "ALPHA")
            ).to.be.revertedWithCustomError(registry, "Unauthorized");
        });
    });

    // ─── createCommunityBadge ─────────────────────────────────────────────────

    describe("createCommunityBadge()", function () {
        const PERM_EVERYONE = 2n;

        beforeEach(async function () {
            await createCommunity(alice);
        });

        it("manager can create an additional badge", async function () {
            const extraBadgeId = STARTING_BADGE_ID + 4n; // next after manager(11), assistant(12), member(13)
            await expect(
                registry.connect(alice).createCommunityBadge(
                    COMMUNITY_ID, "Contributor", "uri:contributor", [PERM_EVERYONE], [], []
                )
            )
                .to.emit(registry, "CommunityBadgeCreated")
                .withArgs(COMMUNITY_ID, extraBadgeId);
        });

        it("additional badge appears in getCommunityBadges at index 3+", async function () {
            await registry.connect(alice).createCommunityBadge(
                COMMUNITY_ID, "Contributor", "uri:contributor", [PERM_EVERYONE], [], []
            );
            const ids = await registry.getCommunityBadges(COMMUNITY_ID);
            expect(ids.length).to.equal(4); // manager, assistant, member, contributor
            expect(ids[3]).to.equal(STARTING_BADGE_ID + 4n);
        });

        it("non-manager cannot create a badge", async function () {
            await expect(
                registry.connect(bob).createCommunityBadge(
                    COMMUNITY_ID, "Contributor", "uri:contributor", [PERM_EVERYONE], [], []
                )
            ).to.be.revertedWithCustomError(registry, "Unauthorized");
        });

        it("created badge has isCommunityBadge = true", async function () {
            await registry.connect(alice).createCommunityBadge(
                COMMUNITY_ID, "Contributor", "uri:contributor", [PERM_EVERYONE], [], []
            );
            const info = await badges.badges(STARTING_BADGE_ID + 4n);
            expect(info.isCommunityBadge).to.equal(true);
        });
    });

    // ─── updateCommunityDetails ────────────────────────────────────────────────

    describe("updateCommunityDetails()", function () {
        beforeEach(async function () {
            await createCommunity(alice, "Alpha", "Old description");
        });

        it("manager can update name and description", async function () {
            await expect(
                registry.connect(alice).updateCommunityDetails(COMMUNITY_ID, "Alpha v2", "New description")
            )
                .to.emit(registry, "CommunityDetailsUpdated")
                .withArgs(COMMUNITY_ID, "Alpha v2", "New description");

            const community = await registry.getCommunityDetails(COMMUNITY_ID);
            expect(community.name).to.equal("Alpha v2");
            expect(community.description).to.equal("New description");
        });

        it("non-manager cannot update community details", async function () {
            await expect(
                registry.connect(bob).updateCommunityDetails(COMMUNITY_ID, "Hijack", "Hijacked")
            ).to.be.revertedWithCustomError(registry, "Unauthorized");
        });
    });

    // ─── View functions ────────────────────────────────────────────────────────

    describe("View functions", function () {
        beforeEach(async function () {
            await createCommunity(alice, "Alpha", "Desc A");
        });

        it("getCommunityDetails reverts for non-existent communityId", async function () {
            await expect(registry.getCommunityDetails(999)).to.be.revertedWithCustomError(
                registry, "CommunityDoesNotExist"
            );
        });

        it("getCommunityBadges returns [managerId, assistantId, memberId] by default", async function () {
            const ids = await registry.getCommunityBadges(COMMUNITY_ID);
            expect(ids.length).to.equal(3);
            expect(ids[0]).to.equal(COMMUNITY_ID);       // manager badge
            expect(ids[1]).to.equal(ASSISTANT_BADGE_ID); // assistant badge
            expect(ids[2]).to.equal(MEMBER_BADGE_ID);    // member badge
        });

        it("getCommunityBadges reverts for non-existent communityId", async function () {
            await expect(registry.getCommunityBadges(999)).to.be.revertedWithCustomError(
                registry, "CommunityDoesNotExist"
            );
        });

        it("isManager returns true for the current manager badge holder", async function () {
            expect(await registry.isManager(COMMUNITY_ID, alice.address)).to.equal(true);
            expect(await registry.isManager(COMMUNITY_ID, bob.address)).to.equal(false);
        });

        it("isManager reflects new holder after manager badge transfer", async function () {
            await badges.connect(alice).safeTransferFrom(alice.address, carol.address, COMMUNITY_ID, 1, "0x");
            expect(await registry.isManager(COMMUNITY_ID, alice.address)).to.equal(false);
            expect(await registry.isManager(COMMUNITY_ID, carol.address)).to.equal(true);
        });

        it("onlyManager functions accept new holder after transfer", async function () {
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

    describe("SocietyProtocolBadges — isCommunityBadge restriction", function () {
        it("direct createBadge(isCommunityBadge=true) by non-registry reverts", async function () {
            await expect(
                (badges as any).connect(alice).createBadge(
                    "Rogue", false, true, ethers.ZeroAddress, "uri",
                    [], [], [], []
                )
            ).to.be.revertedWithCustomError(badges, "AccessControlUnauthorizedAccount");
        });

        it("direct createBadge(isCommunityBadge=false) still works for anyone", async function () {
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
