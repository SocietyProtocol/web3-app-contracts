import { ethers, upgrades, run, network } from "hardhat";

async function main() {
    const STAKING_TOKEN_ADDRESS = process.env.STAKING_TOKEN_ADDRESS;
    const BADGES_CONTRACT_ADDRESS = process.env.BADGES_CONTRACT_ADDRESS;
    const GOVERNOR_BADGE_ID = process.env.GOVERNOR_BADGE_ID;

    if (!STAKING_TOKEN_ADDRESS || !BADGES_CONTRACT_ADDRESS || !GOVERNOR_BADGE_ID) {
        throw new Error(
            "Missing required environment variables. Please set:\n" +
            "  STAKING_TOKEN_ADDRESS  - Address of the ERC20 staking token\n" +
            "  BADGES_CONTRACT_ADDRESS - Address of the deployed SocietyProtocolBadges proxy\n" +
            "  GOVERNOR_BADGE_ID      - Badge ID used for governor permissions"
        );
    }

    const [deployer] = await ethers.getSigners();
    console.log("Deploying with account:", deployer.address);

    // 1. Deploy VIP Manager proxy (uninitialized — needs badge creation rights first)
    const factory = await ethers.getContractFactory("SocietyVipManager");
    console.log("Deploying SocietyVipManager as UUPS proxy (uninitialized)...");

    const contract = await upgrades.deployProxy(factory, [], {
        initializer: false,
        kind: "uups",
    });

    await contract.waitForDeployment();
    const contractAddress = await contract.getAddress();
    console.log("SocietyVipManager proxy deployed to:", contractAddress);

    // 2. Grant the VIP Manager the right to create badges on the Badges contract
    const badges = await ethers.getContractAt("SocietyProtocolBadges", BADGES_CONTRACT_ADDRESS);
    const OFFICIAL_BADGE_CREATOR_ROLE = await badges.OFFICIAL_BADGE_CREATOR_ROLE();

    console.log("Granting OFFICIAL_BADGE_CREATOR_ROLE to VIP Manager...");
    const grantTx = await badges.grantRole(OFFICIAL_BADGE_CREATOR_ROLE, contractAddress);
    await grantTx.wait();

    // 3. Initialize the VIP Manager (this creates the VIP badges internally)
    console.log("Initializing SocietyVipManager...");
    const vipManager = await ethers.getContractAt("SocietyVipManager", contractAddress);
    const initTx = await vipManager.initialize(
        STAKING_TOKEN_ADDRESS,
        BADGES_CONTRACT_ADDRESS,
        GOVERNOR_BADGE_ID
    );
    await initTx.wait();
    console.log("SocietyVipManager initialized successfully");

    // 4. Revoke the badge creation role from the VIP Manager (no longer needed)
    console.log("Revoking OFFICIAL_BADGE_CREATOR_ROLE from VIP Manager...");
    const revokeTx = await badges.revokeRole(OFFICIAL_BADGE_CREATOR_ROLE, contractAddress);
    await revokeTx.wait();
    console.log("Role revoked successfully");

    // Log created badge IDs
    console.log("Bronze Badge ID:", (await vipManager.bronzeBadgeId()).toString());
    console.log("Silver Badge ID:", (await vipManager.silverBadgeId()).toString());
    console.log("Gold Badge ID:", (await vipManager.goldBadgeId()).toString());

    // If we are on a live network, wait for blocks and verify
    if (network.name !== "hardhat" && network.name !== "localhost") {
        console.log("Waiting for 6 block confirmations...");
        await contract.deploymentTransaction()?.wait(6);

        console.log("Verifying contract...");
        const implementationAddress = await upgrades.erc1967.getImplementationAddress(contractAddress);
        console.log("Implementation address:", implementationAddress);

        try {
            await run("verify:verify", {
                address: implementationAddress,
                constructorArguments: [],
            });
        } catch (e: any) {
            if (e.message.toLowerCase().includes("already verified")) {
                console.log("Already verified!");
            } else {
                console.error(e);
            }
        }
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
