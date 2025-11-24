import { expect } from "chai";
import { ethers } from "hardhat";
import { SocietyProtocolBadges } from "../typechain-types";

describe("Society Protocol Badges", function () {
    let badges: SocietyProtocolBadges;
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

        it("Governor should be able to create official badges with permissions", async function () {
            // Create badge where user1 can mint, user2 can transfer
            await badges.createBadge(
                "New Official Badge",
                "ipfs://new-official",
                [user1.address], // minters
                [user2.address], // transferers
                [] // burners
            );
            const newBadge = await badges.badges(4);
            expect(newBadge.isOfficial).to.be.true;

            // Verify permissions
            expect(await badges.canMint(4, user1.address)).to.be.true;
            expect(await badges.canTransfer(4, user2.address)).to.be.true;
        });

        it("Minter should be able to create unofficial badges", async function () {
            await badges.connect(minter).createBadge(
                "Community Badge",
                "ipfs://community",
                [minter.address],
                [],
                []
            );
            const newBadge = await badges.badges(4);
            expect(newBadge.isOfficial).to.be.false;
        });

        it("Should enforce mint permissions", async function () {
            // Create badge where ONLY user1 can mint
            await badges.createBadge(
                "Mint Restricted",
                "ipfs://mint-restricted",
                [user1.address],
                [],
                []
            );
            const id = 4;

            // User2 tries to mint -> Fail
            await expect(
                badges.connect(user2).mint(user2.address, id, 1, "0x")
            ).to.be.revertedWith("Not authorized to mint");

            // User1 mints -> Success
            await badges.connect(user1).mint(user2.address, id, 1, "0x");
            expect(await badges.balanceOf(user2.address, id)).to.equal(1);
        });

        it("Should enforce transfer permissions", async function () {
            // Create badge where ONLY user2 can transfer (e.g. an operator or the user themselves if added)
            // Note: In our logic, `canTransfer[id][msg.sender]` is checked.
            // If we want users to be able to transfer their own tokens, they must be in the `canTransfer` mapping.
            // Or we need a logic "if msg.sender == from, allow". 
            // But the requirement was "WHO can transfer... nested mappings".
            // So let's assume strict whitelist for now as per instructions.

            await badges.createBadge(
                "Transfer Restricted",
                "ipfs://transfer-restricted",
                [owner.address], // owner can mint
                [user1.address], // user1 can transfer
                []
            );
            const id = 4;

            // Mint to user1
            await badges.mint(user1.address, id, 1, "0x");

            // User1 tries to transfer -> Success (because user1 is in transferers)
            await badges.connect(user1).safeTransferFrom(user1.address, user2.address, id, 1, "0x");
            expect(await badges.balanceOf(user2.address, id)).to.equal(1);

            // User2 tries to transfer back -> Fail (user2 is NOT in transferers)
            await expect(
                badges.connect(user2).safeTransferFrom(user2.address, user1.address, id, 1, "0x")
            ).to.be.revertedWith("Not authorized to transfer");
        });
    });
});
