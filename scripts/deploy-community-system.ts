import { ethers, upgrades, network } from "hardhat";

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Starting deployment with account:", deployer.address);

    // 1. Get or Deploy SocietyProtocolBadges
    let badgesAddress = process.env.BADGES_CONTRACT_ADDRESS;
    if (!badgesAddress) {
        console.log("BADGES_CONTRACT_ADDRESS not provided, deploying new SocietyProtocolBadges...");
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
    // Pass 0 as managerBadgeId to create an unmanaged (immutable) wrapper.
    // Replace with a real badge ID if the wrapper's badge list needs to be updatable.
    const initialBadgeIds: bigint[] = [];
    const tx = await (factory as any).createWrapper(
        "Initial Community",
        "ICOM",
        initialBadgeIds,
        0n
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
