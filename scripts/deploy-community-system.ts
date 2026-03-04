import { ethers, upgrades, network } from "hardhat";

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Starting deployment with account:", deployer.address);

    // 1. Get or Deploy SocietyProtocolBadges
    let badgesAddress = "0x76Aa1B43a651acc4320a4610af896ddfe38B428a";
    if (!badgesAddress) {
        console.log("BADGES_ADDRESS not provided, deploying new SocietyProtocolBadges...");
        const Badges = await ethers.getContractFactory("SocietyProtocolBadges");
        const badges = await upgrades.deployProxy(Badges, [], { initializer: 'initialize' });
        await badges.waitForDeployment();
        badgesAddress = await badges.getAddress();
        console.log("SocietyProtocolBadges deployed to:", badgesAddress);
    } else {
        console.log("Using existing SocietyProtocolBadges at:", badgesAddress);
    }

    // 2. Deploy CommunityWrapper Implementation
    console.log("Deploying CommunityWrapper implementation...");
    const CommunityWrapper = await ethers.getContractFactory("CommunityWrapper");
    const wrapperImpl = await CommunityWrapper.deploy();
    await wrapperImpl.waitForDeployment();
    const wrapperImplAddress = await wrapperImpl.getAddress();
    console.log("CommunityWrapper implementation deployed to:", wrapperImplAddress);

    // 3. Deploy CommunityWrapperFactory
    console.log("Deploying CommunityWrapperFactory via proxy...");
    const Factory = await ethers.getContractFactory("CommunityWrapperFactory");
    const factory = await upgrades.deployProxy(Factory, [
        badgesAddress,
        wrapperImplAddress,
        deployer.address
    ], { initializer: 'initialize' });
    await factory.waitForDeployment();
    const factoryAddress = await factory.getAddress();
    console.log("CommunityWrapperFactory deployed to:", factoryAddress);

    // 4. Create an initial CommunityWrapper
    console.log("Creating initial CommunityWrapper...");
    // Let's assume we want a wrapper for some IDs, say 11 and 12 (STARTING_BADGE_ID is 10)
    const initialBadgeIds = [11, 12];
    const tx = await (factory as any).createWrapper(
        "Initial Community",
        "ICOM",
        initialBadgeIds
    );
    const receipt = await tx.wait();

    // Find the WrapperDeployed event
    const event = receipt.logs.find((log: any) => {
        try {
            const parsed = Factory.interface.parseLog(log);
            return parsed?.name === 'WrapperDeployed';
        } catch (e) {
            return false;
        }
    });

    if (event) {
        const parsedLog = Factory.interface.parseLog(event as any);
        console.log("Initial CommunityWrapper created at:", parsedLog?.args[0]);
    } else {
        console.log("WrapperDeployed event not found in receipt.");
    }

    console.log("Deployment and initialization complete!");
    console.log("-----------------------------------------");
    console.log("Badges:", badgesAddress);
    console.log("Factory:", factoryAddress);
    console.log("Wrapper Impl:", wrapperImplAddress);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
