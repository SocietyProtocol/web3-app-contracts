import { ethers, upgrades, run, network } from "hardhat";

async function main() {
    const proxyAddress = process.env.FACTORY_PROXY_ADDRESS;

    if (!proxyAddress) {
        throw new Error("FACTORY_PROXY_ADDRESS environment variable is not set. Usage: FACTORY_PROXY_ADDRESS=0x... npx hardhat run scripts/upgrade-community-factory.ts --network <network>");
    }

    console.log(`Upgrading CommunityWrapperFactory at proxy address: ${proxyAddress}`);

    const factory = await ethers.getContractFactory("CommunityWrapperFactory");

    const contract = await upgrades.upgradeProxy(proxyAddress, factory, {
        redeployImplementation: "always"
    });

    await contract.waitForDeployment();
    console.log("CommunityWrapperFactory upgraded successfully");

    if (network.name !== "hardhat" && network.name !== "localhost") {
        console.log("Waiting 30 seconds for state synchronization...");
        await new Promise((resolve) => setTimeout(resolve, 30000));

        const newImplementationAddress = await upgrades.erc1967.getImplementationAddress(await contract.getAddress());
        console.log("New implementation address:", newImplementationAddress);

        console.log("Waiting for block confirmations...");
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
