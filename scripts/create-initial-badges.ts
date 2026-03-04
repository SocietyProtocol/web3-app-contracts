import { ethers } from "hardhat";

async function main() {
    const BADGES_CONTRACT_ADDRESS = process.env.BADGES_CONTRACT_ADDRESS;

    if (!BADGES_CONTRACT_ADDRESS) {
        throw new Error("BADGES_CONTRACT_ADDRESS environment variable is not set. Usage: BADGES_CONTRACT_ADDRESS=0x... npx hardhat run scripts/create-initial-badges.ts --network <network>");
    }

    const [deployer] = await ethers.getSigners();
    console.log("Interacting with contracts with account:", deployer.address);

    const SocietyProtocolBadges = await ethers.getContractAt("SocietyProtocolBadges", BADGES_CONTRACT_ADDRESS);

    // 1. Create 3 Official Badges
    // Only OFFICIAL_BADGE_CREATOR_ROLE can create official badges. Deployer has it.

    const officialBadges = [
        { name: "Society Member", uri: "ipfs://member" },
        { name: "Society Officer", uri: "ipfs://officer" },
        { name: "Society Leader", uri: "ipfs://leader" }
    ];

    console.log("\nCreating Official Badges...");
    for (const badge of officialBadges) {
        try {
            const tx = await SocietyProtocolBadges.createBadge(
                badge.name,
                true, // isOfficial
                false, // isCommunity
                ethers.ZeroAddress, // hook
                badge.uri,
                [], // minters
                [], // transferers
                [],  // burners
                [deployer.address] // editors - assigning deployer as editor for now
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
    // Only MINTER_ROLE (now implicitly handled or anyone can create if logic allows, but usually we want specific roles for official)
    // Actually per contract: "Anyone can create a badge" (lines 131-133 of SocietyProtocolBadges.sol)
    // But let's keep the flow.

    console.log("\nCreating Community Badge...");
    try {
        const communityTx = await SocietyProtocolBadges.createBadge(
            "Early Adopter",
            false, // isOfficial
            true,  // isCommunity
            ethers.ZeroAddress, // hook
            "ipfs://early-adopter",
            [], // minters
            [], // transferers
            [],  // burners
            [deployer.address] // editors
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
