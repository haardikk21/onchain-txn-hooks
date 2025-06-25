# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Commands

### Development
```bash
# Install dependencies for all workspaces
bun install

# Run all services in development mode (shared types watch, server, and client)
bun run dev

# Run individual services
bun run dev:shared   # Watch and compile shared types
bun run dev:server   # Run Hono backend on port 3000
bun run dev:client   # Run Vite dev server for React frontend
```

### Building
```bash
# Build everything (shared types first, then server, then client)
bun run build

# Build individual parts
bun run build:shared  # Compile TypeScript for shared package
bun run build:server  # Compile TypeScript for server
bun run build:client  # Build React app for production
```

### Linting
```bash
# Lint client code
cd client && bun run lint
```

### Testing
```bash
# Run smart contract tests
cd contracts && forge test

# Run tests with gas reporting
cd contracts && forge test --gas-report

# Run tests with verbosity
cd contracts && forge test -vvv
```

### Smart Contracts (Foundry)
```bash
# Build contracts
cd contracts && forge build

# Run local blockchain for testing
cd contracts && anvil

# Deploy contracts (example)
cd contracts && forge script script/Deploy.s.sol --rpc-url <RPC_URL> --private-key <PRIVATE_KEY>
```

## Architecture Overview

This is a TypeScript monorepo using Bun workspaces with three main packages plus a Foundry smart contracts project:

### Monorepo Structure
- **client/**: React frontend using Vite, TypeScript, Tailwind CSS, and shadcn/ui components
- **server/**: Hono backend API with CORS enabled
- **shared/**: Common TypeScript type definitions used by both client and server
- **contracts/**: Foundry project for Solidity smart contracts (not part of Bun workspace)

### Key Architecture Patterns

**Type Sharing**: The `shared` package exports TypeScript types that are imported by both client and server, ensuring end-to-end type safety. Types are compiled to `shared/dist/` and imported as `import { ApiResponse } from 'shared/dist'` on the server side.

**Workspace Dependencies**: Each package declares dependencies on other workspace packages using `"workspace:*"` syntax in package.json. The client imports types directly as `import { ApiResponse } from 'shared'`.

**Build Pipeline**: The shared package must be built first since both client and server depend on its compiled output. The root package.json orchestrates this with proper dependency ordering.

**Server Architecture**: Uses Hono framework with method chaining for route definitions. The server exports both named and default exports of the Hono app instance.

**Client Architecture**: Standard React + Vite setup with TypeScript. Uses environment variables (`VITE_SERVER_URL`) for server communication. Includes shadcn/ui for components and Tailwind for styling.

### Development Workflow
1. Run `bun run dev` to start all services concurrently
2. Shared types are watched and recompiled automatically
3. Server runs on localhost:3000 with hot reload
4. Client runs on Vite's dev server with hot module replacement
5. Type changes in shared/ are immediately available to both client and server

### Important Files
- `shared/src/types/index.ts`: All shared type definitions
- `server/src/index.ts`: Main server entry point with Hono app
- `client/src/App.tsx`: Main React component with API integration example
- `contracts/foundry.toml`: Foundry configuration
- `contracts/src/`: Solidity smart contracts
- `contracts/test/`: Smart contract tests