# Society Protocol Contracts

Modular badge and community management system built with Solidity, Hardhat, and OpenZeppelin.

## Architecture

The system consists of several core components designed for flexibility and upgradeability:

1.  **SocietyProtocolBadges.sol**: Core ERC1155 system. Features UUPS upgradeability, detailed access control, and a "Hooks" system for custom mint/transfer/burn/balance logic.
2.  **SocietyVipManager.sol**: Handles tier-based membership by locking staking tokens. It acts as a hook for its own VIP badges to prevent unauthorized transfers.
3.  **CommunityWrapper.sol**: A non-transferable ERC20 wrapper that grants a balance based on holding specific ERC1155 badges.
4.  **CommunityWrapperFactory.sol**: A factory using the Clones pattern to deploy `CommunityWrapper` instances efficiently.

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
Run the full test suite (over 70+ tests covering edge cases and security):
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
Initialize the system with VIP tiers:
```bash
STAKING_TOKEN_ADDRESS=0x... BADGES_CONTRACT_ADDRESS=0x... GOVERNOR_BADGE_ID=1 \
npx hardhat run scripts/deploy-vip-manager.ts --network <network>
```

### 3. Deploy Community System
Deploys the Factory and Implementation for ERC20 badge wrappers:
```bash
BADGES_CONTRACT_ADDRESS=0x... \
npx hardhat run scripts/deploy-community-system.ts --network <network>
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
