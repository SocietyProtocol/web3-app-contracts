import { expect } from "chai";
import { ethers } from "hardhat";
import { SocietyProtocolBadges, SoulboundStrategy, TransferableStrategy } from "../typechain-types";

describe("Society Protocol Badges", function () {
    let badges: SocietyProtocolBadges;
    let soulbound: SoulboundStrategy;
    let transferable: TransferableStrategy;
    let owner: any;
    let minter: any;
    let user1: any;
    let user2: any;

    beforeEach(async function () {
        [owner, minter, user1, user2] = await ethers.getSigners();

        // Deploy Badges
        const Badges = await ethers.getContractFactory("SocietyProtocolBadges");
        badges = await Badges.deploy();
        await badges.waitForDeployment();

        // Grant MINTER_ROLE
        const MINTER_ROLE = await badges.MINTER_ROLE();
        await badges.grantRole(MINTER_ROLE, minter.address);
    });

    describe("Badges", function () {
        it("Should have 3 preconfigured official badges", async function () {
            const badge1 = await badges.badges(1);
            expect(badge1.name).to.equal("Official Member");
            expect(badge1.isOfficial).to.be.true;

            const badge2 = await badges.badges(2);
            expect(badge2.name).to.equal("Community Partner");
            expect(badge2.isOfficial).to.be.true;

            const badge3 = await badges.badges(3);
            expect(badge3.name).to.equal("VIP Access");
            expect(badge3.isOfficial).to.be.true;
        });

        it("Governor should be able to create official badges", async function () {
            // Get transferable strategy address from badge 2
            const badge2 = await badges.badges(2);
            const strategyAddr = badge2.strategy;

            await badges.createBadge("New Official Badge", strategyAddr, "ipfs://new-official");
            const newBadge = await badges.badges(4);
            expect(newBadge.isOfficial).to.be.true;
        });

        it("Minter should be able to create unofficial badges", async function () {
            // Get transferable strategy address from badge 2
            const badge2 = await badges.badges(2);
            const strategyAddr = badge2.strategy;

            await badges.connect(minter).createBadge("Community Badge", strategyAddr, "ipfs://community");
            const newBadge = await badges.badges(4);
            expect(newBadge.isOfficial).to.be.false;
        });

        it("Should enforce soulbound strategy", async function () {
            // Mint Soulbound badge (ID 1) to user1
            await badges.mint(user1.address, 1, 1, "0x");

            // Try to transfer
            await expect(
                badges.connect(user1).safeTransferFrom(user1.address, user2.address, 1, 1, "0x")
            ).to.be.revertedWith("Transfer not allowed by strategy");
        });

        it("Should allow transferable strategy", async function () {
            // Mint Transferable badge (ID 2) to user1
            await badges.mint(user1.address, 2, 1, "0x");

            // Transfer
            await badges.connect(user1).safeTransferFrom(user1.address, user2.address, 2, 1, "0x");
            expect(await badges.balanceOf(user2.address, 2)).to.equal(1);
        });
    });
});
