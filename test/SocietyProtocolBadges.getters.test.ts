import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SocietyProtocolBadges } from "../typechain-types";

describe("SocietyProtocolBadges Getters & Events", function () {
    let badges: SocietyProtocolBadges;
    let owner: any;
    let creator: any;
    let user1: any;

    const PERM_EVERYONE = 2n;
    const STARTING_BADGE_ID = 10n;

    beforeEach(async function () {
        [owner, creator, user1] = await ethers.getSigners();

        const Badges = await ethers.getContractFactory("SocietyProtocolBadges");
        badges = (await upgrades.deployProxy(Badges, [], { initializer: 'initialize' })) as unknown as SocietyProtocolBadges;
        await badges.waitForDeployment();

        const OFFICIAL_CREATOR_ROLE = await badges.OFFICIAL_BADGE_CREATOR_ROLE();
        await badges.grantRole(OFFICIAL_CREATOR_ROLE, creator.address);
    });

    it("Should emit BadgePermissions event on badge creation", async function () {
        const id = STARTING_BADGE_ID + 1n;
        const minters = [PERM_EVERYONE];
        const transferers = [STARTING_BADGE_ID];
        const burners = [];
        const editors = [creator.address, user1.address];

        const tx = await badges.connect(creator).createBadge(
            "Test Badge",
            true,
            false,
            "ipfs://test",
            minters,
            transferers,
            burners,
            editors
        );

        const receipt = await tx.wait();
        const event = receipt?.logs.find(
            (log) => badges.interface.parseLog(log)?.name === "BadgePermissions"
        );

        expect(event).to.not.be.undefined;
        const parsedLog = badges.interface.parseLog(event!);
        expect(parsedLog?.args.id).to.equal(id);
        expect(parsedLog?.args.minters).to.deep.equal(minters);
        expect(parsedLog?.args.transferers).to.deep.equal(transferers);
        expect(parsedLog?.args.burners).to.deep.equal(burners);
        expect(parsedLog?.args.editors).to.deep.equal(editors);
    });

    it("Should return correct permissions via getters", async function () {
        const minters = [PERM_EVERYONE, STARTING_BADGE_ID];
        const transferers = [STARTING_BADGE_ID];
        const burners = [PERM_EVERYONE];
        const editors = [owner.address, creator.address];

        await badges.connect(creator).createBadge(
            "Getter Test",
            true,
            false,
            "ipfs://getter",
            minters,
            transferers,
            burners,
            editors
        );

        const id = STARTING_BADGE_ID + 1n;

        const storedMinters = await badges.getBadgeMinters(id);
        const storedTransferers = await badges.getBadgeTransferers(id);
        const storedBurners = await badges.getBadgeBurners(id);
        const storedEditors = await badges.getBadgeEditors(id);

        expect(storedMinters).to.deep.equal(minters);
        expect(storedTransferers).to.deep.equal(transferers);
        expect(storedBurners).to.deep.equal(burners);
        expect(storedEditors).to.deep.equal(editors);
    });
});
