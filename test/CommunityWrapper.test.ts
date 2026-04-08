import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import {
    SocietyProtocolBadges,
    CommunityWrapper,
    CommunityWrapperFactory
} from "../typechain-types";

describe("CommunityWrapper and Upgradeable Factory", function () {
    let badges: SocietyProtocolBadges;
    let factory: CommunityWrapperFactory;
    let wrapperImpl: CommunityWrapper;
    let owner: any;
    let creator: any;
    let user1: any;

    const PERM_EVERYONE = 2n;
    const STARTING_BADGE_ID = 10n;
    const ID1 = STARTING_BADGE_ID + 1n;
    const ID2 = STARTING_BADGE_ID + 2n;
    const ID3 = STARTING_BADGE_ID + 3n;

    beforeEach(async function () {
        [owner, creator, user1] = await ethers.getSigners();

        // 1. Deploy Badges
        const Badges = await ethers.getContractFactory("SocietyProtocolBadges");
        badges = (await upgrades.deployProxy(Badges, [], { initializer: 'initialize' })) as unknown as SocietyProtocolBadges;
        await badges.waitForDeployment();

        // 2. Deploy Wrapper Implementation
        const Wrapper = await ethers.getContractFactory("CommunityWrapper");
        wrapperImpl = (await Wrapper.deploy()) as unknown as CommunityWrapper;
        await wrapperImpl.waitForDeployment();

        // 3. Deploy Factory via Proxy
        const Factory = await ethers.getContractFactory("CommunityWrapperFactory");
        factory = (await upgrades.deployProxy(Factory, [
            await badges.getAddress(),
            await wrapperImpl.getAddress(),
            owner.address
        ], { initializer: 'initialize' })) as unknown as CommunityWrapperFactory;
        await factory.waitForDeployment();
    });

    describe("Factory Initialization", function () {
        it("Should initialize with correct values", async function () {
            expect(await factory.badgeContract()).to.equal(await badges.getAddress());
            expect(await factory.wrapperImplementation()).to.equal(await wrapperImpl.getAddress());
            expect(await factory.owner()).to.equal(owner.address);
        });
    });

    describe("Deployment via Clones", function () {
        it("Should deploy a new CommunityWrapper clone", async function () {
            const tx = await factory.connect(creator).createWrapper(
                "Test Community",
                "TCM",
                [ID1, ID2]
            );
            const receipt = await tx.wait();

            const event = receipt?.logs.find((log: any) => log.fragment?.name === 'WrapperDeployed') as any;
            const wrapperAddress = event.args[0];

            const wrapper = await ethers.getContractAt("CommunityWrapper", wrapperAddress);
            expect(await wrapper.name()).to.equal("Test Community");
            expect(await wrapper.symbol()).to.equal("TCM");
            expect(await wrapper.owner()).to.equal(creator.address);

            const allowedIds = await wrapper.getAllowedBadgeIds();
            expect(allowedIds.length).to.equal(2);
            expect(allowedIds[0]).to.equal(ID1);
        });
    });

    describe("CommunityWrapper Balance Logic (Cloned)", function () {
        let wrapper: CommunityWrapper;

        beforeEach(async function () {
            const tx = await factory.connect(creator).createWrapper(
                "Test Community",
                "TCM",
                [ID1, ID2]
            );
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => log.fragment?.name === 'WrapperDeployed') as any;
            wrapper = (await ethers.getContractAt("CommunityWrapper", event.args[0])) as unknown as CommunityWrapper;

            // Create badges ID1 and ID2
            await (badges as any).createBadge("Badge 1", true, false, ethers.ZeroAddress, "uri1", [PERM_EVERYONE], [], [], []);
            await (badges as any).createBadge("Badge 2", true, false, ethers.ZeroAddress, "uri2", [PERM_EVERYONE], [], [], []);
        });

        it("Should return the sum of all required badges", async function () {
            await badges.mint(user1.address, ID1, 1, "0x");
            expect(await wrapper.balanceOf(user1.address)).to.equal(1);

            await badges.mint(user1.address, ID2, 1, "0x");
            expect(await wrapper.balanceOf(user1.address)).to.equal(2);
        });

        it("Should sum balances for multiple badges and amounts correctly", async function () {
            // User has 4 of Badge ID1 and 2 of Badge ID2
            await badges.mint(user1.address, ID1, 4, "0x");
            await badges.mint(user1.address, ID2, 2, "0x");
            
            // Total balance should be 4 + 2 = 6
            expect(await wrapper.balanceOf(user1.address)).to.equal(6);
        });
    });

    describe("Management (Cloned)", function () {
        let wrapper: CommunityWrapper;

        beforeEach(async function () {
            const tx = await factory.connect(creator).createWrapper("T", "T", [ID1]);
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => log.fragment?.name === 'WrapperDeployed') as any;
            wrapper = (await ethers.getContractAt("CommunityWrapper", event.args[0])) as unknown as CommunityWrapper;
        });

        it("Owner should be able to add/remove IDs", async function () {
            await wrapper.connect(creator).addBadgeId(ID2);
            expect((await wrapper.getAllowedBadgeIds()).length).to.equal(2);

            await wrapper.connect(creator).removeBadgeId(ID1);
            const ids = await wrapper.getAllowedBadgeIds();
            expect(ids.length).to.equal(1);
            expect(ids[0]).to.equal(ID2);
        });
    });

    describe("Factory Upgradeability", function () {
        it("Should be upgradeable via UUPS by owner", async function () {
            const FactoryV2 = await ethers.getContractFactory("CommunityWrapperFactory");
            const upgraded = await upgrades.upgradeProxy(await factory.getAddress(), FactoryV2);
            expect(await upgraded.getAddress()).to.equal(await factory.getAddress());
        });

        it("Should allow owner to change implementation", async function () {
            const NewWrapper = await ethers.getContractFactory("CommunityWrapper");
            const newImpl = await NewWrapper.deploy();

            await factory.setWrapperImplementation(await newImpl.getAddress());
            expect(await factory.wrapperImplementation()).to.equal(await newImpl.getAddress());
        });
    });

    describe("CommunityWrapper Edge Cases (Cloned)", function () {
        let wrapper: CommunityWrapper;

        beforeEach(async function () {
            const tx = await factory.connect(creator).createWrapper("Edge", "EDGE", [ID1]);
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => log.fragment?.name === 'WrapperDeployed') as any;
            wrapper = (await ethers.getContractAt("CommunityWrapper", event.args[0])) as unknown as CommunityWrapper;
        });

        it("Should always return 0 for totalSupply", async function () {
            expect(await wrapper.totalSupply()).to.equal(0);
        });

        it("Should revert on transfer and transferFrom", async function () {
            await expect(wrapper.transfer(user1.address, 1))
                .to.be.revertedWithCustomError(wrapper, "TransfersDisabled");
            await expect(wrapper.transferFrom(owner.address, user1.address, 1))
                .to.be.revertedWithCustomError(wrapper, "TransfersDisabled");
        });

        it("Should revert when adding more than MAX_BADGES", async function () {
            // Initial has 1 (ID1). MAX_BADGES is 5.
            await wrapper.connect(creator).addBadgeId(ID2); // 2
            await wrapper.connect(creator).addBadgeId(ID3); // 3
            await wrapper.connect(creator).addBadgeId(STARTING_BADGE_ID + 4n); // 4
            await wrapper.connect(creator).addBadgeId(STARTING_BADGE_ID + 5n); // 5

            await expect(wrapper.connect(creator).addBadgeId(STARTING_BADGE_ID + 6n))
                .to.be.revertedWithCustomError(wrapper, "MaxBadgesReached");
        });

        it("Should revert when adding a duplicate badge ID", async function () {
            await expect(wrapper.connect(creator).addBadgeId(ID1))
                .to.be.revertedWithCustomError(wrapper, "BadgeAlreadyAdded");
        });

        it("Should deduplicate badge IDs passed to initialize", async function () {
            // Create wrapper with duplicate IDs in the initial list
            const tx = await factory.connect(creator).createWrapper("Dedup", "DDP", [ID1, ID1, ID1]);
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => log.fragment?.name === 'WrapperDeployed') as any;
            const dedupWrapper = await ethers.getContractAt("CommunityWrapper", event.args[0]);

            const ids = await dedupWrapper.getAllowedBadgeIds();
            expect(ids.length).to.equal(1);
            expect(ids[0]).to.equal(ID1);
        });

        it("Should not double-count balance when initialized with duplicate badge IDs", async function () {
            // Create badge ID1 with PERM_EVERYONE minting, then mint 1 to user1
            await badges.createBadge("Badge 1", false, false, ethers.ZeroAddress, "uri1", [PERM_EVERYONE], [], [], []);
            await badges.connect(user1).mint(user1.address, ID1, 1, "0x");

            // Create wrapper with ID1 listed twice
            const tx = await factory.connect(creator).createWrapper("DoubleCount", "DC", [ID1, ID1]);
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => log.fragment?.name === 'WrapperDeployed') as any;
            const dcWrapper = await ethers.getContractAt("CommunityWrapper", event.args[0]);

            // Balance should be 1, not 2
            expect(await dcWrapper.balanceOf(user1.address)).to.equal(1);
        });

        it("Should revert when removing a non-existent badge ID", async function () {
            await expect(wrapper.connect(creator).removeBadgeId(ID2))
                .to.be.revertedWithCustomError(wrapper, "BadgeNotFound");
        });

        it("Should return 0 for balanceOf if no badges are configured", async function () {
            // Create wrapper with empty badge list
            const tx = await factory.connect(creator).createWrapper("Empty", "MT", []);
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => log.fragment?.name === 'WrapperDeployed') as any;
            const emptyWrapper = await ethers.getContractAt("CommunityWrapper", event.args[0]);

            expect(await emptyWrapper.balanceOf(user1.address)).to.equal(0);
        });

        it("Should only allow owner to add/remove badges", async function () {
            await expect(wrapper.connect(user1).addBadgeId(ID2))
                .to.be.revertedWithCustomError(wrapper, "OwnableUnauthorizedAccount");
            await expect(wrapper.connect(user1).removeBadgeId(ID1))
                .to.be.revertedWithCustomError(wrapper, "OwnableUnauthorizedAccount");
        });
    });

    describe("Multi-User Scenario Isolation", function () {
        let creator1: any, creator2: any, creator3: any;
        let u1: any, u2: any, u3: any;
        let w1: CommunityWrapper, w2: CommunityWrapper, w3: CommunityWrapper;

        beforeEach(async function () {
            const signers = await ethers.getSigners();
            // Using different signers than those used in previous beforeEaches for clarity
            [, , , creator1, creator2, creator3, u1, u2, u3] = signers;

            // Deploy wrappers
            // w1 requires ID1
            let tx = await factory.connect(creator1).createWrapper("W1", "W1", [ID1]);
            let rec = await tx.wait();
            let ev = rec?.logs.find((log: any) => log.fragment?.name === 'WrapperDeployed') as any;
            w1 = (await ethers.getContractAt("CommunityWrapper", ev.args[0])) as unknown as CommunityWrapper;

            // w2 requires ID1, ID2
            tx = await factory.connect(creator2).createWrapper("W2", "W2", [ID1, ID2]);
            rec = await tx.wait();
            ev = rec?.logs.find((log: any) => log.fragment?.name === 'WrapperDeployed') as any;
            w2 = (await ethers.getContractAt("CommunityWrapper", ev.args[0])) as unknown as CommunityWrapper;

            // w3 requires ID2, ID3
            tx = await factory.connect(creator3).createWrapper("W3", "W3", [ID2, ID3]);
            rec = await tx.wait();
            ev = rec?.logs.find((log: any) => log.fragment?.name === 'WrapperDeployed') as any;
            w3 = (await ethers.getContractAt("CommunityWrapper", ev.args[0])) as unknown as CommunityWrapper;

            // Create badges (badges start from ID10+1=11)
            await (badges as any).createBadge("B1", true, false, ethers.ZeroAddress, "u1", [PERM_EVERYONE], [], [], []); // 11
            await (badges as any).createBadge("B2", true, false, ethers.ZeroAddress, "u2", [PERM_EVERYONE], [], [], []); // 12
            await (badges as any).createBadge("B3", true, false, ethers.ZeroAddress, "u3", [PERM_EVERYONE], [], [], []); // 13

            // Mint badges to users
            // u1 has 1 of ID1
            await badges.mint(u1.address, ID1, 1, "0x");
            // u2 has 1 of ID1, 1 of ID2
            await badges.mint(u2.address, ID1, 1, "0x");
            await badges.mint(u2.address, ID2, 1, "0x");
            // u3 has 1 of ID2, 1 of ID3
            await badges.mint(u3.address, ID2, 1, "0x");
            await badges.mint(u3.address, ID3, 1, "0x");
        });

        it("Should report correct balances for all users across all wrappers", async function () {
            // Check W1 (requires ID1)
            expect(await w1.balanceOf(u1.address)).to.equal(1);
            expect(await w1.balanceOf(u2.address)).to.equal(1);
            expect(await w1.balanceOf(u3.address)).to.equal(0);

            // Check W2 (requires ID1, ID2)
            expect(await w2.balanceOf(u1.address)).to.equal(1); // Sum: u1 has 1 of ID1, 0 of ID2 result 1
            expect(await w2.balanceOf(u2.address)).to.equal(2); // Sum: u2 has 1 of ID1, 1 of ID2 result 2
            expect(await w2.balanceOf(u3.address)).to.equal(1); // Sum: u3 has 0 of ID1, 1 of ID2 result 1

            // Check W3 (requires ID2, ID3)
            expect(await w3.balanceOf(u1.address)).to.equal(0);
            expect(await w3.balanceOf(u2.address)).to.equal(1); // Sum: u2 has 0 of ID2(actually u2 has ID2 balance 1), 1 of ID2 + 0 of ID3 = 1
            expect(await w3.balanceOf(u3.address)).to.equal(2); // Sum: u3 has 1 of ID2, 1 of ID3 = 2
        });

        it("Owners should only be able to manage their own wrappers", async function () {
            // creator1 can add to w1
            await expect(w1.connect(creator1).addBadgeId(ID2)).to.not.be.reverted;
            // creator2 cannot add to w1
            await expect(w1.connect(creator2).addBadgeId(ID3)).to.be.revertedWithCustomError(w1, "OwnableUnauthorizedAccount");
        });
    });
});
