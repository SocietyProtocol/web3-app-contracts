# Contracts Overview

This document describes the purpose of each contract in the repository and how the main pieces fit together.

## Core Contracts

### `SocietyProtocolBadges.sol`

`SocietyProtocolBadges` is the core ERC1155 badge system for the protocol.

It is responsible for:
- creating badge types
- storing badge metadata
- storing mint, transfer, and burn permission rules
- assigning badge editors
- supporting hook-based custom logic for mint, transfer, burn, and `balanceOf`
- supporting profile badges
- supporting the invite flow

The contract is upgradeable through UUPS and uses role-based access control for official badges, community badges, and upgrades.

#### Permission model

This contract intentionally removes the standard ERC1155 approval check from `safeTransferFrom` and `safeBatchTransferFrom`.

The reason is that permissions in this system are based on:
- badge ownership rules
- hook logic

and not on ERC1155 allowances.

If the standard allowance check were kept, the badge permission model would break in many real protocol flows. For example:
- if 100 users hold governance badge `11`
- and badge `12` allows transfer and burn for holders of badge `11`

then the holder of badge `12` would have to approve all 100 users to preserve the intended badge-permission logic.

Because of that, transfer and burn authorization is derived from badge rules or hook rules rather than ERC1155 approvals.

### `SocietyVipManager.sol`

`SocietyVipManager` is a hook contract that manages VIP-related badge ownership.

It currently supports two categories of dynamic badges:
- personal VIP tiers based on staking locked `SPEC` or another configured ERC20
- community VIP tiers based on owner-granted time-limited assignments

For personal tiers, the contract:
- accepts token locks
- tracks lock amount and unlock time per user
- exposes dynamic badge balances for bronze, silver, and gold tiers
- blocks direct minting, transfers, and burns through hook checks

For community tiers, the contract:
- stores time-limited grants for a community
- exposes the active tier for a given community
- makes the community tier follow the current holder of the community creator badge

This contract is also UUPS upgradeable.

### `CommunityRegistry.sol`

`CommunityRegistry` is the central contract for community creation and community administration.

It is responsible for:
- creating communities
- creating the creator badge and member badge for each community
- storing community metadata
- deploying an optional `CommunityWrapper` for a community
- creating additional community-specific badges

A community is identified by its creator badge ID. Holding that creator badge is the source of authority for community management functions.

### `CommunityWrapper.sol`

`CommunityWrapper` is a non-transferable ERC20-style token whose balance is derived from ERC1155 badge ownership.

It is intended to:
- aggregate one or more badge balances into a single ERC20-compatible balance
- expose that balance through an interface that governance tools can consume
- remain non-transferable so it behaves like a view over badge state rather than a standalone asset

This contract is an ERC20 strategy to be used in Snapshot as governance.

The wrapper:
- stores a list of allowed badge IDs
- returns the sum of the holder's balances for those badge IDs
- allows the owner to add or remove badge IDs
- disables transfers and `transferFrom`

### `CommunityWrapperFactory.sol`

`CommunityWrapperFactory` deploys `CommunityWrapper` instances using the EIP-1167 clone pattern.

It is responsible for:
- storing the wrapper implementation address
- deploying cheap wrapper clones for communities
- initializing new wrappers with name, symbol, badge contract, and starting badge IDs
- letting the owner update the implementation for future wrapper deployments

This contract is UUPS upgradeable. Updating the implementation only affects future clones, not already deployed wrappers.

### `SPEC.sol`

`SPEC` is the protocol ERC20 token used in the repository as the staking token for VIP logic.

It is a simple fixed-supply ERC20 that mints the full initial supply to the deployer in the constructor.

## Interfaces and Test Helpers

### `ISocietyBadgeHook.sol`

`ISocietyBadgeHook` defines the hook interface used by `SocietyProtocolBadges`.

It allows an external contract to define:
- whether a mint is allowed
- whether a transfer is allowed
- whether a burn is allowed
- what `balanceOf(account, id)` should return

This is what enables dynamic badges such as VIP tiers.

### `MockHook.sol`

`MockHook` is a test helper used in the suite.

It provides configurable hook responses for mint, transfer, and burn checks so the badge system and hook priority logic can be tested in isolation.

## High-Level Flow

At a high level:
- `SocietyProtocolBadges` is the main badge ledger and permission engine
- `SocietyVipManager` plugs into the badge system through hooks for dynamic VIP ownership
- `CommunityRegistry` creates and manages communities on top of the badge system
- `CommunityWrapperFactory` deploys wrapper clones for community governance use
- `CommunityWrapper` exposes badge-derived balances in ERC20 form for Snapshot governance strategies
