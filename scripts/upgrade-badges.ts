import { ethers, upgrades, run, network } from "hardhat";

async function main() {
    const proxyAddress = "0x76Aa1B43a651acc4320a4610af896ddfe38B428a";

    if (!proxyAddress) {
        throw new Error("PROXY_ADDRESS environment variable is not set");
    }

    console.log(`Upgrading SocietyProtocolBadges at proxy address: ${proxyAddress}`);

    const factory = await ethers.getContractFactory("SocietyProtocolBadges");

    // upgradeProxy(proxyAddress, ContractFactory, opts)
    try {
        await upgrades.forceImport(proxyAddress, factory);
    } catch (e) {
        console.log("forceImport failed, continuing anyway...", e);
    }
    const contract = await upgrades.upgradeProxy(proxyAddress, factory);

    await contract.waitForDeployment();
    console.log("SocietyProtocolBadges upgraded successfully");

    const newImplementationAddress = await upgrades.erc1967.getImplementationAddress(await contract.getAddress());
    console.log("New implementation address:", newImplementationAddress);

    // If we are on a live network (not hardhat or localhost), we wait for blocks and verify
    if (network.name !== "hardhat" && network.name !== "localhost") {
        console.log("Waiting for 6 block confirmations...");
        await contract.deploymentTransaction()?.wait(6);

        console.log("Verifying new implementation contract...");

        try {
            await run("verify:verify", {
                address: newImplementationAddress,
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
