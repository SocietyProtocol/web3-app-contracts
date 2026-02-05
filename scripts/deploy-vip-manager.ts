import { ethers, upgrades, run, network } from "hardhat";

async function main() {
    // These should be set based on your deployment environment
    const STAKING_TOKEN_ADDRESS = process.env.STAKING_TOKEN_ADDRESS || "0x0000000000000000000000000000000000000000";
    const BADGES_CONTRACT_ADDRESS = process.env.BADGES_CONTRACT_ADDRESS || "0x0000000000000000000000000000000000000000";
    const GOVERNOR_BADGE_ID = process.env.GOVERNOR_BADGE_ID || "1";

    if (STAKING_TOKEN_ADDRESS === ethers.ZeroAddress || BADGES_CONTRACT_ADDRESS === ethers.ZeroAddress) {
        console.warn("WARNING: STAKING_TOKEN_ADDRESS or BADGES_CONTRACT_ADDRESS is not set correctly.");
    }

    const factory = await ethers.getContractFactory("SocietyVipManager");

    console.log("Deploying SocietyVipManager as UUPS proxy...");

    // We deploy but don't initialize immediately in deployProxy if we want to follow the test pattern,
    // or we can initialize directly. In production, initializing directly is usually better.
    const contract = await upgrades.deployProxy(factory, [
        STAKING_TOKEN_ADDRESS,
        BADGES_CONTRACT_ADDRESS,
        GOVERNOR_BADGE_ID
    ], {
        initializer: "initialize",
        kind: "uups",
    });

    await contract.waitForDeployment();
    const contractAddress = await contract.getAddress();

    console.log("SocietyVipManager deployed to:", contractAddress);

    // If we are on a live network (not hardhat or localhost), we wait for blocks and verify
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
