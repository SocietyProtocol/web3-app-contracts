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

## License
MIT
