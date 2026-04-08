# Deployment Order

This document explains the recommended deployment order for the contracts in this repository and what each step depends on.

## Recommended Order

### 1. Deploy `SocietyProtocolBadges.sol`

Deploy `SocietyProtocolBadges` first.

Why first:
- it is the core badge ledger for the protocol
- both community contracts and VIP contracts depend on it
- community creator/member badges are created through it
- hook-based dynamic badges are attached to it

Script:
```bash
npx hardhat run scripts/deploy-badges.ts --network <network>
```

Output needed by later steps:
- `SocietyProtocolBadges` proxy address

### 2. Deploy `SPEC.sol` or choose an existing staking token

If `SocietyVipManager` will use `SPEC`, deploy it here. If you already have a staking token, you can skip this deployment and use the existing token address.

Why here:
- `SocietyVipManager` requires a staking token address during initialization

There is no dedicated standalone deploy script for `SPEC` in this repo, but it is deployed in `scripts/deploy-all.ts`.

Output needed by later steps:
- staking token address

### 3. Deploy `CommunityWrapper.sol` implementation

Deploy the `CommunityWrapper` implementation contract.

Why here:
- `CommunityWrapperFactory` deploys clone instances from this implementation
- the factory cannot be initialized without the implementation address

This happens automatically inside `scripts/deploy-community-system.ts` and `scripts/deploy-all.ts`.

Output needed by later steps:
- `CommunityWrapper` implementation address

### 4. Deploy `CommunityWrapperFactory.sol`

Deploy `CommunityWrapperFactory` after `SocietyProtocolBadges` and the `CommunityWrapper` implementation exist.

Why here:
- the factory needs the badges contract address
- the factory also needs the wrapper implementation address
- all future wrapper clones are created through this factory

Script:
```bash
BADGES_CONTRACT_ADDRESS=0x... \
npx hardhat run scripts/deploy-community-system.ts --network <network>
```

Output needed by later steps:
- `CommunityWrapperFactory` proxy address

### 5. Deploy `CommunityRegistry.sol`

Deploy `CommunityRegistry` after `SocietyProtocolBadges` and `CommunityWrapperFactory` are deployed.

Why here:
- the registry creates communities and community badges through `SocietyProtocolBadges`
- the registry deploys community governance wrappers through `CommunityWrapperFactory`
- the registry must be granted `COMMUNITY_MANAGER_ROLE` on `SocietyProtocolBadges`

Script:
```bash
BADGES_ADDRESS=0x... FACTORY_ADDRESS=0x... \
npx hardhat run scripts/deploy-community-registry.ts --network <network>
```

Important:
- this script also grants `COMMUNITY_MANAGER_ROLE` to the deployed registry

Output needed by later steps:
- `CommunityRegistry` proxy address

### 6. Deploy `SocietyVipManager.sol`

Deploy `SocietyVipManager` after `SocietyProtocolBadges` and the staking token are available.

Why here:
- it needs the staking token address during initialization
- it creates and manages VIP badge logic on top of the badges contract
- the VIP tier badges are created in the deployment script and then pointed to the VIP manager as a hook

Script:
```bash
STAKING_TOKEN_ADDRESS=0x... BADGES_CONTRACT_ADDRESS=0x... GOVERNOR_BADGE_ID=1 \
npx hardhat run scripts/deploy-vip-manager.ts --network <network>
```

Important:
- the deployer must be able to create official badges on `SocietyProtocolBadges`
- the script creates Bronze, Silver, and Gold VIP badges
- the script then sets `SocietyVipManager` as the hook for those badges

## Dependency Summary

### Minimal dependency chain

1. `SocietyProtocolBadges`
2. `CommunityWrapper` implementation
3. `CommunityWrapperFactory`
4. `CommunityRegistry`

### VIP dependency chain

1. staking token (`SPEC` or an existing ERC20)
2. `SocietyProtocolBadges`
3. `SocietyVipManager`

## Practical Recommended Sequence

If you are deploying the whole system manually, the clean order is:

1. Deploy `SocietyProtocolBadges`
2. Deploy `SPEC` or decide which staking token to use
3. Deploy `CommunityWrapper` implementation
4. Deploy `CommunityWrapperFactory`
5. Deploy `CommunityRegistry`
6. Deploy `SocietyVipManager`

## All-In-One Deployment

If you want a bundled flow for the community system, use:

```bash
npx hardhat run scripts/deploy-all.ts --network <network>
```

This script deploys:
- `SPEC`
- `SocietyProtocolBadges`
- `CommunityWrapper` implementation
- `CommunityWrapperFactory`
- `CommunityRegistry`

and also grants `COMMUNITY_MANAGER_ROLE` to the registry.

It does not replace the separate VIP deployment flow in `scripts/deploy-vip-manager.ts`.
