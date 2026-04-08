# Society Protocol Contracts

Modular badge and community management system built with Solidity, Hardhat, and OpenZeppelin.

## Architecture

The system consists of several core components designed for flexibility and upgradeability:

1.  **SocietyProtocolBadges.sol**: Core ERC1155 badge system. Features UUPS upgradeability, access control, and a hooks system for custom mint, transfer, burn, and balance logic.
2.  **SocietyVipManager.sol**: Dynamic badge hook for personal VIP tiers based on staking and community VIP tiers based on owner-granted time-limited assignments.
3.  **CommunityRegistry.sol**: Community management hub that creates communities, creator/member badges, and additional community badges.
4.  **CommunityWrapper.sol**: A non-transferable ERC20 wrapper that derives balances from ERC1155 badges and is intended for Snapshot governance strategies.
5.  **CommunityWrapperFactory.sol**: A factory using the Clones pattern to deploy `CommunityWrapper` instances efficiently.

Detailed contract-by-contract notes are available in [docs/CONTRACTS.md](./docs/CONTRACTS.md).
Deployment order and dependency notes are available in [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md).

## Prerequisites

- Node.js (v20+ recommended)
- npm or yarn

## Setup

1.  Install dependencies:
    ```bash
    npm install
    ```
2.  Configuration:
    Copy `.env_example` to `.env` and fill in the required values:
    ```bash
    cp .env_example .env
    ```

## Development

### Compile
```bash
npx hardhat compile
```

### Test
Run the full test suite:
```bash
npx hardhat test
```

## Deployment

Deploying requires setting specific environment variables in `.env` or as command line prefixes.

### 1. Deploy Core Badges
```bash
npx hardhat run scripts/deploy-badges.ts --network <network>
```

### 2. Deploy VIP Manager
Deploy the VIP manager and create/configure the personal VIP tier badges:
```bash
STAKING_TOKEN_ADDRESS=0x... BADGES_CONTRACT_ADDRESS=0x... GOVERNOR_BADGE_ID=1 \
npx hardhat run scripts/deploy-vip-manager.ts --network <network>
```

### 3. Deploy Community System
Deploys the `CommunityWrapper` implementation and `CommunityWrapperFactory`:
```bash
BADGES_CONTRACT_ADDRESS=0x... \
npx hardhat run scripts/deploy-community-system.ts --network <network>
```

### 4. Deploy Community Registry
Deploys `CommunityRegistry` and grants it `COMMUNITY_MANAGER_ROLE` on `SocietyProtocolBadges`:
```bash
BADGES_ADDRESS=0x... FACTORY_ADDRESS=0x... \
npx hardhat run scripts/deploy-community-registry.ts --network <network>
```

### 5. Deploy Everything
For a full deployment flow, use:
```bash
npx hardhat run scripts/deploy-all.ts --network <network>
```

## Upgrading Contracts

All core contracts use the UUPS (Universal Upgradeable Proxy Standard) pattern.

### Upgrade Badges
```bash
PROXY_ADDRESS=0x... npx hardhat run scripts/upgrade-badges.ts --network <network>
```

### Upgrade VIP Manager
```bash
VIP_MANAGER_PROXY_ADDRESS=0x... npx hardhat run scripts/upgrade-vip-manager.ts --network <network>
```

### Upgrade Community Factory
```bash
FACTORY_PROXY_ADDRESS=0x... npx hardhat run scripts/upgrade-community-factory.ts --network <network>
```

## Deployed Contracts (Mainnet)

| Contract | Address |
|---|---|
| SPEC | `0x21dC59C8D7a333408C6ad5f6b5a17C7161E3D6dd` |
| SocietyProtocolBadges (proxy) | `0xa3AF0DA9733061Da88b91Ea28740780A887c8ce3` |
| SocietyProtocolBadges (impl) | `0x12D5c1461C7cb4A84Ba5db20741078a7094Fa7f9` |
| CommunityWrapper (impl) | `0xb89eee9b1eC855cB4b1B73D1B695C1A46e09228e` |
| CommunityWrapperFactory (proxy) | `0x22c9FA55a339083a3Dfb2fb9d266E08637e3196e` |
| CommunityWrapperFactory (impl) | `0x7a338d82988f13bb8c1bd61bC8F7f27A1eA370b9` |
| SocietyVipManager (proxy) | `0x91715d95004Bd57eDC1E0FD718688CEd475E130A` |
| SocietyVipManager (impl) | `0xa774D9b7BCBFE319477bE3767Bd84Bb20e4517f6` |

## License
MIT
