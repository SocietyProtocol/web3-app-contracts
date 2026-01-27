import { ethers, upgrades, run, network } from "hardhat";

async function main() {
    const factory = await ethers.getContractFactory("SocietyProtocolBadges");

    console.log("Deploying SocietyProtocolBadges as UUPS proxy...");

    const contract = await upgrades.deployProxy(factory, [], {
        initializer: "initialize",
        kind: "uups",
    });

    await contract.waitForDeployment();
    const contractAddress = await contract.getAddress();

    console.log("SocietyProtocolBadges deployed to:", contractAddress);

    // If we are on a live network (not hardhat or localhost), we wait for blocks and verify
    if (network.name !== "hardhat" && network.name !== "localhost") {
        console.log("Waiting for 6 block confirmations...");
        await contract.deploymentTransaction()?.wait(6);

        console.log("Verifying contract...");

        // We need to verify the implementation contract, not the proxy.
        // The @openzeppelin/hardhat-upgrades plugin should handle this if we use their verify plugin helper,
        // but typically explicit verification works best on the implementation address.

        // However, hardhat-upgrades has a helper to get implementation address
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
