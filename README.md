<div align="center">
  <h1>📺 Broke My LG Remote</h1>
  <p>A local, browser-based remote control for LG webOS TVs.</p>

  <p>
    <a href="https://github.com/mengkeat/BrokeMyLGRemote/stargazers"><img src="https://img.shields.io/github/stars/mengkeat/BrokeMyLGRemote?style=flat-square&logo=github" alt="GitHub stars"></a>
    <a href="https://github.com/mengkeat/BrokeMyLGRemote/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT License"></a>
    <a href="https://bun.sh/"><img src="https://img.shields.io/badge/runtime-Bun-000000?style=flat-square&logo=bun&logoColor=white" alt="Bun"></a>
    <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript"></a>
    <a href="https://webostv.developer.lge.com/"><img src="https://img.shields.io/badge/LG_webOS-4.0%2B-a50034?style=flat-square" alt="LG webOS 4.0+"></a>
  </p>
</div>

When my LG remote broke, I was offered an expensive replacement. Rather than pay for another physical remote, I built this project: a lightweight local web app that turns a browser into an LG TV remote.

It is intentionally small, self-hosted, and designed to work entirely on your local network.

## 📚 Contents

- [Features](#-features)
- [Compatibility](#-compatibility)
- [Quick start](#-quick-start)
- [Web interfaces](#-web-interfaces)
- [Remote controls](#-remote-controls)
- [Discovery CLI](#-discovery-cli)
- [API reference](#-api-reference)
- [Protocol and connection details](#-protocol-and-connection-details)
- [Security and privacy](#-security-and-privacy)
- [Development](#-development)
- [Contributing](#-contributing)
- [License](#-license)

## ✨ Features

### Remote control

- **Complete essential controls:** power, directional pad, OK, Back, Home, Exit, volume, mute, channel, number pad, media playback, and color keys.
- **Touchpad pointer:** move the TV pointer with a mouse or trackpad and click to select.
- **Keyboard shortcuts:** use `↑`, `↓`, `←`, `→`, `Enter`, `Backspace`, and `Escape` as remote buttons.
- **Text input:** send text directly to the TV for search boxes, login screens, and other input fields.
- **Responsive web UI:** use the remote from a browser on the machine running the server.

### TV management

- **Automatic discovery:** scan the local network for LG webOS TVs using SSDP.
- **Direct connection:** connect by TV IP address when discovery is unavailable.
- **Prompt and PIN pairing:** support both approval-on-TV and PIN-based pairing flows.
- **Multiple saved TVs:** pair several TVs and reconnect to each one independently.
- **Pairing recovery:** reuse saved client keys and recover once from a stale key when necessary.
- **Live status:** view connection state, TV IP, current foreground app, volume, and mute status.
- **CLI support:** discover TVs or connect to a specific TV from the terminal.

## 🖥️ Compatibility

| Requirement | Supported configuration |
| --- | --- |
| TV | LG TVs from 2018 onward |
| Firmware | webOS 4.0 or newer |
| Network | Computer and TV on the same local network |
| Runtime | [Bun](https://bun.sh/) |
| Browser | Any modern browser with WebSocket support |

Your TV may require **LG Connect Apps**, **Mobile TV On**, or a similar network-control setting to be enabled. The exact setting name varies by model and firmware.

## 🚀 Quick start

### 1. Install dependencies

```bash
bun install
```

### 2. Start the server

```bash
bun run dev
```

The server listens on `127.0.0.1:8080`. Open [http://127.0.0.1:8080](http://127.0.0.1:8080) in your browser.

### 3. Pair your TV

1. Click **Scan**, or enter the TV's IP address manually.
2. Select the TV and click **Connect**.
3. Approve the pairing prompt on the TV, or enter the PIN displayed by the TV.
4. Start using the remote.

After the first successful pairing, the returned client key is saved to `tv_config.json`. Future connections reuse the key automatically, so you do not need to pair the same TV again.

> **Tip:** If the TV is not discovered, verify that it is powered on, connected to the same network, and accepting network-control connections. You can also connect using its IP address.

## 🧭 Web interfaces

| Path | Description |
| --- | --- |
| [`/`](http://127.0.0.1:8080/) | Main remote control with buttons, touchpad, and text input |
| [`/dashboard`](http://127.0.0.1:8080/dashboard) | Connection, app, volume, saved-TV, and discovery dashboard |
| [`/discover`](http://127.0.0.1:8080/discover) | Network discovery interface |

## 📡 API reference

The server exposes a small HTTP API and a WebSocket for real-time remote control.

### HTTP endpoints

| Endpoint | Method | Description |
| --- | --- | --- |
| `/api/discover` | `GET` | Discover LG TVs on the local network |
| `/api/status` | `GET` | Return the current TV connection status |
| `/api/saved-tvs` | `GET` | List saved TV IPs and names without pairing keys |
| `/api/connect` | `POST` | Connect to a TV; body: `{ "ip": "192.168.1.100", "name": "Living Room" }` |
| `/control` | WebSocket | Send commands and receive status, discovery, pairing, and error events |

### WebSocket commands

Send JSON messages to `/control`:

| Command | Payload | Purpose |
| --- | --- | --- |
| `mouse_move` | `{ "dx": 10, "dy": -5 }` | Move the TV pointer |
| `mouse_click` | — | Click at the current pointer position |
| `send_button` | `{ "key": "ENTER" }` | Send a remote button |
| `send_text` | `{ "text": "hello" }` | Send text to the active TV input |
| `discover` | — | Start a network discovery scan |
| `connect_tv` | `{ "ip": "...", "name?": "..." }` | Connect or pair with a TV |
| `submit_pairing_pin` | `{ "pin": "123456" }` | Complete a PIN pairing flow |
| `get_saved_tvs` | — | Request the saved-TV list |
| `get_status` | — | Request the current connection status |

## ⌨️ Remote controls

| Group | Controls |
| --- | --- |
| Navigation | Power, Up, Down, Left, Right, OK, Back, Home, Exit |
| TV control | Volume Up, Volume Down, Mute, Channel Up, Channel Down |
| Number pad | `0`–`9` |
| Playback | Rewind, Play/Pause, Fast Forward |
| Color keys | Red, Green, Yellow, Blue |
| Pointer | Mouse/trackpad movement and click |
| Text | Browser text field sent to the TV's active input field |

## 💻 Discovery CLI

Scan for LG TVs on the local network:

```bash
bun run discover/cli.ts
```

Scan and connect automatically when exactly one TV is found:

```bash
bun run discover/cli.ts --connect
```

Connect directly to a known TV IP address:

```bash
bun run discover/cli.ts --ip 192.168.1.100
```

Show all CLI options:

```bash
bun run discover/cli.ts --help
```

## 🔌 Protocol and connection details

The server communicates with the TV using LG's webOS WebSocket protocol. It attempts these endpoints in order:

1. `wss://<tv-ip>:3001`
2. `ws://<tv-ip>:3000`
3. `wss://<tv-ip>:3000`

Secure LG TV endpoints commonly use self-signed certificates. The client accepts those certificates for these local-network connections so pairing can work with the TV's built-in service.

The browser communicates with the Bun server through the `/control` WebSocket. TV discovery uses SSDP multicast on `239.255.255.250:1900`.

## 🔐 Security and privacy

- The server binds to `127.0.0.1` by default and is not exposed to the LAN unless you change the server configuration.
- Pairing keys are stored locally in `tv_config.json` and are never sent to browser clients.
- `tv_config.json` is ignored by Git and is written atomically with owner-only permissions on supported POSIX systems.
- The browser receives only saved TV IP addresses and display names—not client keys.
- PINs are validated and submitted without being logged or broadcast.
- Do not expose this server to an untrusted network without adding authentication and reviewing the TLS configuration.

## 🛠️ Development

Run the test suite:

```bash
bun test
```

Run the TypeScript checker:

```bash
bunx tsc --noEmit
```

Start the server with file watching during development:

```bash
bun run dev
```

## 🗂️ Project structure

```text
src/
├── server.ts            Bun HTTP/WebSocket server
├── tv-connection.ts     LG webOS connection and pairing logic
└── types.ts             Protocol types and registration payload

discover/
├── cli.ts               Discovery and connection CLI
└── discover.ts          SSDP discovery implementation

dashboard/              TV status dashboard
public/                 Remote control UI
test/                   Automated protocol and persistence tests
```

## 🤝 Contributing

Issues, fixes, and improvements are welcome. Before opening a pull request:

1. Keep changes focused and avoid committing `tv_config.json` or other secrets.
2. Run `bun test`.
3. Run `bunx tsc --noEmit`.
4. Include a clear description of the TV model or webOS behavior affected by the change.

## 📄 License

This project is licensed under the [MIT License](LICENSE).

LG and webOS are trademarks of LG Electronics. This project is an independent, unofficial remote-control application and is not affiliated with or endorsed by LG Electronics.
