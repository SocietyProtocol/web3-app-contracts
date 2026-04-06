import { ethers, upgrades, run, network } from "hardhat";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DeploymentResult {
    specToken: string;
    badgesProxy: string;
    badgesImpl: string;
    wrapperImpl: string;
    factoryProxy: string;
    factoryImpl: string;
    registryProxy: string;
    registryImpl: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isLiveNetwork(): boolean {
    return network.name !== "hardhat" && network.name !== "localhost";
}

async function verifyProxy(
    label: string,
    proxy: Awaited<ReturnType<typeof upgrades.deployProxy>>
): Promise<string> {
    const proxyAddress = await proxy.getAddress();
    console.log(`\n[Verify] Waiting for 6 block confirmations for ${label}...`);
    await proxy.deploymentTransaction()?.wait(6);
    const implAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);
    console.log(`[Verify] ${label} implementation: ${implAddress}`);
    try {
        await run("verify:verify", { address: implAddress, constructorArguments: [] });
        console.log(`[Verify] ${label} verified.`);
    } catch (e: any) {
        if (e.message.toLowerCase().includes("already verified")) {
            console.log(`[Verify] ${label} already verified.`);
        } else {
            console.error(e);
        }
    }
    return implAddress;
}

async function verifyPlain(
    label: string,
    contract: any,
    constructorArguments: unknown[]
): Promise<void> {
    const address = await (contract as any).getAddress();
    console.log(`\n[Verify] Waiting for 6 block confirmations for ${label}...`);
    await (contract as any).deploymentTransaction()?.wait(6);
    console.log(`[Verify] ${label} address: ${address}`);
    try {
        await run("verify:verify", { address, constructorArguments });
        console.log(`[Verify] ${label} verified.`);
    } catch (e: any) {
        if (e.message.toLowerCase().includes("already verified")) {
            console.log(`[Verify] ${label} already verified.`);
        } else {
            console.error(e);
        }
    }
}

// ─── Deployment Steps ─────────────────────────────────────────────────────────

async function deploySPEC(): Promise<{ contract: any; address: string }> {
    console.log("\n[SPEC] Deploying SPEC token...");
    const Token = await ethers.getContractFactory("SPEC");
    const contract = await Token.deploy();
    await contract.waitForDeployment();
    const address = await contract.getAddress();
    console.log(`[SPEC] Deployed to: ${address}`);
    return { contract, address };
}

async function deployBadges(): Promise<{ contract: any; address: string }> {
    console.log("\n[SocietyProtocolBadges] Deploying UUPS proxy...");
    const factory = await ethers.getContractFactory("SocietyProtocolBadges");
    const contract = await upgrades.deployProxy(factory, [], {
        initializer: "initialize",
        kind: "uups",
    });
    await contract.waitForDeployment();
    const address = await contract.getAddress();
    console.log(`[SocietyProtocolBadges] Proxy deployed to: ${address}`);
    return { contract, address };
}

async function deployWrapperImpl(): Promise<{ contract: any; address: string }> {
    console.log("\n[CommunityWrapper] Deploying implementation...");
    const CommunityWrapper = await ethers.getContractFactory("CommunityWrapper");
    const contract = await CommunityWrapper.deploy();
    await contract.waitForDeployment();
    const address = await contract.getAddress();
    console.log(`[CommunityWrapper] Implementation deployed to: ${address}`);
    return { contract, address };
}

async function deployCommunityRegistry(
    badgesAddress: string,
    factoryAddress: string,
    deployerAddress: string
): Promise<{ contract: any; address: string }> {
    console.log("\n[CommunityRegistry] Deploying UUPS proxy...");
    const Registry = await ethers.getContractFactory("CommunityRegistry");
    const contract = await upgrades.deployProxy(
        Registry,
        [badgesAddress, factoryAddress, deployerAddress],
        { initializer: "initialize", kind: "uups" }
    );
    await contract.waitForDeployment();
    const address = await contract.getAddress();
    console.log(`[CommunityRegistry] Proxy deployed to: ${address}`);
    return { contract, address };
}

