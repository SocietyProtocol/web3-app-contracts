import { ethers, upgrades, run, network } from "hardhat";

async function main() {
    const STAKING_TOKEN_ADDRESS = process.env.STAKING_TOKEN_ADDRESS;
    const BADGES_CONTRACT_ADDRESS = process.env.BADGES_CONTRACT_ADDRESS;
    const GOVERNOR_BADGE_ID = process.env.GOVERNOR_BADGE_ID;

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

    // ── 0. Preflight checks ─────────────────────────────────────────────────────
    const OFFICIAL_BADGE_CREATOR_ROLE = await badges.OFFICIAL_BADGE_CREATOR_ROLE();
    const hasRole = await badges.hasRole(OFFICIAL_BADGE_CREATOR_ROLE, deployer.address);
    if (!hasRole) {
        throw new Error(
            `Deployer ${deployer.address} does not have OFFICIAL_BADGE_CREATOR_ROLE on ${BADGES_CONTRACT_ADDRESS}.\n` +
            "Grant the role first, then re-run this script."
        );
    }
    console.log("Preflight: OFFICIAL_BADGE_CREATOR_ROLE confirmed.");

    // ── 1. Create official VIP tier badges ──────────────────────────────────────
    // Hook is set to address(0) now and wired to the VIP Manager in step 3.
    // During the window between badge creation and hook wiring:
    //   - minters = []  → no one can mint (safe)
    //   - transferers = [] → non-transferable (safe)
    //   - burners = [governorId] → only governors can burn
    console.log("\nCreating official VIP tier badges...");

    const vipEditors: string[] = [deployer.address];

    // Bronze VIP
    console.log("  Creating Bronze VIP badge...");
    const bronzeTx = await badges.createBadge(
        "Bronze VIP",
        true,               // isOfficial
        false,              // isCommunity
        ethers.ZeroAddress, // hook — wired in step 3
        "",                 // metadataURI — set later via setURI()
        [],                 // minters — hook controls; no direct minting
        [],                 // transferers — soulbound
        [governorId],       // burners — governors can revoke
        vipEditors
    );
    const bronzeReceipt = await bronzeTx.wait();
    const bronzeEvent = bronzeReceipt?.logs.find((l: any) => l.fragment?.name === "BadgeCreated") as any;
    if (!bronzeEvent) throw new Error("Bronze VIP: BadgeCreated event not found in receipt");
    const bronzeId = bronzeEvent.args[0] as bigint;
    console.log(`  Bronze VIP created (actual ID: ${bronzeId})`);

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
    const silverReceipt = await silverTx.wait();
    const silverEvent = silverReceipt?.logs.find((l: any) => l.fragment?.name === "BadgeCreated") as any;
    if (!silverEvent) throw new Error("Silver VIP: BadgeCreated event not found in receipt");
    const silverId = silverEvent.args[0] as bigint;
    console.log(`  Silver VIP created (actual ID: ${silverId})`);

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
    const goldReceipt = await goldTx.wait();
    const goldEvent = goldReceipt?.logs.find((l: any) => l.fragment?.name === "BadgeCreated") as any;
    if (!goldEvent) throw new Error("Gold VIP: BadgeCreated event not found in receipt");
    const goldId = goldEvent.args[0] as bigint;
    console.log(`  Gold VIP created (actual ID: ${goldId})`);

    // ── 2. Deploy VIP Manager proxy ──────────────────────────────────────────────
    console.log("\nDeploying SocietyVipManager as UUPS proxy...");
    const factory = await ethers.getContractFactory("SocietyVipManager");

    // Bronze: 400k SPEC, Silver: 2M SPEC, Gold: 10M SPEC (18 decimals)
    const bronzeAmount = ethers.parseEther("400000");
    const silverAmount = ethers.parseEther("2000000");
    const goldAmount   = ethers.parseEther("10000000");

    const contract = await upgrades.deployProxy(
        factory,
        [
            STAKING_TOKEN_ADDRESS,
            bronzeId,
            silverId,
            goldId,
            bronzeAmount,
            silverAmount,
            goldAmount,
        ],
        { initializer: "initialize", kind: "uups" }
    );

    await contract.waitForDeployment();
    const contractAddress = await contract.getAddress();
    console.log("SocietyVipManager proxy deployed to:", contractAddress);

    // ── 3. Point the VIP tier badge hooks to the VIP Manager ────────────────────
    // ISocietyBadgeHook is implemented by the VIP Manager and overrides balanceOf()
    // dynamically based on staked token amounts. After this step, the badges are
    // fully live: minting/transfer/burn are all blocked by the hook.
    console.log("\nSetting VIP Manager as hook on all three tier badges...");
    await (await badges.setBadgeHook(bronzeId, contractAddress)).wait();
    console.log(`  Hook set on Bronze (${bronzeId})`);
    await (await badges.setBadgeHook(silverId, contractAddress)).wait();
    console.log(`  Hook set on Silver (${silverId})`);
    await (await badges.setBadgeHook(goldId, contractAddress)).wait();
    console.log(`  Hook set on Gold (${goldId})`);

    // ── 4. Summary ──────────────────────────────────────────────────────────────
    const sep = "=".repeat(60);
    console.log(`\n${sep}`);
    console.log("VIP MANAGER DEPLOYMENT SUMMARY");
    console.log(sep);
    console.log(`  Network              : ${network.name}`);
    console.log(`  SocietyVipManager    : ${contractAddress}`);
    console.log(`  Bronze VIP badge ID  : ${bronzeId}  (${ethers.formatEther(bronzeAmount)} SPEC to lock)`);
    console.log(`  Silver VIP badge ID  : ${silverId}  (${ethers.formatEther(silverAmount)} SPEC to lock)`);
    console.log(`  Gold VIP badge ID    : ${goldId}  (${ethers.formatEther(goldAmount)} SPEC to lock)`);
    console.log(sep);
    console.log("  NOTE: VIP badge metadata URIs are empty.");
    console.log("  Run setURI() on each badge ID to set them:");
    console.log(`    badges.setURI(${bronzeId}, <bronzeURI>)`);
    console.log(`    badges.setURI(${silverId}, <silverURI>)`);
    console.log(`    badges.setURI(${goldId}, <goldURI>)`);
    console.log(sep);

    // ── 5. Verify on live networks ─────────────────────────────────────────────
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
