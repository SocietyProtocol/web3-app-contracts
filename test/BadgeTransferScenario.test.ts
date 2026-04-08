import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SocietyProtocolBadges } from "../typechain-types";

const PERM_NONE = 0n;
const PERM_SELF = 1n;
const PERM_EVERYONE = 2n;
const STARTING_BADGE_ID = 10n;

describe("Badge Transfer & Burn Scenario (Overridden Approvals)", function () {
    let badges: SocietyProtocolBadges;
    let owner: any;
    let user1: any;
    let user2: any;
    let badgeA: bigint;
    let badgeB: bigint;
    let badgeC: bigint;

    beforeEach(async function () {
        [owner, user1, user2] = await ethers.getSigners();

        // Deploy Badges via Proxy
        const Badges = await ethers.getContractFactory("SocietyProtocolBadges");
        badges = (await upgrades.deployProxy(Badges, [], { initializer: 'initialize' })) as unknown as SocietyProtocolBadges;
        await badges.waitForDeployment();

        // 1. Create Badge A with no transferability/burn option
        await badges.connect(user1).createBadge(
            "Badge A (Non-transferable/Non-burnable)",
            false,
            false,
            ethers.ZeroAddress,
            "ipfs://badgeA",
            [PERM_EVERYONE], // Mint
            [],              // Transfer (Empty = Non-transferable)
            [],              // Burn (Empty = Non-burnable)
            [user1.address]  // Editors
        );
        badgeA = STARTING_BADGE_ID + 1n;

        // 2. Create Badge B with transferability from Badge A
        await badges.connect(user1).createBadge(
            "Badge B (Transfer Gated by Badge A)",
            false,
            false,
            ethers.ZeroAddress,
            "ipfs://badgeB",
            [PERM_EVERYONE], // Mint
            [badgeA],        // Transfer (Requires holding Badge A)
            [],              // Burn
            [user1.address]  // Editors
        );
        badgeB = STARTING_BADGE_ID + 2n;

        // 3. Create Badge C with burn permission from Badge A
        await badges.connect(user1).createBadge(
            "Badge C (Burn Gated by Badge A)",
            false,
            false,
            ethers.ZeroAddress,
            "ipfs://badgeC",
            [PERM_EVERYONE], // Mint
            [],              // Transfer
            [badgeA],        // Burn (Requires holding Badge A)
            [user1.address]  // Editors
        );
        badgeC = STARTING_BADGE_ID + 3n;

        // Mint badges to User1
        await badges.connect(user1).mint(user1.address, badgeA, 1, "0x");
        await badges.connect(user1).mint(user1.address, badgeB, 1, "0x");
        await badges.connect(user1).mint(user1.address, badgeC, 1, "0x");

        // NOTE: We do NOT call setApprovalForAll
    });

    describe("Transfer Scenarios", function () {
        it("Should NOT allow an unauthorized operator to transfer a non-transferable badge (Badge A)", async function () {
            await expect(
                badges.connect(user2).safeTransferFrom(user1.address, user2.address, badgeA, 1, "0x")
            ).to.be.revertedWithCustomError(badges, "TransferNotAuthorized");
        });

        it("Should NOT allow an unauthorized operator to transfer a gated badge (Badge B) without holding the gatekeeper badge (Badge A)", async function () {
            expect(await badges.balanceOf(user2.address, badgeA)).to.equal(0n);
            await expect(
                badges.connect(user2).safeTransferFrom(user1.address, user2.address, badgeB, 1, "0x")
            ).to.be.revertedWithCustomError(badges, "TransferNotAuthorized");
        });

        it("Should ALLOW an unauthorized operator to transfer a gated badge (Badge B) if they hold the gatekeeper badge (Badge A)", async function () {
            await badges.connect(user2).mint(user2.address, badgeA, 1, "0x");
            await expect(
                badges.connect(user2).safeTransferFrom(user1.address, user2.address, badgeB, 1, "0x")
            ).to.not.be.reverted;

            expect(await badges.balanceOf(user2.address, badgeB)).to.equal(1n);
            expect(await badges.balanceOf(user1.address, badgeB)).to.equal(0n);
        });
    });

    describe("Burn Scenarios", function () {
        it("Should NOT allow an unauthorized operator to burn a non-burnable badge (Badge A)", async function () {
            await expect(
                badges.connect(user2).burn(user1.address, badgeA, 1)
            ).to.be.revertedWithCustomError(badges, "BurnNotAuthorized");
        });

        it("Should NOT allow an unauthorized operator to burn a gated badge (Badge C) without holding the burner badge (Badge A)", async function () {
            expect(await badges.balanceOf(user2.address, badgeA)).to.equal(0n);
            await expect(
                badges.connect(user2).burn(user1.address, badgeC, 1)
            ).to.be.revertedWithCustomError(badges, "BurnNotAuthorized");
        });

        it("Should ALLOW an unauthorized operator to burn a gated badge (Badge C) if they hold the burner badge (Badge A)", async function () {
            await badges.connect(user2).mint(user2.address, badgeA, 1, "0x");
            await expect(
                badges.connect(user2).burn(user1.address, badgeC, 1)
            ).to.not.be.reverted;

            expect(await badges.balanceOf(user1.address, badgeC)).to.equal(0n);
            expect(await badges.getFunction("totalSupply(uint256)")(badgeC)).to.equal(0n);
        });

        it("Should ALLOW an unauthorized operator to burn multiple badges if they hold the burner badge", async function () {
            // Create another burnable badge gated by A
            await badges.connect(user1).createBadge(
                "Badge D (Burn Gated by A)",
                false,
                false,
                ethers.ZeroAddress,
                "ipfs://badgeD",
                [PERM_EVERYONE], [], [badgeA], [user1.address]
            );
            const badgeD = STARTING_BADGE_ID + 4n;
            await badges.connect(user1).mint(user1.address, badgeD, 1, "0x");

            await badges.connect(user2).mint(user2.address, badgeA, 1, "0x");

            await expect(
                badges.connect(user2).burnBatch(user1.address, [badgeC, badgeD], [1, 1])
            ).to.not.be.reverted;

            expect(await badges.balanceOf(user1.address, badgeC)).to.equal(0n);
            expect(await badges.balanceOf(user1.address, badgeD)).to.equal(0n);
        });
    });
});