async function deployWrapperFactory(
    badgesAddress: string,
    wrapperImplAddress: string,
    deployerAddress: string
): Promise<{ contract: any; address: string }> {
    console.log("\n[CommunityWrapperFactory] Deploying UUPS proxy...");
    const Factory = await ethers.getContractFactory("CommunityWrapperFactory");
    const contract = await upgrades.deployProxy(
        Factory,
        [badgesAddress, wrapperImplAddress, deployerAddress],
        { initializer: "initialize", kind: "uups" }
    );
    await contract.waitForDeployment();
    const address = await contract.getAddress();
    console.log(`[CommunityWrapperFactory] Proxy deployed to: ${address}`);
    return { contract, address };
}

function printSummary(result: DeploymentResult): void {
    const sep = "=".repeat(72);
    console.log(`\n${sep}`);
    console.log("DEPLOYMENT SUMMARY");
    console.log(sep);

    const rows: [string, string][] = [
        ["Network",                         network.name],
        ["SPEC",                       result.specToken],
        ["SocietyProtocolBadges (proxy)",   result.badgesProxy],
        ["SocietyProtocolBadges (impl)",    result.badgesImpl],
        ["CommunityWrapper (impl)",         result.wrapperImpl],
        ["CommunityWrapperFactory (proxy)", result.factoryProxy],
        ["CommunityWrapperFactory (impl)",  result.factoryImpl],
        ["CommunityRegistry (proxy)",       result.registryProxy],
        ["CommunityRegistry (impl)",        result.registryImpl],
    ];

    const labelWidth = Math.max(...rows.map(([l]) => l.length)) + 2;
    for (const [label, value] of rows) {
        console.log(`  ${label.padEnd(labelWidth)}: ${value}`);
    }
    console.log(sep);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying with account:", deployer.address);
    console.log("Network:", network.name);

    const live = isLiveNetwork();

    // Step 1: Deploy SPEC token
    const specToken = await deploySPEC();

    // Step 2: Deploy SocietyProtocolBadges
    const badges = await deployBadges();

    // Step 3: Deploy CommunityWrapper implementation
    const wrapperImpl = await deployWrapperImpl();

    // Step 4: Deploy CommunityWrapperFactory
    const factory = await deployWrapperFactory(badges.address, wrapperImpl.address, deployer.address);

    // Step 5: Deploy CommunityRegistry
    const registry = await deployCommunityRegistry(badges.address, factory.address, deployer.address);

    // Step 6: Grant COMMUNITY_MANAGER_ROLE on badges to registry
    console.log("\n[SocietyProtocolBadges] Granting COMMUNITY_MANAGER_ROLE to CommunityRegistry...");
    const COMMUNITY_MANAGER_ROLE = await (badges.contract as any).COMMUNITY_MANAGER_ROLE();
    const grantTx = await (badges.contract as any).grantRole(COMMUNITY_MANAGER_ROLE, registry.address);
    await grantTx.wait();
    console.log("[SocietyProtocolBadges] COMMUNITY_MANAGER_ROLE granted.");

    const result: DeploymentResult = {
        specToken: specToken.address,
        badgesProxy: badges.address,
        badgesImpl: await upgrades.erc1967.getImplementationAddress(badges.address),
        wrapperImpl: wrapperImpl.address,
        factoryProxy: factory.address,
        factoryImpl: await upgrades.erc1967.getImplementationAddress(factory.address),
        registryProxy: registry.address,
        registryImpl: await upgrades.erc1967.getImplementationAddress(registry.address),
    };

    // Step 7: Verify on live networks
    if (live) {
        console.log("\n[Verify] Starting contract verification...");

        await verifyPlain("[SPEC]", specToken.contract, []);
        result.badgesImpl = await verifyProxy("[SocietyProtocolBadges]", badges.contract);
        await verifyPlain("[CommunityWrapper]", wrapperImpl.contract, []);
        result.factoryImpl = await verifyProxy("[CommunityWrapperFactory]", factory.contract);
        result.registryImpl = await verifyProxy("[CommunityRegistry]", registry.contract);
    }

    // Step 8: Print summary
    printSummary(result);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
