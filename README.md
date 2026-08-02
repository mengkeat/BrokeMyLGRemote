# Broke My LG Remote

A browser-based remote control for LG webOS TVs.

When my LG remote broke, I was offered an expensive replacement. Instead, I built this lightweight local web app to control the TV from a browser—and kept the replacement cost at zero.

> Designed for LG TVs from 2018 onward running webOS 4.0 or newer.

## Features

- **Network discovery** – Find LG webOS TVs on the local network using SSDP.
- **Browser remote control** – Use a responsive on-screen remote from any modern browser.
- **Essential remote buttons** – Power, directional pad, OK, Back, Home, Exit, volume, mute, channel, numbers, media playback, and color keys.
- **Touchpad pointer** – Move the TV pointer with a mouse or trackpad and click to select.
- **Keyboard shortcuts** – Use arrow keys, Enter, Backspace, and Escape as remote buttons.
- **Text input** – Send text directly to the TV, useful for search fields and login screens.
- **Prompt and PIN pairing** – Support both approval-on-TV and PIN-based pairing flows.
- **Saved TVs** – Pair multiple TVs and reconnect to each one without repeating setup.
- **Connection recovery** – Automatically tries supported LG WebSocket endpoints and can recover from a stale saved pairing key.
- **Live dashboard** – View connection state, TV IP, current foreground app, volume, and mute status.
- **Discovery CLI** – Scan for TVs or connect directly from the terminal.
- **Local-only operation** – The server binds to `127.0.0.1` by default; pairing keys remain on the machine and are never sent to the browser.

## Requirements

- [Bun](https://bun.sh/) installed
- An LG webOS TV (2018+ / webOS 4.0+)
- The computer and TV connected to the same local network
- Network control / LG Connect Apps enabled on the TV, if required by the TV model

## Getting started

```bash
bun install
bun run dev
```

Open [http://127.0.0.1:8080](http://127.0.0.1:8080) in a browser.

1. Click **Scan** to discover TVs, or enter the TV's IP address manually.
2. Click **Connect**.
3. Approve the pairing request on the TV, or enter the PIN shown by the TV.
4. Use the remote, touchpad, or text input controls.

The first successful pairing is saved locally in `tv_config.json`. Future connections reuse the TV's saved key automatically. This file is ignored by Git and is created with owner-only permissions on supported systems.

## Discovery CLI

Scan for LG TVs on the local network:

```bash
bun run discover/cli.ts
```

Scan and connect automatically when exactly one TV is found:

```bash
bun run discover/cli.ts --connect
```

Connect to a specific TV by IP address:

```bash
bun run discover/cli.ts --connect --ip 192.168.1.100
```

Show command help:

```bash
bun run discover/cli.ts --help
```

## Web interfaces

- `/` – Remote control
- `/dashboard` – Connection and TV status dashboard
- `/discover` – Discovery interface

The server also exposes these HTTP endpoints:

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/discover` | `GET` | Discover LG TVs on the network |
| `/api/status` | `GET` | Read the current connection status |
| `/api/saved-tvs` | `GET` | List saved TVs without exposing pairing keys |
| `/api/connect` | `POST` | Connect to a TV with `{ "ip": "...", "name?": "..." }` |
| `/control` | WebSocket | Send remote-control commands and receive live updates |

## How it connects

The app communicates with the TV using LG's webOS WebSocket protocol. It attempts endpoints in this order:

1. `wss://<tv-ip>:3001`
2. `ws://<tv-ip>:3000`
3. `wss://<tv-ip>:3000`

LG TVs commonly use self-signed certificates for local secure connections, so certificate validation is disabled for these LAN connections.

## Security and privacy

- The server listens on localhost by default.
- Client pairing keys are stored only in `tv_config.json`.
- Pairing keys are not returned by the API or sent to browser clients.
- PINs are validated locally and are not logged or broadcast.
- Do not expose this server to an untrusted network without adding authentication and reviewing the TLS configuration.

## Development

Run the test suite:

```bash
bun test
```

Run TypeScript checks:

```bash
bunx tsc --noEmit
```

## Project structure

```text
src/
  server.ts          Bun HTTP/WebSocket server
  tv-connection.ts   LG webOS connection and pairing logic
  types.ts           Protocol types and registration payload

discover/
  cli.ts             Discovery and connection CLI
  discover.ts        SSDP discovery implementation

dashboard/          TV status dashboard
public/              Remote control UI
test/                Automated protocol and persistence tests
```

## License

No license has been specified yet.
