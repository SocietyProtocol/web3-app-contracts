import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SocietyProtocolBadges, SocietyVipManager, SPEC } from "../typechain-types";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("Society VIP Manager", function () {
    let badges: SocietyProtocolBadges;
    let vipManager: SocietyVipManager;
    let stakingToken: SPEC;
    let owner: any;
    let user1: any;

    const BRONZE_AMOUNT = ethers.parseEther("100");
    const SILVER_AMOUNT = ethers.parseEther("1000");
    const GOLD_AMOUNT = ethers.parseEther("10000");
    const ONE_MONTH = 30 * 24 * 60 * 60;

    beforeEach(async function () {
        [owner, user1] = await ethers.getSigners();

        // 1. Deploy Badges
        const Badges = await ethers.getContractFactory("SocietyProtocolBadges");
        badges = (await upgrades.deployProxy(Badges, [], { initializer: 'initialize' })) as unknown as SocietyProtocolBadges;
        await badges.waitForDeployment();

        // 2. Deploy Staking Token
        const Token = await ethers.getContractFactory("SPEC");
        stakingToken = (await Token.deploy()) as unknown as SPEC;
        await stakingToken.waitForDeployment();

        // 3. Deploy VIP Manager via Proxy
        const VipManager = await ethers.getContractFactory("SocietyVipManager");
        vipManager = (await upgrades.deployProxy(VipManager, [], { initializer: false })) as unknown as SocietyVipManager;
        await vipManager.waitForDeployment();

        // 4. Create Governor Badge for owner
        const govTx = await badges.createBadge("Governor", false, true, ethers.ZeroAddress, "ipfs://gov", [2], [], [], [owner.address]);
        const govReceipt = await govTx.wait();
        const govEvent = govReceipt?.logs.find((l: any) => l.fragment && l.fragment.name === 'BadgeCreated') as any;
        const governorBadgeId = govEvent?.args[0];

        // Mint Governor badge to owner
        await badges.mint(owner.address, governorBadgeId, 1, "0x");

        // 5. Initialize Manager
        await vipManager.initialize(await stakingToken.getAddress(), await badges.getAddress(), governorBadgeId);

        // Fund user1
        await stakingToken.transfer(user1.address, ethers.parseEther("20000"));
        await stakingToken.connect(user1).approve(await vipManager.getAddress(), ethers.MaxUint256);
    });

    it("Should initialize with correct values and create badges", async function () {
        expect(await vipManager.owner()).to.equal(owner.address);
        expect(await vipManager.bronzeBadgeId()).to.be.gt(0);
        expect(await vipManager.silverBadgeId()).to.be.gt(0);
        expect(await vipManager.goldBadgeId()).to.be.gt(0);

        expect(await vipManager.bronzeAmount()).to.equal(BRONZE_AMOUNT);
    });

    it("Should return correct balances based on locked amounts (Hierarchical)", async function () {
        const bronzeId = await vipManager.bronzeBadgeId();
        const silverId = await vipManager.silverBadgeId();
        const goldId = await vipManager.goldBadgeId();

        // Lock 500 TEST -> Should get Bronze
        await vipManager.connect(user1).lock(ethers.parseEther("500"), ONE_MONTH);

        expect(await badges.balanceOf(user1.address, bronzeId)).to.equal(1);
        expect(await badges.balanceOf(user1.address, silverId)).to.equal(0);
        expect(await badges.balanceOf(user1.address, goldId)).to.equal(0);

        // Lock another 600 TEST -> Total 1100 -> Should get Silver AND Bronze
        await vipManager.connect(user1).lock(ethers.parseEther("600"), ONE_MONTH);

        expect(await badges.balanceOf(user1.address, bronzeId)).to.equal(1);
        expect(await badges.balanceOf(user1.address, silverId)).to.equal(1);
        expect(await badges.balanceOf(user1.address, goldId)).to.equal(0);

        // Lock another 10000 TEST -> Total 11100 -> Should get Gold, Silver, and Bronze
        await vipManager.connect(user1).lock(ethers.parseEther("10000"), ONE_MONTH);

        expect(await badges.balanceOf(user1.address, goldId)).to.equal(1);
        expect(await badges.balanceOf(user1.address, silverId)).to.equal(1);
        expect(await badges.balanceOf(user1.address, bronzeId)).to.equal(1);
    });

    it("Should fail if locking less than bronze amount", async function () {
        await expect(
            vipManager.connect(user1).lock(ethers.parseEther("50"), ONE_MONTH)
        ).to.be.revertedWithCustomError(vipManager, "InsufficientAmount");
    });

    it("Should set balance to 0 after lock expires", async function () {
        const bronzeId = await vipManager.bronzeBadgeId();
        await vipManager.connect(user1).lock(BRONZE_AMOUNT, ONE_MONTH);
        expect(await badges.balanceOf(user1.address, bronzeId)).to.equal(1);

        // Advance time
        await time.increase(ONE_MONTH + 1);

        expect(await badges.balanceOf(user1.address, bronzeId)).to.equal(0);
    });

    it("Should allow owner to change tier amounts", async function () {
        const newBronze = ethers.parseEther("500");
        await vipManager.setTierAmounts(newBronze, SILVER_AMOUNT, GOLD_AMOUNT);
        expect(await vipManager.bronzeAmount()).to.equal(newBronze);

        // Now locking 100 should fail
        await expect(
            vipManager.connect(user1).lock(BRONZE_AMOUNT, ONE_MONTH)
        ).to.be.revertedWithCustomError(vipManager, "InsufficientAmount");
    });

    it("Should allow unlocking after expiration", async function () {
        await vipManager.connect(user1).lock(BRONZE_AMOUNT, ONE_MONTH);

        await expect(vipManager.connect(user1).unlock()).to.be.revertedWithCustomError(vipManager, "LockStillActive");

        await time.increase(ONE_MONTH + 1);
        const before = await stakingToken.balanceOf(user1.address);
        await vipManager.connect(user1).unlock();
        const after = await stakingToken.balanceOf(user1.address);

        expect(after - before).to.equal(BRONZE_AMOUNT);
    });

    describe("VipManager Edge Cases", function () {
        it("Should revert if duration is less than MIN_LOCK_DURATION", async function () {
            await expect(
                vipManager.connect(user1).lock(BRONZE_AMOUNT, ONE_MONTH - 1)
            ).to.be.revertedWithCustomError(vipManager, "LockDurationTooShort");
        });

        it("Should revert if unlocking with no tokens locked", async function () {
            const [, , , user2] = await ethers.getSigners();
            await expect(
                vipManager.connect(user2).unlock()
            ).to.be.revertedWithCustomError(vipManager, "NoTokensLocked");
        });

        it("Should properly extend an existing lock", async function () {
            await vipManager.connect(user1).lock(BRONZE_AMOUNT, ONE_MONTH);
            const lockBefore = await vipManager.locks(user1.address);

            // Add more tokens and extend duration
            await vipManager.connect(user1).lock(BRONZE_AMOUNT, ONE_MONTH * 2);
            const lockAfter = await vipManager.locks(user1.address);

            expect(lockAfter.amount).to.equal(BRONZE_AMOUNT * 2n);
            expect(lockAfter.unlockTime).to.be.gt(lockBefore.unlockTime);
        });

        it("Should deny direct mint/transfer/burn via VIP hook", async function () {
            const bronzeId = await vipManager.bronzeBadgeId();

            expect(await vipManager.onCheckMint(owner.address, user1.address, bronzeId, 1))
                .to.be.false;
            expect(await vipManager.onCheckTransfer(owner.address, user1.address, owner.address, bronzeId, 1))
                .to.be.false;
            expect(await vipManager.onCheckBurn(owner.address, user1.address, bronzeId, 1))
                .to.be.false;
        });

        it("Should only allow owner to set tier amounts", async function () {
            await expect(vipManager.connect(user1).setTierAmounts(1, 2, 3))
                .to.be.revertedWithCustomError(vipManager, "OwnableUnauthorizedAccount");
        });
    });

    describe("Hook Priority & Fallback Logic", function () {
        it("Should allow minting using rules if NO hook is configured", async function () {
            // Create a community badge with PERM_SELF to allow self-minting
            const rules: any[] = [1]; // PERM_SELF
            const editors = [owner.address];

            const tx = await badges.createBadge("Fallback Test", false, true, ethers.ZeroAddress, "ipfs://fallback", rules, rules, rules, editors);
            const receipt = await tx.wait();
            const event = receipt?.logs.find((l: any) => l.fragment && l.fragment.name === 'BadgeCreated') as any;
            const badgeId = event?.args[0];

            // User1 should be able to self-mint because PERM_SELF is in rules
            await expect(badges.connect(user1).mint(user1.address, badgeId, 1, "0x"))
                .to.emit(badges, "TransferSingle");

            expect(await badges.balanceOf(user1.address, badgeId)).to.equal(1);
        });
    });

    describe("Upgradeability", function () {
        it("Should allow owner to upgrade the contract", async function () {
            const VipManagerV2 = await ethers.getContractFactory("SocietyVipManager");
            const upgraded = await upgrades.upgradeProxy(await vipManager.getAddress(), VipManagerV2);
            expect(await upgraded.getAddress()).to.equal(await vipManager.getAddress());
        });

        it("Should NOT allow non-owner to upgrade", async function () {
            const VipManagerV2 = await ethers.getContractFactory("SocietyVipManager");
            // Hardhat upgrades doesn't easily test rejection of upgrade by non-owner via high-level API
            // But we can check it via low-level call if needed or trust the onlyOwner modifier in _authorizeUpgrade
            // To properly test rejection:
            const proxy = (await ethers.getContractAt("UUPSUpgradeable", await vipManager.getAddress())) as any;
            const newImpl = await (await VipManagerV2.deploy()).getAddress();

            await expect(proxy.connect(user1).upgradeToAndCall(newImpl, "0x"))
                .to.be.reverted; // usually reverted with Ownable error or custom error if we used it
        });
    });
});
