import { ethers } from "hardhat";

const PERM_SELF = 1n;

async function main() {
    const BADGES_CONTRACT_ADDRESS = process.env.BADGES_CONTRACT_ADDRESS;

    if (!BADGES_CONTRACT_ADDRESS) {
        throw new Error("BADGES_CONTRACT_ADDRESS environment variable is not set. Usage: BADGES_CONTRACT_ADDRESS=0x... npx hardhat run scripts/create-initial-badges.ts --network <network>");
    }

    const [deployer] = await ethers.getSigners();
    console.log("Interacting with contracts with account:", deployer.address);

    const badges = await ethers.getContractAt("SocietyProtocolBadges", BADGES_CONTRACT_ADDRESS);

    // Compute the Governor badge ID before creation
    const nextTokenId = await badges.nextTokenId();
    const governorId = nextTokenId + 1n;

    console.log(`\nNext token ID: ${nextTokenId}, Governor badge will be ID: ${governorId}`);

    // =========================================================================
    // 1. Governor Badge
    // =========================================================================
    // Bootstrap: uses PERM_SELF so deployer can mint to themselves.
    // A hook should be set afterward to restrict minting to governor holders only,
    // since the hook overrides the permission arrays entirely.
    console.log("\n1. Creating Governor badge...");
    const governorTx = await badges.createBadge(
        "Governor",
        true,             // isOfficial
        false,            // isCommunity
        ethers.ZeroAddress, // hook (set later for proper access control)
        "",               // metadataURI
        [PERM_SELF, governorId], // minters - PERM_SELF for bootstrap, governorId so governors can appoint others
        [],               // transferers - non-transferable
        [governorId],     // burners - governors can revoke
        [deployer.address] // editors
    );
    await governorTx.wait();
    console.log(`   Created Governor badge (ID: ${governorId})`);

    // Mint Governor badge to deployer
    console.log("   Minting Governor badge to deployer...");
    const mintGovTx = await badges.mint(deployer.address, governorId, 1, "0x");
    await mintGovTx.wait();
    console.log("   Deployer now holds Governor badge");

    // =========================================================================
    // 2. Social Proof Individual
    // =========================================================================
    // Governors verify and grant. Self can renounce, governors can revoke.
    console.log("\n2. Creating Social Proof Individual badge...");
    const spiTx = await badges.createBadge(
        "Social Proof Individual",
        true,             // isOfficial
        false,            // isCommunity
        ethers.ZeroAddress,
        "",               // metadataURI
        [governorId],     // minters - governors grant
        [],               // transferers - non-transferable
        [PERM_SELF, governorId], // burners - self or governors
        [deployer.address]
    );
    await spiTx.wait();
    const spiId = governorId + 1n;
    console.log(`   Created Social Proof Individual badge (ID: ${spiId})`);

    // =========================================================================
    // 3. Liquidity Provider
    // =========================================================================
    // Governors grant. Self can renounce, governors can revoke.
    console.log("\n3. Creating Liquidity Provider badge...");
    const lpTx = await badges.createBadge(
        "Liquidity Provider",
        true,             // isOfficial
        false,            // isCommunity
        ethers.ZeroAddress,
        "",               // metadataURI
        [governorId],     // minters - governors grant
        [],               // transferers - non-transferable
        [PERM_SELF, governorId], // burners - self or governors
        [deployer.address]
    );
    await lpTx.wait();
    const lpId = governorId + 2n;
    console.log(`   Created Liquidity Provider badge (ID: ${lpId})`);

    // =========================================================================
    // 4. ICO Participant
    // =========================================================================
    // Governors grant and revoke. Non-transferable, non-self-burnable
    // (represents a verifiable fact).
    console.log("\n4. Creating ICO Participant badge...");
    const icoTx = await badges.createBadge(
        "ICO Participant",
        true,             // isOfficial
        false,            // isCommunity
        ethers.ZeroAddress,
        "",               // metadataURI
        [governorId],     // minters - governors grant
        [],               // transferers - non-transferable
        [governorId],     // burners - governors only
        [deployer.address]
    );
    await icoTx.wait();
    const icoId = governorId + 3n;
    console.log(`   Created ICO Participant badge (ID: ${icoId})`);

    // =========================================================================
    // 5. Society Protocol Team Member
    // =========================================================================
    // Governors grant and revoke. Non-transferable, non-self-burnable
    // (team membership is an org decision).
    console.log("\n5. Creating Society Protocol Team Member badge...");
    const teamTx = await badges.createBadge(
        "Society Protocol Team Member",
        true,             // isOfficial
        false,            // isCommunity
        ethers.ZeroAddress,
        "",               // metadataURI
        [governorId],     // minters - governors grant
        [],               // transferers - non-transferable
        [governorId],     // burners - governors only
        [deployer.address]
    );
    await teamTx.wait();
    const teamId = governorId + 4n;
    console.log(`   Created Society Protocol Team Member badge (ID: ${teamId})`);

    // =========================================================================
    // Summary
    // =========================================================================
    console.log("\n========== Badge Setup Complete ==========");
    console.log(`Governor:                     ID ${governorId}`);
    console.log(`Social Proof Individual:      ID ${spiId}`);
    console.log(`Liquidity Provider:           ID ${lpId}`);
    console.log(`ICO Participant:              ID ${icoId}`);
    console.log(`Society Protocol Team Member: ID ${teamId}`);
    console.log("\nNOTE: Governor badge uses PERM_SELF for minting (bootstrap).");
    console.log("Set a hook on the Governor badge to enforce governor-only minting.");
    console.log("==========================================\n");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
