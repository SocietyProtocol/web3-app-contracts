import { ethers, upgrades, run, network } from "hardhat";

async function main() {
    const STAKING_TOKEN_ADDRESS = process.env.STAKING_TOKEN_ADDRESS;
    const BADGES_CONTRACT_ADDRESS = process.env.BADGES_CONTRACT_ADDRESS;
    const GOVERNOR_BADGE_ID = process.env.GOVERNOR_BADGE_ID;
    const VIP_MANAGER_HOOK_ADDRESS = process.env.VIP_MANAGER_HOOK_ADDRESS; // optional: pre-deployed hook

    if (!STAKING_TOKEN_ADDRESS || !BADGES_CONTRACT_ADDRESS || !GOVERNOR_BADGE_ID) {
        throw new Error(
            "Missing required environment variables. Please set:\n" +
            "  STAKING_TOKEN_ADDRESS   - Address of the ERC20 staking token\n" +
            "  BADGES_CONTRACT_ADDRESS - Address of the deployed SocietyProtocolBadges proxy\n" +
            "  GOVERNOR_BADGE_ID       - Badge ID used for governor permissions"
        );
    }

    const [deployer] = await ethers.getSigners();
    console.log("Deploying with account:", deployer.address);

    const badges = await ethers.getContractAt("SocietyProtocolBadges", BADGES_CONTRACT_ADDRESS);
    const governorId = BigInt(GOVERNOR_BADGE_ID);

    // ── 1. Create official VIP tier badges ──────────────────────────────────────
    // The deployer must hold OFFICIAL_BADGE_CREATOR_ROLE on the Badges contract.
    // Badges are official, non-community, with the hook set to address(0) for now
    // (updated to the VIP Manager address once it is deployed).
    // Minting/transferring/burning is blocked (hook controls balance dynamically).
    console.log("\nCreating official VIP tier badges...");
    const nextTokenId = await badges.nextTokenId();

    const bronzeId = nextTokenId + 1n;
    const silverId = nextTokenId + 2n;
    const goldId   = nextTokenId + 3n;

    console.log(`  Expected IDs — Bronze: ${bronzeId}, Silver: ${silverId}, Gold: ${goldId}`);

    const vipEditors: string[] = [deployer.address];

    // Bronze VIP
    console.log("  Creating Bronze VIP badge...");
    const bronzeTx = await badges.createBadge(
        "Bronze VIP",
        true,                   // isOfficial
        false,                  // isCommunity
        ethers.ZeroAddress,     // hook — set after VIP Manager is deployed
        "",                     // metadataURI — set later via setURI
        [],                     // minters  — hook controls; no direct minting
        [],                     // transferers — soulbound
        [governorId],           // burners — governors can revoke
        vipEditors
    );
    await bronzeTx.wait();
    console.log(`  Bronze VIP created (ID: ${bronzeId})`);

    // Silver VIP
    console.log("  Creating Silver VIP badge...");
    const silverTx = await badges.createBadge(
        "Silver VIP",
        true,
        false,
        ethers.ZeroAddress,
        "",
        [],
        [],
        [governorId],
        vipEditors
    );
    await silverTx.wait();
    console.log(`  Silver VIP created (ID: ${silverId})`);

    // Gold VIP
    console.log("  Creating Gold VIP badge...");
    const goldTx = await badges.createBadge(
        "Gold VIP",
        true,
        false,
        ethers.ZeroAddress,
        "",
        [],
        [],
        [governorId],
        vipEditors
    );
    await goldTx.wait();
    console.log(`  Gold VIP created (ID: ${goldId})`);

    // ── 2. Deploy VIP Manager proxy ──────────────────────────────────────────────
    console.log("\nDeploying SocietyVipManager as UUPS proxy...");
    const factory = await ethers.getContractFactory("SocietyVipManager");

    const contract = await upgrades.deployProxy(
        factory,
        [
            STAKING_TOKEN_ADDRESS,
            BADGES_CONTRACT_ADDRESS,
            governorId,
            bronzeId,
            silverId,
            goldId,
        ],
        { initializer: "initialize", kind: "uups" }
    );

    await contract.waitForDeployment();
    const contractAddress = await contract.getAddress();
    console.log("SocietyVipManager proxy deployed to:", contractAddress);

    // ── 3. Point the VIP tier badge hooks to the VIP Manager ────────────────────
    // The hook address is the VIP Manager itself; it implements ISocietyBadgeHook
    // and overrides balanceOf() dynamically based on locked token amounts.
    console.log("\nSetting VIP Manager as hook on all three tier badges...");
    await (await badges.setBadgeHook(bronzeId, contractAddress)).wait();
    await (await badges.setBadgeHook(silverId, contractAddress)).wait();
    await (await badges.setBadgeHook(goldId,   contractAddress)).wait();
    console.log("Hooks set successfully.");

    // ── 4. Summary ───────────────────────────────────────────────────────────────
    const sep = "=".repeat(60);
    console.log(`\n${sep}`);
    console.log("VIP MANAGER DEPLOYMENT SUMMARY");
    console.log(sep);
    console.log(`  Network              : ${network.name}`);
    console.log(`  SocietyVipManager    : ${contractAddress}`);
    console.log(`  Bronze VIP badge ID  : ${bronzeId}`);
    console.log(`  Silver VIP badge ID  : ${silverId}`);
    console.log(`  Gold VIP badge ID    : ${goldId}`);
    console.log(sep);

    // ── 5. Verify on live networks ──────────────────────────────────────────────
    if (network.name !== "hardhat" && network.name !== "localhost") {
        console.log("\nWaiting for 6 block confirmations...");
        await contract.deploymentTransaction()?.wait(6);

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
