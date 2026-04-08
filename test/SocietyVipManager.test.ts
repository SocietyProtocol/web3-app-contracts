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

    const BRONZE_AMOUNT = ethers.parseEther("400000");
    const SILVER_AMOUNT = ethers.parseEther("2000000");
    const GOLD_AMOUNT = ethers.parseEther("10000000");
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

        // 3. Create Governor Badge for owner
        const govTx = await badges.createBadge("Governor", true, false, ethers.ZeroAddress, "ipfs://gov", [2], [], [], [owner.address]);
        const govReceipt = await govTx.wait();
        const govEvent = govReceipt?.logs.find((l: any) => l.fragment && l.fragment.name === 'BadgeCreated') as any;
        const governorBadgeId = govEvent?.args[0];

        // Mint Governor badge to owner
        await badges.mint(owner.address, governorBadgeId, 1, "0x");

        // 4. Create official VIP tier badges (mirrors deploy script)
        const bronzeTx = await badges.createBadge("Bronze VIP", true, false, ethers.ZeroAddress, "", [], [], [governorBadgeId], [owner.address]);
        const bronzeReceipt = await bronzeTx.wait();
        const bronzeEvent = bronzeReceipt?.logs.find((l: any) => l.fragment && l.fragment.name === 'BadgeCreated') as any;
        const bronzeBadgeId = bronzeEvent?.args[0];

        const silverTx = await badges.createBadge("Silver VIP", true, false, ethers.ZeroAddress, "", [], [], [governorBadgeId], [owner.address]);
        const silverReceipt = await silverTx.wait();
        const silverEvent = silverReceipt?.logs.find((l: any) => l.fragment && l.fragment.name === 'BadgeCreated') as any;
        const silverBadgeId = silverEvent?.args[0];

        const goldTx = await badges.createBadge("Gold VIP", true, false, ethers.ZeroAddress, "", [], [], [governorBadgeId], [owner.address]);
        const goldReceipt = await goldTx.wait();
        const goldEvent = goldReceipt?.logs.find((l: any) => l.fragment && l.fragment.name === 'BadgeCreated') as any;
        const goldBadgeId = goldEvent?.args[0];

        // 5. Deploy VIP Manager with badge IDs and tier amounts in one call
        const VipManager = await ethers.getContractFactory("SocietyVipManager");
        vipManager = (await upgrades.deployProxy(VipManager, [
            await stakingToken.getAddress(),
            bronzeBadgeId,
            silverBadgeId,
            goldBadgeId,
            BRONZE_AMOUNT,
            SILVER_AMOUNT,
            GOLD_AMOUNT,
        ], { initializer: 'initialize' })) as unknown as SocietyVipManager;
        await vipManager.waitForDeployment();

        // 6. Wire up the hooks on each badge to point to VIP Manager
        const vipManagerAddress = await vipManager.getAddress();
        await badges.setBadgeHook(bronzeBadgeId, vipManagerAddress);
        await badges.setBadgeHook(silverBadgeId, vipManagerAddress);
        await badges.setBadgeHook(goldBadgeId, vipManagerAddress);

        // Fund user1 with enough for Gold tier (10M+)
        await stakingToken.transfer(user1.address, ethers.parseEther("12000000"));
        await stakingToken.connect(user1).approve(await vipManager.getAddress(), ethers.MaxUint256);
    });

    it("Should initialize with correct values and accept badge IDs", async function () {
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

        // Lock 500,000 -> Should get Bronze
        await vipManager.connect(user1).lock(ethers.parseEther("500000"), ONE_MONTH);

        expect(await badges.balanceOf(user1.address, bronzeId)).to.equal(1);
        expect(await badges.balanceOf(user1.address, silverId)).to.equal(0);
        expect(await badges.balanceOf(user1.address, goldId)).to.equal(0);

        // Lock another 1,500,000 -> Total 2,000,000 -> Should get Silver AND Bronze
        await vipManager.connect(user1).lock(ethers.parseEther("1500000"), ONE_MONTH);

        expect(await badges.balanceOf(user1.address, bronzeId)).to.equal(1);
        expect(await badges.balanceOf(user1.address, silverId)).to.equal(1);
        expect(await badges.balanceOf(user1.address, goldId)).to.equal(0);

        // Lock another 8,000,000 -> Total 10,000,000 -> Should get Gold, Silver, and Bronze
        await vipManager.connect(user1).lock(ethers.parseEther("8000000"), ONE_MONTH);

        expect(await badges.balanceOf(user1.address, goldId)).to.equal(1);
        expect(await badges.balanceOf(user1.address, silverId)).to.equal(1);
        expect(await badges.balanceOf(user1.address, bronzeId)).to.equal(1);
    });

    it("Should fail if locking less than bronze amount", async function () {
        await expect(
            vipManager.connect(user1).lock(ethers.parseEther("300000"), ONE_MONTH)
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
        const newBronze = ethers.parseEther("500000");
        await vipManager.setTierAmounts(newBronze, SILVER_AMOUNT, GOLD_AMOUNT);
        expect(await vipManager.bronzeAmount()).to.equal(newBronze);

        // Now locking 400k (original bronze) should fail
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

            const tx = await badges.createBadge("Fallback Test", false, false, ethers.ZeroAddress, "ipfs://fallback", rules, rules, rules, editors);
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

    // -------------------------------------------------------------------------
    // Community Tiers
    // -------------------------------------------------------------------------

    describe("Community Tiers", function () {
        // Tier level constants (owner-defined identifiers, not badge IDs)
        const BRONZE = 1n;
        const SILVER = 2n;
        const GOLD   = 3n;
        const ONE_YEAR = 365 * 24 * 60 * 60;

        let communityId: bigint;  // the creator badge ID acting as the community identifier
        let creator: any;

        beforeEach(async function () {
            [, , , creator] = await ethers.getSigners();

            // Create a community creator badge (PERM_EVERYONE mint, PERM_SELF transfer)
            const tx = await badges.createBadge(
                "Test Community Creator", true, false, ethers.ZeroAddress, "",
                [2n], [1n], [], [owner.address]
            );
            const receipt = await tx.wait();
            const event = receipt?.logs.find((l: any) => l.fragment?.name === 'BadgeCreated') as any;
            communityId = event?.args[0];
            await badges.mint(creator.address, communityId, 1, "0x");
        });

        it("getCommunityTier returns (0, 0) when no grant exists", async function () {
            const [tierId, expiry] = await vipManager.getCommunityTier(communityId);
            expect(tierId).to.equal(0);
            expect(expiry).to.equal(0);
        });

        it("owner can grant a tier and getCommunityTier reflects it", async function () {
            await vipManager.grantCommunityTier(communityId, BRONZE, ONE_YEAR);
            const [tierId, expiry] = await vipManager.getCommunityTier(communityId);
            expect(tierId).to.equal(BRONZE);
            expect(expiry).to.be.gt(0);
        });

        it("non-owner cannot grant a tier", async function () {
            await expect(
                vipManager.connect(user1).grantCommunityTier(communityId, BRONZE, ONE_YEAR)
            ).to.be.revertedWithCustomError(vipManager, "OwnableUnauthorizedAccount");
        });

        it("reverts with InvalidTierAmounts when tierId is 0", async function () {
            await expect(
                vipManager.grantCommunityTier(communityId, 0, ONE_YEAR)
            ).to.be.revertedWithCustomError(vipManager, "InvalidTierAmounts");
        });

        it("reverts with LockDurationTooShort when duration is 0", async function () {
            await expect(
                vipManager.grantCommunityTier(communityId, BRONZE, 0)
            ).to.be.revertedWithCustomError(vipManager, "LockDurationTooShort");
        });

        it("getCommunityTier returns (0, 0) after grant expires", async function () {
            await vipManager.grantCommunityTier(communityId, BRONZE, ONE_YEAR);
            await time.increase(ONE_YEAR + 1);
            const [tierId] = await vipManager.getCommunityTier(communityId);
            expect(tierId).to.equal(0);
        });

        it("overwriting a grant replaces the tier", async function () {
            await vipManager.grantCommunityTier(communityId, BRONZE, ONE_YEAR);
            await vipManager.grantCommunityTier(communityId, SILVER, ONE_YEAR);
            const [tierId] = await vipManager.getCommunityTier(communityId);
            expect(tierId).to.equal(SILVER);
        });

        it("owner can revoke a tier; getCommunityTier immediately returns (0, 0)", async function () {
            await vipManager.grantCommunityTier(communityId, BRONZE, ONE_YEAR);
            await vipManager.revokeCommunityTier(communityId);
            const [tierId] = await vipManager.getCommunityTier(communityId);
            expect(tierId).to.equal(0);
        });

        it("non-owner cannot revoke a tier", async function () {
            await vipManager.grantCommunityTier(communityId, BRONZE, ONE_YEAR);
            await expect(
                vipManager.connect(user1).revokeCommunityTier(communityId)
            ).to.be.revertedWithCustomError(vipManager, "OwnableUnauthorizedAccount");
        });

        it("revoking a never-granted community is a no-op", async function () {
            await vipManager.grantCommunityTier(communityId, BRONZE, ONE_YEAR);
            await expect(vipManager.revokeCommunityTier(9999n)).to.not.be.reverted;
            const [tierId] = await vipManager.getCommunityTier(communityId);
            expect(tierId).to.equal(BRONZE);  // real grant untouched
        });

        it("revoking an already-revoked community is a no-op", async function () {
            await vipManager.grantCommunityTier(communityId, BRONZE, ONE_YEAR);
            await vipManager.revokeCommunityTier(communityId);
            await expect(vipManager.revokeCommunityTier(communityId)).to.not.be.reverted;
        });

        it("two communities hold different tiers independently", async function () {
            const tx2 = await badges.createBadge("Community 2", true, false, ethers.ZeroAddress, "", [2n], [1n], [], [owner.address]);
            const receipt2 = await tx2.wait();
            const event2 = receipt2?.logs.find((l: any) => l.fragment?.name === 'BadgeCreated') as any;
            const community2Id = event2?.args[0];

            await vipManager.grantCommunityTier(communityId,   BRONZE, ONE_YEAR);
            await vipManager.grantCommunityTier(community2Id, GOLD,   ONE_YEAR);

            const [tier1] = await vipManager.getCommunityTier(communityId);
            const [tier2] = await vipManager.getCommunityTier(community2Id);
            expect(tier1).to.equal(BRONZE);
            expect(tier2).to.equal(GOLD);
        });

        it("staking tiers are unaffected by community tier operations", async function () {
            const bronzeId = await vipManager.bronzeBadgeId();
            await vipManager.connect(user1).lock(BRONZE_AMOUNT, ONE_MONTH);
            expect(await badges.balanceOf(user1.address, bronzeId)).to.equal(1);

            await vipManager.grantCommunityTier(communityId, BRONZE, ONE_YEAR);
            // staking balance unchanged
            expect(await badges.balanceOf(user1.address, bronzeId)).to.equal(1);
        });
    });
});
