import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import {
    SocietyProtocolBadges,
    CommunityWrapper,
    CommunityWrapperFactory
} from "../typechain-types";

describe("CommunityWrapper and Factory", function () {
    let badges: SocietyProtocolBadges;
    let factory: CommunityWrapperFactory;
    let owner: any;
    let creator: any;
    let user1: any;

    beforeEach(async function () {
        [owner, creator, user1] = await ethers.getSigners();

        // 1. Deploy Badges
        const Badges = await ethers.getContractFactory("SocietyProtocolBadges");
        badges = (await upgrades.deployProxy(Badges, [], { initializer: 'initialize' })) as unknown as SocietyProtocolBadges;
        await badges.waitForDeployment();

        // 2. Deploy Factory
        const Factory = await ethers.getContractFactory("CommunityWrapperFactory");
        factory = await Factory.deploy(await badges.getAddress());
        await factory.waitForDeployment();

        // Grant roles to owner to create badges for testing
        const GOVERNOR_ROLE = await badges.GOVERNOR_ROLE();
        await badges.grantRole(GOVERNOR_ROLE, owner.address);
    });

    describe("Factory", function () {
        it("Should deploy a new CommunityWrapper", async function () {
            const tx = await factory.connect(creator).createWrapper(
                "Test Community",
                "TCM",
                [1, 2]
            );
            const receipt = await tx.wait();

            const event = receipt?.logs.find((log: any) => log.fragment?.name === 'WrapperDeployed') as any;
            expect(event).to.not.be.undefined;
            const wrapperAddress = event.args[0];

            const wrapper = await ethers.getContractAt("CommunityWrapper", wrapperAddress);
            expect(await wrapper.name()).to.equal("Test Community");
            expect(await wrapper.symbol()).to.equal("TCM");
            expect(await wrapper.owner()).to.equal(creator.address);

            const allowedIds = await wrapper.getAllowedBadgeIds();
            expect(allowedIds.length).to.equal(2);
            expect(allowedIds[0]).to.equal(1n);
            expect(allowedIds[1]).to.equal(2n);
        });

        it("Should fail if too many initial badges", async function () {
            // Need a dummy address to get contract factory for custom error matching if it's not yet deployed
            // But we can just use the creator to try and fail
            await expect(
                factory.connect(creator).createWrapper("Fail", "FAIL", [1, 2, 3, 4, 5, 6])
            ).to.be.revertedWithCustomError({ interface: (await ethers.getContractFactory("CommunityWrapper")).interface } as any, "MaxBadgesReached");
        });
    });

    describe("CommunityWrapper Balance Logic", function () {
        let wrapper: CommunityWrapper;

        beforeEach(async function () {
            const tx = await factory.connect(creator).createWrapper(
                "Test Community",
                "TCM",
                [1, 2]
            );
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => log.fragment?.name === 'WrapperDeployed') as any;
            wrapper = await ethers.getContractAt("CommunityWrapper", event.args[0]);

            // Create badges 1 and 2
            await badges.createOfficialBadge("Badge 1", "uri1", [owner.address], [], []);
            await badges.createOfficialBadge("Badge 2", "uri2", [owner.address], [], []);
        });

        it("Should return 0 if user has no badges", async function () {
            expect(await wrapper.balanceOf(user1.address)).to.equal(0);
        });

        it("Should return 0 if user has only some of the required badges", async function () {
            await badges.mint(user1.address, 1, 1, "0x");
            expect(await wrapper.balanceOf(user1.address)).to.equal(0);
        });

        it("Should return 1 if user has all required badges", async function () {
            await badges.mint(user1.address, 1, 1, "0x");
            await badges.mint(user1.address, 2, 1, "0x");
            expect(await wrapper.balanceOf(user1.address)).to.equal(1);
        });

        it("Should return 1 even if user has multiple of the same badge", async function () {
            await badges.mint(user1.address, 1, 10, "0x");
            await badges.mint(user1.address, 2, 5, "0x");
            expect(await wrapper.balanceOf(user1.address)).to.equal(1);
        });
    });

    describe("Management", function () {
        let wrapper: CommunityWrapper;

        beforeEach(async function () {
            const tx = await factory.connect(creator).createWrapper(
                "Test Community",
                "TCM",
                [1]
            );
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => log.fragment?.name === 'WrapperDeployed') as any;
            wrapper = await ethers.getContractAt("CommunityWrapper", event.args[0]);

            await badges.createOfficialBadge("Badge 1", "uri1", [owner.address], [], []);
            await badges.createOfficialBadge("Badge 2", "uri2", [owner.address], [], []);
        });

        it("Owner should be able to add badge ID", async function () {
            await wrapper.connect(creator).addBadgeId(2);
            const allowedIds = await wrapper.getAllowedBadgeIds();
            expect(allowedIds.length).to.equal(2);
            expect(allowedIds[1]).to.equal(2n);
        });

        it("Owner should be able to remove badge ID", async function () {
            await wrapper.connect(creator).addBadgeId(2);
            await wrapper.connect(creator).removeBadgeId(1);
            const allowedIds = await wrapper.getAllowedBadgeIds();
            expect(allowedIds.length).to.equal(1);
            expect(allowedIds[0]).to.equal(2n);
        });

        it("Balance should update after adding/removing IDs", async function () {
            await badges.mint(user1.address, 1, 1, "0x");
            expect(await wrapper.balanceOf(user1.address)).to.equal(1);

            await wrapper.connect(creator).addBadgeId(2);
            expect(await wrapper.balanceOf(user1.address)).to.equal(0);

            await badges.mint(user1.address, 2, 1, "0x");
            expect(await wrapper.balanceOf(user1.address)).to.equal(1);

            await wrapper.connect(creator).removeBadgeId(1);
            expect(await wrapper.balanceOf(user1.address)).to.equal(1);
        });

        it("Should enforce MAX_BADGES limit", async function () {
            await wrapper.connect(creator).addBadgeId(2);
            await wrapper.connect(creator).addBadgeId(3);
            await wrapper.connect(creator).addBadgeId(4);
            await wrapper.connect(creator).addBadgeId(5);

            await expect(
                wrapper.connect(creator).addBadgeId(6)
            ).to.be.revertedWithCustomError(wrapper, "MaxBadgesReached");
        });
    });

    describe("ERC20 compliance (limited)", function () {
        it("Should revert on transfers", async function () {
            const tx = await factory.connect(creator).createWrapper("T", "T", [1]);
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => log.fragment?.name === 'WrapperDeployed') as any;
            const wrapper = await ethers.getContractAt("CommunityWrapper", event.args[0]);

            await expect(wrapper.transfer(user1.address, 1)).to.be.revertedWithCustomError(wrapper, "TransfersDisabled");
        });
    });
});
