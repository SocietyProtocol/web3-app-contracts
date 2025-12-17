import { ethers } from "hardhat";

async function main() {
    const BADGES_CONTRACT_ADDRESS = process.env.BADGES_CONTRACT_ADDRESS;

    if (!BADGES_CONTRACT_ADDRESS) {
        throw new Error("BADGES_CONTRACT_ADDRESS environment variable is not set. Please run: BADGES_CONTRACT_ADDRESS=<ADDRESS> npx hardhat run ...");
    }

    const [deployer] = await ethers.getSigners();
    console.log("Interacting with contracts with account:", deployer.address);

    const SocietyProtocolBadges = await ethers.getContractAt("SocietyProtocolBadges", BADGES_CONTRACT_ADDRESS);

    // 1. Create 3 Official Badges
    // Only GOVERNOR_ROLE can create official badges. Deployer has it.

    const officialBadges = [
        { name: "Society Member", uri: "ipfs://member" },
        { name: "Society Officer", uri: "ipfs://officer" },
        { name: "Society Leader", uri: "ipfs://leader" }
    ];

    console.log("\nCreating Official Badges...");
    for (const badge of officialBadges) {
        try {
            const tx = await SocietyProtocolBadges.createOfficialBadge(
                badge.name,
                badge.uri,
                [], // minters
                [], // transferers
                []  // burners
            );
            await tx.wait();
            console.log(`- Created Official Badge: ${badge.name}`);
        } catch (error) {
            console.error(`Failed to create badge ${badge.name}:`, error);
        }
    }

    // 2. Create 1 Profile Badge
    console.log("\nCreating Profile Badge...");
    try {
        const profileTx = await SocietyProtocolBadges.createProfile("ipfs://my-profile");
        await profileTx.wait();
        console.log("- Created Profile Badge for deployer");
    } catch (error: any) {
        if (error.message.includes("ProfileAlreadyExists")) {
            console.log("- Profile already exists for this user.");
        } else {
            console.error("Failed to create profile:", error);
        }
    }

    // 3. Create 1 Community Badge
    // Only MINTER_ROLE can create community badges.

    const MINTER_ROLE = await SocietyProtocolBadges.MINTER_ROLE();

    if (!(await SocietyProtocolBadges.hasRole(MINTER_ROLE, deployer.address))) {
        console.log("\nGranting MINTER_ROLE to deployer...");
        const grantTx = await SocietyProtocolBadges.grantRole(MINTER_ROLE, deployer.address);
        await grantTx.wait();
        console.log("- MINTER_ROLE granted");
    } else {
        console.log("\nDeployer already has MINTER_ROLE");
    }

    console.log("\nCreating Community Badge...");
    try {
        const communityTx = await SocietyProtocolBadges.createCommunityBadge(
            "Early Adopter",
            "ipfs://early-adopter",
            [], // minters
            [], // transferers
            []  // burners
        );
        await communityTx.wait();
        console.log("- Created Community Badge: Early Adopter");
    } catch (error) {
        console.error("Failed to create community badge:", error);
    }

    console.log("\nDone!");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
