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
        it("Should deploy a new CommunityWrapper clone with badge-based ownership", async function () {
            // Creator badge must exist before the wrapper admin can act
            await badges.createBadge("Creator Badge", true, false, ethers.ZeroAddress, "ipfs://c", [PERM_EVERYONE], [], [], []);
            await badges.mint(creator.address, ID1, 1, "0x");

            const tx = await factory.connect(creator).createWrapper(
                "Test Community",
                "TCM",
                [ID1],
                ID1 // creatorBadgeId
            );
            const receipt = await tx.wait();

            const event = receipt?.logs.find((log: any) => log.fragment?.name === 'WrapperDeployed') as any;
            const wrapperAddress = event.args[0];

            const wrapper = await ethers.getContractAt("CommunityWrapper", wrapperAddress);
            expect(await wrapper.name()).to.equal("Test Community");
            expect(await wrapper.symbol()).to.equal("TCM");
            expect(await wrapper.creatorBadgeId()).to.equal(ID1);

            const allowedIds = await wrapper.getAllowedBadgeIds();
            expect(allowedIds.length).to.equal(1);
            expect(allowedIds[0]).to.equal(ID1);
        });

        it("Admin rights follow the badge — new holder can manage, old holder cannot", async function () {
            await badges.createBadge("Creator Badge", true, false, ethers.ZeroAddress, "ipfs://c", [PERM_EVERYONE], [PERM_EVERYONE], [], [owner.address]);
            await badges.mint(creator.address, ID1, 1, "0x");

            const tx = await factory.connect(creator).createWrapper("TC", "TC", [], ID1);
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => log.fragment?.name === 'WrapperDeployed') as any;
            const wrapper = await ethers.getContractAt("CommunityWrapper", event.args[0]) as unknown as CommunityWrapper;

            // creator holds ID1 → can admin
            await expect(wrapper.connect(creator).setBadgeIds([ID2])).to.not.be.reverted;

            // Transfer the creator badge to user1
            await badges.connect(creator).safeTransferFrom(creator.address, user1.address, ID1, 1, "0x");

            // user1 now holds ID1 → can admin
            await expect(wrapper.connect(user1).setBadgeIds([ID2, ID3])).to.not.be.reverted;

            // creator no longer holds ID1 → cannot admin
            await expect(wrapper.connect(creator).setBadgeIds([STARTING_BADGE_ID + 4n]))
                .to.be.revertedWithCustomError(wrapper, "Unauthorized");
        });
    });

    describe("CommunityWrapper Balance Logic (Cloned)", function () {
        let wrapper: CommunityWrapper;

        beforeEach(async function () {
            // Create the wrapper; creatorBadgeId=ID1 (badge not yet created — that's fine,
            // it's only checked when admin functions are called)
            const tx = await factory.connect(creator).createWrapper(
                "Test Community",
                "TCM",
                [ID1, ID2],
                ID1
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
            await badges.mint(user1.address, ID1, 4, "0x");
            await badges.mint(user1.address, ID2, 2, "0x");
            expect(await wrapper.balanceOf(user1.address)).to.equal(6);
        });
    });

    describe("Management (Cloned)", function () {
        let wrapper: CommunityWrapper;

        beforeEach(async function () {
            // Create creator badge and mint to creator before creating wrapper
            await badges.createBadge("Creator", true, false, ethers.ZeroAddress, "ipfs://c", [PERM_EVERYONE], [], [], []);
            await badges.mint(creator.address, ID1, 1, "0x");

            const tx = await factory.connect(creator).createWrapper("T", "T", [ID1], ID1);
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => log.fragment?.name === 'WrapperDeployed') as any;
            wrapper = (await ethers.getContractAt("CommunityWrapper", event.args[0])) as unknown as CommunityWrapper;
        });

        it("Badge holder should be able to replace the badge list", async function () {
            // starts with [ID1]; replace with [ID2, ID3]
            await wrapper.connect(creator).setBadgeIds([ID2, ID3]);
            const ids = await wrapper.getAllowedBadgeIds();
            expect(ids.length).to.equal(2);
            expect(ids[0]).to.equal(ID2);
            expect(ids[1]).to.equal(ID3);
        });

        it("setBadgeIds can clear the list", async function () {
            await wrapper.connect(creator).setBadgeIds([]);
            expect((await wrapper.getAllowedBadgeIds()).length).to.equal(0);
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
            // Create and mint creator badge so creator can call admin functions
            await badges.createBadge("Creator", true, false, ethers.ZeroAddress, "ipfs://c", [PERM_EVERYONE], [], [], []);
            await badges.mint(creator.address, ID1, 1, "0x");

            const tx = await factory.connect(creator).createWrapper("Edge", "EDGE", [ID1], ID1);
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

        it("Should revert when new list exceeds MAX_BADGES", async function () {
            const tooMany = [ID1, ID2, ID3, STARTING_BADGE_ID + 4n, STARTING_BADGE_ID + 5n, STARTING_BADGE_ID + 6n]; // 6 > 5
            await expect(wrapper.connect(creator).setBadgeIds(tooMany))
                .to.be.revertedWithCustomError(wrapper, "MaxBadgesReached");
        });

        it("Should deduplicate within setBadgeIds", async function () {
            await wrapper.connect(creator).setBadgeIds([ID2, ID2, ID3]);
            const ids = await wrapper.getAllowedBadgeIds();
            expect(ids.length).to.equal(2);
        });

        it("Should deduplicate badge IDs passed to initialize", async function () {
            const tx = await factory.connect(creator).createWrapper("Dedup", "DDP", [ID1, ID1, ID1], ID1);
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => log.fragment?.name === 'WrapperDeployed') as any;
            const dedupWrapper = await ethers.getContractAt("CommunityWrapper", event.args[0]);

            const ids = await dedupWrapper.getAllowedBadgeIds();
            expect(ids.length).to.equal(1);
            expect(ids[0]).to.equal(ID1);
        });

        it("Should not double-count balance when initialized with duplicate badge IDs", async function () {
            // ID1 already exists (created in beforeEach); mint 1 to user1
            await badges.connect(user1).mint(user1.address, ID1, 1, "0x");

            const tx = await factory.connect(creator).createWrapper("DoubleCount", "DC", [ID1, ID1], ID1);
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => log.fragment?.name === 'WrapperDeployed') as any;
            const dcWrapper = await ethers.getContractAt("CommunityWrapper", event.args[0]);

            // After dedup allowedBadgeIds=[ID1]. user1 holds 1 → balance = 1, not 2.
            expect(await dcWrapper.balanceOf(user1.address)).to.equal(1);
        });

        it("Should return 0 for balanceOf if no badges are configured", async function () {
            const tx = await factory.connect(creator).createWrapper("Empty", "MT", [], ID1);
            const receipt = await tx.wait();
            const event = receipt?.logs.find((log: any) => log.fragment?.name === 'WrapperDeployed') as any;
            const emptyWrapper = await ethers.getContractAt("CommunityWrapper", event.args[0]);

            expect(await emptyWrapper.balanceOf(user1.address)).to.equal(0);
        });

        it("Should revert for non-badge-holder trying to set badge list", async function () {
            await expect(wrapper.connect(user1).setBadgeIds([ID2]))
                .to.be.revertedWithCustomError(wrapper, "Unauthorized");
        });
    });

    describe("Multi-User Scenario Isolation", function () {
        let creator1: any, creator2: any, creator3: any;
        let u1: any, u2: any, u3: any;
        let w1: CommunityWrapper, w2: CommunityWrapper, w3: CommunityWrapper;

        // Creator badges (each creator holds their own)
        const C1_ID = STARTING_BADGE_ID + 4n; // 14
        const C2_ID = STARTING_BADGE_ID + 5n; // 15
        const C3_ID = STARTING_BADGE_ID + 6n; // 16

        beforeEach(async function () {
            const signers = await ethers.getSigners();
            [, , , creator1, creator2, creator3, u1, u2, u3] = signers;

            // Create membership badges: ID1=11, ID2=12, ID3=13
            await (badges as any).createBadge("B1", true, false, ethers.ZeroAddress, "u1", [PERM_EVERYONE], [], [], []); // 11
            await (badges as any).createBadge("B2", true, false, ethers.ZeroAddress, "u2", [PERM_EVERYONE], [], [], []); // 12
            await (badges as any).createBadge("B3", true, false, ethers.ZeroAddress, "u3", [PERM_EVERYONE], [], [], []); // 13

            // Create creator badges: C1_ID=14, C2_ID=15, C3_ID=16
            await (badges as any).createBadge("C1", true, false, ethers.ZeroAddress, "c1", [PERM_EVERYONE], [], [], []); // 14
            await (badges as any).createBadge("C2", true, false, ethers.ZeroAddress, "c2", [PERM_EVERYONE], [], [], []); // 15
            await (badges as any).createBadge("C3", true, false, ethers.ZeroAddress, "c3", [PERM_EVERYONE], [], [], []); // 16

            // Mint creator badges to their respective creators
            await badges.mint(creator1.address, C1_ID, 1, "0x");
            await badges.mint(creator2.address, C2_ID, 1, "0x");
            await badges.mint(creator3.address, C3_ID, 1, "0x");

            // Deploy wrappers with respective creator badge IDs
            let tx = await factory.connect(creator1).createWrapper("W1", "W1", [ID1], C1_ID);
            let rec = await tx.wait();
            let ev = rec?.logs.find((log: any) => log.fragment?.name === 'WrapperDeployed') as any;
            w1 = (await ethers.getContractAt("CommunityWrapper", ev.args[0])) as unknown as CommunityWrapper;

            tx = await factory.connect(creator2).createWrapper("W2", "W2", [ID1, ID2], C2_ID);
            rec = await tx.wait();
            ev = rec?.logs.find((log: any) => log.fragment?.name === 'WrapperDeployed') as any;
            w2 = (await ethers.getContractAt("CommunityWrapper", ev.args[0])) as unknown as CommunityWrapper;

            tx = await factory.connect(creator3).createWrapper("W3", "W3", [ID2, ID3], C3_ID);
            rec = await tx.wait();
            ev = rec?.logs.find((log: any) => log.fragment?.name === 'WrapperDeployed') as any;
            w3 = (await ethers.getContractAt("CommunityWrapper", ev.args[0])) as unknown as CommunityWrapper;

            // Mint membership badges to users
            await badges.mint(u1.address, ID1, 1, "0x");
            await badges.mint(u2.address, ID1, 1, "0x");
            await badges.mint(u2.address, ID2, 1, "0x");
            await badges.mint(u3.address, ID2, 1, "0x");
            await badges.mint(u3.address, ID3, 1, "0x");
        });

        it("Should report correct balances for all users across all wrappers", async function () {
            // Check W1 (requires ID1)
            expect(await w1.balanceOf(u1.address)).to.equal(1);
            expect(await w1.balanceOf(u2.address)).to.equal(1);
            expect(await w1.balanceOf(u3.address)).to.equal(0);

            // Check W2 (requires ID1, ID2)
            expect(await w2.balanceOf(u1.address)).to.equal(1);
            expect(await w2.balanceOf(u2.address)).to.equal(2);
            expect(await w2.balanceOf(u3.address)).to.equal(1);

            // Check W3 (requires ID2, ID3)
            expect(await w3.balanceOf(u1.address)).to.equal(0);
            expect(await w3.balanceOf(u2.address)).to.equal(1);
            expect(await w3.balanceOf(u3.address)).to.equal(2);
        });

        it("Only the holder of the creator badge can manage their wrapper", async function () {
            // creator1 holds C1_ID → can replace w1's badge list
            await expect(w1.connect(creator1).setBadgeIds([ID2])).to.not.be.reverted;
            // creator2 holds C2_ID (not C1_ID) → cannot manage w1
            await expect(w1.connect(creator2).setBadgeIds([ID3])).to.be.revertedWithCustomError(w1, "Unauthorized");
        });
    });
});
