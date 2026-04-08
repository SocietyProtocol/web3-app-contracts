import { ethers, upgrades, run, network } from "hardhat";

/**
 * Standalone deployment script for CommunityRegistry.
 * Run after SocietyProtocolBadges and CommunityWrapperFactory are already deployed.
 *
 * Usage:
 *   BADGES_ADDRESS=0x... FACTORY_ADDRESS=0x... npx hardhat run scripts/deploy-community-registry.ts --network <network>
 */

function isLiveNetwork(): boolean {
    return network.name !== "hardhat" && network.name !== "localhost";
}

async function main(): Promise<void> {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying with account:", deployer.address);
    console.log("Network:", network.name);

    const badgesAddress = process.env.BADGES_ADDRESS;
    const factoryAddress = process.env.FACTORY_ADDRESS;

    if (!badgesAddress || !factoryAddress) {
        throw new Error("BADGES_ADDRESS and FACTORY_ADDRESS env vars must be set");
    }

    // Deploy CommunityRegistry UUPS proxy
    console.log("\n[CommunityRegistry] Deploying UUPS proxy...");
    const RegistryFactory = await ethers.getContractFactory("CommunityRegistry");
    const registry = await upgrades.deployProxy(
        RegistryFactory,
        [badgesAddress, factoryAddress, deployer.address],
        { initializer: "initialize", kind: "uups" }
    );
    await registry.waitForDeployment();
    const registryAddress = await registry.getAddress();
    console.log(`[CommunityRegistry] Proxy deployed to: ${registryAddress}`);

    // Grant COMMUNITY_MANAGER_ROLE on the Badges contract
    console.log("\n[SocietyProtocolBadges] Granting COMMUNITY_MANAGER_ROLE to registry...");
    const badges = await ethers.getContractAt("SocietyProtocolBadges", badgesAddress);
    const COMMUNITY_MANAGER_ROLE = await badges.COMMUNITY_MANAGER_ROLE();
    const tx = await badges.grantRole(COMMUNITY_MANAGER_ROLE, registryAddress);
    await tx.wait();
    console.log("[SocietyProtocolBadges] COMMUNITY_MANAGER_ROLE granted.");

    // Verify on live networks
    if (isLiveNetwork()) {
        console.log("\n[Verify] Waiting for 6 block confirmations...");
        await registry.deploymentTransaction()?.wait(6);
        const implAddress = await upgrades.erc1967.getImplementationAddress(registryAddress);
        console.log(`[Verify] CommunityRegistry implementation: ${implAddress}`);
        try {
            await run("verify:verify", { address: implAddress, constructorArguments: [] });
            console.log("[Verify] CommunityRegistry verified.");
        } catch (e: any) {
            if (e.message.toLowerCase().includes("already verified")) {
                console.log("[Verify] Already verified.");
            } else {
                console.error(e);
            }
        }
    }

    const sep = "=".repeat(60);
    console.log(`\n${sep}`);
    console.log("DEPLOYMENT SUMMARY");
    console.log(sep);
    console.log(`  Network                 : ${network.name}`);
    console.log(`  CommunityRegistry proxy : ${registryAddress}`);
    console.log(`  Badges                  : ${badgesAddress}`);
    console.log(`  WrapperFactory          : ${factoryAddress}`);
    console.log(sep);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
