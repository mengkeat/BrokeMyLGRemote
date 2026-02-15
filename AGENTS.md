# LG webOS TV Remote Control

A minimal Bun TypeScript project for LG webOS TV control. This tool uses WebSocket connections to communicate with LG webOS TVs (2018+ models with webOS 4.0+).

## Project Overview

The project provides:
- **Dashboard** - Web UI for TV remote control (mouse, keyboard, buttons)
- **Discovery CLI** - Scan for TVs on the network and optionally connect
- **TV Connection** - WebSocket-based communication with pairing support

## Quick Start

### Run the Dashboard Server
```bash
bun run dev
```
Opens at http://127.0.0.1:8080 - provides a web interface for TV control.

### Run the Discovery CLI
```bash
# Scan for TVs only
bun run discover/cli.ts

# Scan and connect to a specific TV
bun run discover/cli.ts --connect --ip <tv-ip>

# Show help
bun run discover/cli.ts --help
```

## TV Connection Details

### Ports and Protocols
- **3001** - Secure WebSocket (wss://) - preferred for newer firmware
- **3000** - Plain WebSocket (ws://) or Secure WebSocket (wss://) - legacy

The connection tries ports in order: `wss://ip:3001` → `ws://ip:3000` → `wss://ip:3000`

### TLS/SSL Handling
LG TVs use self-signed certificates. The connection disables certificate validation (`rejectUnauthorized: false`) for WSS connections to allow pairing.

### Pairing Flow
1. Connect to TV via WebSocket
2. Send registration payload with manifest
3. TV displays pairing prompt on screen
4. User accepts on TV
5. TV returns `client-key` which is saved to `tv_config.json`
6. Subsequent connections use saved key for auto-authentication

### Configuration
- `tv_config.json` - Stores TV IP and client key (auto-generated after pairing)

## Project Structure

```
project/
├── src/
│   ├── server.ts       # Main dashboard server (Bun.serve)
│   ├── tv-connection.ts # TV WebSocket connection handling
│   └── types.ts        # TypeScript interfaces and LG handshake payload
├── discover/
│   ├── cli.ts          # Discovery CLI entry point
│   ├── discover.ts     # SSDP discovery implementation
│   ├── app.ts          # Discovery web UI
│   └── index.html      # Discovery page
├── dashboard/
│   ├── app.ts          # Dashboard web UI
│   └── index.html      # Dashboard page
├── public/
│   ├── index.html      # Main remote control page
│   ├── app.ts          # Remote control client
│   └── style.css       # Shared styles
├── tv_config.json      # Saved TV connection (auto-generated)
└── package.json
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/discover` | GET | Scan network for TVs |
| `/api/status` | GET | Get current TV connection status |
| `/api/connect` | POST | Connect to TV (body: `{ip: string}`) |
| `/control` | WS | WebSocket for real-time control |
| `/dashboard` | GET | Dashboard UI |
| `/discover` | GET | Discovery UI |

## WebSocket Commands (via /control)

- `mouse_move` - Move cursor `{dx, dy}`
- `mouse_click` - Click at current position
- `send_button` - Send remote button `{key}`
- `send_text` - Send text input `{text}`
- `discover` - Trigger TV scan
- `connect_tv` - Connect to TV `{ip}`
- `get_status` - Get connection status

## Key Files for Agents

- **`src/tv-connection.ts`** - Core connection logic, TLS handling, pairing flow
- **`src/types.ts`** - Contains `LG_HANDSHAKE_PAYLOAD` with manifest and permissions
- **`discover/discover.ts`** - SSDP discovery using UDP broadcast on port 1900
- **`discover/cli.ts`** - CLI with `--connect` and `--ip` options

---

# Bun TypeScript Project Conventions and Best Practices

This document outlines the standard conventions and best practices for developing TypeScript projects using Bun as the JavaScript runtime. All environments and package installations are kept local to the current directory to ensure portability and avoid global system pollution.

## Environment Setup

### Local Bun Installation
- Install Bun locally in the project directory using the official installer script
- Avoid global Bun installations to maintain environment isolation
- Use the following command to install Bun locally:
  ```bash
  curl -fsSL https://bun.sh/install | bash
  ```
- Add the local Bun binary to your PATH within the project (e.g., via shell configuration or project-specific scripts)

### Node.js Compatibility
- Bun provides excellent Node.js compatibility, so existing Node.js projects can often be migrated with minimal changes
- Use Bun's built-in TypeScript support instead of external transpilers

## Package Management

### Local Package Installation
- All packages must be installed locally in the project directory using `bun install`
- Never use global package installations (`bun install -g`)
- Maintain a `package.json` file with all dependencies listed
- Use `bun install --frozen-lockfile` in CI/CD to ensure reproducible builds

### Package Scripts
- Define all project scripts in `package.json` under the `scripts` section
- Use Bun's native script execution instead of npm scripts
- Example `package.json` scripts:
  ```json
  {
    "scripts": {
      "dev": "bun run dev.ts",
      "build": "bun run build.ts",
      "test": "bun test",
      "lint": "bun run lint.ts"
    }
  }
  ```

## Project Structure

### Directory Layout
```
project/
├── src/
│   ├── index.ts
│   └── ...
├── test/
│   ├── index.test.ts
│   └── ...
├── package.json
├── bun.lockb
├── tsconfig.json
├── .env
├── .env.local
└── README.md
```

### File Naming Conventions
- Use `.ts` extension for TypeScript files
- Use `.test.ts` or `.spec.ts` for test files
- Use kebab-case for file names (e.g., `user-service.ts`)
- Use PascalCase for class names and interfaces
- Use camelCase for variables, functions, and methods

## TypeScript Configuration

### tsconfig.json
- Configure TypeScript strictly for better code quality
- Enable modern ES features supported by Bun
- Example `tsconfig.json`:
  ```json
  {
    "compilerOptions": {
      "target": "ES2022",
      "module": "ESNext",
      "moduleResolution": "bundler",
      "allowSyntheticDefaultImports": true,
      "esModuleInterop": true,
      "allowJs": true,
      "strict": true,
      "noEmit": true,
      "skipLibCheck": true,
      "isolatedModules": true,
      "resolveJsonModule": true,
      "types": ["bun-types"]
    },
    "include": ["src/**/*", "test/**/*"],
    "exclude": ["node_modules"]
  }
  ```

## Development Workflow

### Running the Project
- Use `bun run` to execute TypeScript files directly
- Use `bun dev` for development servers with hot reloading
- Use `bun test` for running tests

### Environment Variables
- Store environment-specific variables in `.env` files
- Use `.env.local` for local overrides (add to `.gitignore`)
- Access environment variables using `Bun.env`

### Code Quality
- Use ESLint with TypeScript support for linting
- Configure Prettier for code formatting
- Run linting and formatting as pre-commit hooks

### Testing
- Use Bun's built-in test runner (`bun test`)
- Write tests in TypeScript alongside source files
- Aim for high test coverage

## Build and Deployment

### Building for Production
- Use Bun's bundler for optimized production builds
- Configure build scripts to output to a `dist/` directory
- Example build script:
  ```typescript
  // build.ts
  import { build } from "bun";

  await build({
    entrypoints: ["src/index.ts"],
    outdir: "dist",
    minify: true,
    sourcemap: "external",
  });
  ```

### Deployment
- Ensure all dependencies are listed in `package.json`
- Use `bun.lockb` to lock dependency versions
- Deploy using containerization (Docker) for consistent environments

## Performance Best Practices

- Leverage Bun's fast startup times and native TypeScript execution
- Use Bun's built-in APIs (e.g., `Bun.serve` for HTTP servers)
- Minimize bundle size by tree-shaking unused code
- Use lazy loading for large modules when possible

## Security Considerations

- Keep dependencies updated using `bun update`
- Audit packages regularly with `bun audit`
- Avoid using `eval()` or other unsafe JavaScript features
- Validate and sanitize all user inputs

## Version Control

- Commit `bun.lockb` to ensure reproducible builds
- Ignore local environment files (`.env.local`)
- Use conventional commit messages for better changelog generation

By following these conventions, your Bun TypeScript project will be maintainable, performant, and portable across different development environments.