import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SocietyProtocolBadges } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("SocietyProtocolBadges - Invite System", function () {
    let badges: SocietyProtocolBadges;
    let owner: SignerWithAddress;
    let inviter: SignerWithAddress;
    let invitee: SignerWithAddress;
    let other: SignerWithAddress;

    const SEVEN_DAYS = 7 * 24 * 60 * 60;

    beforeEach(async function () {
        [owner, inviter, invitee, other] = await ethers.getSigners();

        const Badges = await ethers.getContractFactory("SocietyProtocolBadges");
        badges = (await upgrades.deployProxy(Badges, [], {
            initializer: "initialize",
        })) as unknown as SocietyProtocolBadges;
        await badges.waitForDeployment();
    });

    // ─── Helpers ──────────────────────────────────────────────────────────────

    async function signInvite(
        signer: SignerWithAddress,
        inviterAddr: string,
        inviteeAddr: string,
        nonce: bigint,
        expiry: bigint
    ): Promise<string> {
        const domain = {
            name: "SocietyProtocol",
            version: "1",
            chainId: (await ethers.provider.getNetwork()).chainId,
            verifyingContract: await badges.getAddress(),
        };
        const types = {
            Invite: [
                { name: "inviter",  type: "address" },
                { name: "invitee",  type: "address" },
                { name: "nonce",    type: "uint256" },
                { name: "expiry",   type: "uint256" },
            ],
        };
        return signer.signTypedData(domain, types, { inviter: inviterAddr, invitee: inviteeAddr, nonce, expiry });
    }

    async function makeInvite(
        signer: SignerWithAddress,
        inviteeAddr: string,
        nonce: bigint = 1n,
        durationSeconds: number = SEVEN_DAYS
    ) {
        const expiry = BigInt(await time.latest()) + BigInt(durationSeconds);
        const signature = await signInvite(signer, signer.address, inviteeAddr, nonce, expiry);
        return { nonce, expiry, signature };
    }

    // ─── Happy path ───────────────────────────────────────────────────────────

    it("accepts a valid invite and emits UserInvited", async function () {
        const { nonce, expiry, signature } = await makeInvite(inviter, invitee.address);
        await expect(
            badges.connect(invitee).acceptInvite(inviter.address, nonce, expiry, signature)
        ).to.emit(badges, "UserInvited").withArgs(inviter.address, invitee.address, nonce);

        expect(await badges.hasInvited(inviter.address, invitee.address)).to.be.true;
    });

    it("records invitee in getInvitees", async function () {
        const { nonce, expiry, signature } = await makeInvite(inviter, invitee.address);
        await badges.connect(invitee).acceptInvite(inviter.address, nonce, expiry, signature);

        const invitees = await badges.getInvitees(inviter.address);
        expect(invitees).to.deep.equal([invitee.address]);
    });

    it("one inviter can invite multiple addresses with different nonces", async function () {
        const inv1 = await makeInvite(inviter, invitee.address, 1n);
        const inv2 = await makeInvite(inviter, other.address,   2n);

        await badges.connect(invitee).acceptInvite(inviter.address, inv1.nonce, inv1.expiry, inv1.signature);
        await badges.connect(other).acceptInvite(inviter.address,   inv2.nonce, inv2.expiry, inv2.signature);

        const invitees = await badges.getInvitees(inviter.address);
        expect(invitees.length).to.equal(2);
        expect(invitees).to.include(invitee.address);
        expect(invitees).to.include(other.address);
    });

    // ─── Expiry ───────────────────────────────────────────────────────────────

    it("reverts with SignatureExpired when past expiry", async function () {
        const { nonce, expiry, signature } = await makeInvite(inviter, invitee.address, 1n, 60);
        await time.increase(61);
        await expect(
            badges.connect(invitee).acceptInvite(inviter.address, nonce, expiry, signature)
        ).to.be.revertedWithCustomError(badges, "SignatureExpired");
    });

    it("accepts an invite exactly at expiry boundary", async function () {
        const { nonce, expiry, signature } = await makeInvite(inviter, invitee.address, 1n, SEVEN_DAYS);
        await time.setNextBlockTimestamp(expiry);
        await expect(
            badges.connect(invitee).acceptInvite(inviter.address, nonce, expiry, signature)
        ).to.not.be.reverted;
    });

    // ─── Signature validation ─────────────────────────────────────────────────

    it("reverts with InvalidSignature when signed by wrong address", async function () {
        const { nonce, expiry, signature } = await makeInvite(other, invitee.address);
        await expect(
            badges.connect(invitee).acceptInvite(inviter.address, nonce, expiry, signature)
        ).to.be.revertedWithCustomError(badges, "InvalidSignature");
    });

    it("reverts with InvalidSignature when a different invitee tries to use the signature", async function () {
        const { nonce, expiry, signature } = await makeInvite(inviter, invitee.address);
        await expect(
            badges.connect(other).acceptInvite(inviter.address, nonce, expiry, signature)
        ).to.be.revertedWithCustomError(badges, "InvalidSignature");
    });

    // ─── Replay & duplicates ──────────────────────────────────────────────────

    it("reverts with NonceAlreadyUsed on replay with same nonce", async function () {
        const { nonce, expiry, signature } = await makeInvite(inviter, invitee.address, 1n);
        await badges.connect(invitee).acceptInvite(inviter.address, nonce, expiry, signature);

        const sig2 = await signInvite(inviter, inviter.address, other.address, nonce, expiry);
        await expect(
            badges.connect(other).acceptInvite(inviter.address, nonce, expiry, sig2)
        ).to.be.revertedWithCustomError(badges, "NonceAlreadyUsed");
    });

    it("reverts with AlreadyInvited when same pair accepts twice", async function () {
        const inv1 = await makeInvite(inviter, invitee.address, 1n);
        await badges.connect(invitee).acceptInvite(inviter.address, inv1.nonce, inv1.expiry, inv1.signature);

        const inv2 = await makeInvite(inviter, invitee.address, 2n);
        await expect(
            badges.connect(invitee).acceptInvite(inviter.address, inv2.nonce, inv2.expiry, inv2.signature)
        ).to.be.revertedWithCustomError(badges, "AlreadyInvited");
    });

    // ─── Self-invite ──────────────────────────────────────────────────────────

    it("reverts with SelfInvitation when inviter == invitee", async function () {
        const { nonce, expiry, signature } = await makeInvite(inviter, inviter.address);
        await expect(
            badges.connect(inviter).acceptInvite(inviter.address, nonce, expiry, signature)
        ).to.be.revertedWithCustomError(badges, "SelfInvitation");
    });
});
