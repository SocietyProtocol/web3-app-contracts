import { ethers, upgrades, run, network } from "hardhat";

async function main() {
    // These should be set based on your deployment environment
    const STAKING_TOKEN_ADDRESS = process.env.STAKING_TOKEN_ADDRESS || "0xe4a566a04aed9f938bba16d47d859a706bc4949a";
    const BADGES_CONTRACT_ADDRESS = process.env.BADGES_CONTRACT_ADDRESS || "0x76Aa1B43a651acc4320a4610af896ddfe38B428a";
    const GOVERNOR_BADGE_ID = process.env.GOVERNOR_BADGE_ID || "21";

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
        initializer: false,
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
