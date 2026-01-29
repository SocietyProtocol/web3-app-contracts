import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SocietyProtocolBadges } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("Society Protocol Badges - Invite System", function () {
    let badges: SocietyProtocolBadges;
    let owner: SignerWithAddress;
    let inviter: SignerWithAddress;
    let guest: SignerWithAddress;
    let other: SignerWithAddress;

    beforeEach(async function () {
        [owner, inviter, guest, other] = await ethers.getSigners();

        const Badges = await ethers.getContractFactory("SocietyProtocolBadges");
        badges = (await upgrades.deployProxy(Badges, [], {
            initializer: "initialize",
        })) as unknown as SocietyProtocolBadges;
        await badges.waitForDeployment();
    });

    async function getInviteSignature(
        signer: SignerWithAddress,
        inviterAddr: string,
        guestAddr: string,
        message?: string
    ) {
        const domain = {
            name: "SocietyProtocol",
            version: "1",
            chainId: (await ethers.provider.getNetwork()).chainId,
            verifyingContract: await badges.getAddress(),
        };

        const types = {
            Invite: [
                { name: "inviter", type: "address" },
                { name: "message", type: "string" },
            ],
        };

        const defaultMessage = `Sign this message to generate a referral code for the address: ${guestAddr.toLowerCase()}`;
        const finalMessage = message ?? defaultMessage;

        const value = {
            inviter: inviterAddr,
            message: finalMessage,
        };

        const signature = await signer.signTypedData(domain, types, value);
        return { signature, message: finalMessage };
    }

    it("Should allow a user to accept a valid invite with production message", async function () {
        const { signature, message } = await getInviteSignature(
            inviter,
            inviter.address,
            guest.address
        );

        // message: "Sign this message to generate a referral code for the address: <guest>"
        await expect(badges.connect(guest).acceptInvite(inviter.address, message, signature))
            .to.emit(badges, "UserInvited")
            .withArgs(guest.address, inviter.address);

        expect(await badges.invitedBy(guest.address)).to.equal(inviter.address);
    });

    it("Should allow a user to accept an invite with a custom message prefix (as long as it ends with guest address)", async function () {
        const customMessage = `Welcome to the Society! Please accept this invite for: ${guest.address.toLowerCase()}`;
        const { signature, message } = await getInviteSignature(
            inviter,
            inviter.address,
            guest.address,
            customMessage
        );

        await expect(badges.connect(guest).acceptInvite(inviter.address, message, signature))
            .to.emit(badges, "UserInvited")
            .withArgs(guest.address, inviter.address);

        expect(await badges.invitedBy(guest.address)).to.equal(inviter.address);
    });

    it("Should reject an invite with an invalid signature (wrong signer)", async function () {
        const { signature, message } = await getInviteSignature(
            other,
            inviter.address,
            guest.address
        );

        await expect(
            badges.connect(guest).acceptInvite(inviter.address, message, signature)
        ).to.be.revertedWithCustomError(badges, "InvalidSignature");
    });

    it("Should reject an invite intended for another guest (address mismatch in message)", async function () {
        // Signer signs a message for 'other', but 'guest' tries to use it.
        const { signature, message } = await getInviteSignature(
            inviter,
            inviter.address,
            other.address
        );

        await expect(
            badges.connect(guest).acceptInvite(inviter.address, message, signature)
        ).to.be.revertedWithCustomError(badges, "InvalidSignature");
    });

    it("Should reject an invite if the message body doesn't end with guest's address", async function () {
        const { signature } = await getInviteSignature(
            inviter,
            inviter.address,
            guest.address
        );
        const wrongMessage = `This message ends with someone else: ${other.address.toLowerCase()}`;

        await expect(
            badges.connect(guest).acceptInvite(inviter.address, wrongMessage, signature)
        ).to.be.revertedWithCustomError(badges, "InvalidSignature");
    });

    it("Should reject an invite with the wrong inviter address provided", async function () {
        const { signature, message } = await getInviteSignature(
            inviter,
            inviter.address,
            guest.address
        );

        await expect(
            badges.connect(guest).acceptInvite(owner.address, message, signature)
        ).to.be.revertedWithCustomError(badges, "InvalidSignature");
    });

    it("Should reject duplicate invite acceptance", async function () {
        const { signature: signature1, message: message1 } = await getInviteSignature(
            inviter,
            inviter.address,
            guest.address
        );
        await badges.connect(guest).acceptInvite(inviter.address, message1, signature1);

        const { signature: signature2, message: message2 } = await getInviteSignature(
            other,
            other.address,
            guest.address
        );
        await expect(
            badges.connect(guest).acceptInvite(other.address, message2, signature2)
        ).to.be.revertedWithCustomError(badges, "AlreadyInvited");
    });

    it("Should reject self-invitation", async function () {
        const { signature, message } = await getInviteSignature(
            guest,
            guest.address,
            guest.address
        );

        await expect(
            badges.connect(guest).acceptInvite(guest.address, message, signature)
        ).to.be.revertedWithCustomError(badges, "SelfInvitation");
    });
});
