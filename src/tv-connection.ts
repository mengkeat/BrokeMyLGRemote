import { readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import type {
  TVConfig,
  TVConnectionStatus,
  TVStatus,
  LGResponse,
  LGRegistrationPayload,
  PairingType,
} from "./types";
import { buildRegistrationPayload } from "./types";

const CONFIG_PATH = join(import.meta.dir, "..", "tv_config.json");

/** WebSocket readyState value for an open connection. */
const SOCKET_OPEN = 1;

/**
 * Minimal view of a WebSocket as used by this module. Production uses Bun's
 * global WebSocket; tests supply a fake implementing only these members.
 */
export interface WebSocketLike {
  readonly readyState: number;
  binaryType: "arraybuffer" | "blob" | "uint8array";
  onopen: ((event: { data?: unknown }) => void) | null;
  onmessage: ((event: { data: string | ArrayBuffer | Uint8Array }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
  send(data: string | ArrayBuffer | Uint8Array): void;
  close(code?: number, reason?: string): void;
}

/** Options the connection passes to the socket factory for a URL. */
export interface SocketFactoryOptions {
  /** True for `wss://` URLs (self-signed TV cert accepted on the LAN). */
  secure: boolean;
  /** Hostname used for SNI / cert-validation bypass. */
  serverName?: string;
}

/** Creates a WebSocket for a URL. Injectable so tests can supply a fake TV. */
export type TVSocketFactory = (url: string, options: SocketFactoryOptions) => WebSocketLike;

/** Persists pairing credentials. Injectable so tests can use a temp directory. */
export interface ConfigStore {
  load(): Promise<TVConfig | null>;
  save(config: TVConfig): Promise<void>;
}

/** Bun WebSocket ctor accepts a second Bun-specific options object for TLS. */
type BunWebSocketCtor = new (url: string, options?: unknown) => unknown;

const defaultSocketFactory: TVSocketFactory = (url, options) => {
  const Ctor = WebSocket as unknown as BunWebSocketCtor;
  const ws = options.secure
    ? new Ctor(url, {
      tls: {
        rejectUnauthorized: false,
        serverName: options.serverName,
      },
    })
    : new Ctor(url);
  return ws as unknown as WebSocketLike;
};

/**
 * File-backed config store. Writes are atomic: the JSON is written to a temp
 * file in the same directory and renamed onto the final path, so an interrupted
 * write never leaves a partially-written tv_config.json. On POSIX the file is
 * created owner-only (0o600) so the saved client key is not world-readable.
 */
export function createFileConfigStore(
  configPath: string,
  tmpPath = `${configPath}.tmp`,
): ConfigStore {
  return {
    async load() {
      try {
        const raw = await readFile(configPath, "utf-8");
        return JSON.parse(raw) as TVConfig;
      } catch {
        return null;
      }
    },
    async save(config) {
      await writeFile(tmpPath, JSON.stringify(config, null, 2), { mode: 0o600 });
      await rename(tmpPath, configPath);
    },
  };
}

const defaultConfigStore = createFileConfigStore(CONFIG_PATH);

export interface TVConnectionOptions {
  socketFactory?: TVSocketFactory;
  configStore?: ConfigStore;
}

/** Validate a loaded config before trusting it (never assume JSON shape). */
function isValidConfig(c: unknown): c is TVConfig {
  if (typeof c !== "object" || c === null) return false;
  const cfg = c as Partial<TVConfig>;
  return typeof cfg.tvIp === "string" && cfg.tvIp.length > 0
    && typeof cfg.clientKey === "string" && cfg.clientKey.length > 0;
}

/**
 * Raised when the TV explicitly rejects a registration (e.g. `AUTH_ERROR` /
 * denied pairing prompt), as opposed to a transport failure or timeout.
 *
 * Carries only safe TV-side error text — never the client key.
 */
export class RegistrationRejectedError extends Error {
  constructor(message: string, readonly tvError?: string) {
    super(message);
    this.name = "RegistrationRejectedError";
  }
}

export class TVConnection {
  private mainWs: WebSocketLike | null = null;
  private pointerWs: WebSocketLike | null = null;
  private status: TVConnectionStatus = "disconnected";
  private tvIp: string | null = null;
  private clientKey: string | null = null;
  private msgId = 0;
  private pendingRequests = new Map<string, (resp: LGResponse) => void>();
  private subscriptionIds = new Set<string>();
  private registrationRequestId: string | null = null;
  private currentApp: string | null = null;
  private volume: number | null = null;
  private muted: boolean | null = null;
  private onStatusChange: ((status: TVStatus) => void) | null = null;
  private onMessage: ((message: string) => void) | null = null;
  private readonly socketFactory: TVSocketFactory;
  private readonly configStore: ConfigStore;
  /** True while the current attempt is registering with a saved client key. */
  private usedSavedKey = false;
  /** Guards against more than one keyless recovery attempt per connection. */
  private keylessRetryUsed = false;
  /** Active pairing mode while status is "pairing"; null otherwise. */
  private pairingType: PairingType | null = null;
  /** True once a PIN has been sent for the current PIN pairing (blocks dupes). */
  private pinSubmitted = false;

  constructor(options: TVConnectionOptions = {}) {
    this.socketFactory = options.socketFactory ?? defaultSocketFactory;
    this.configStore = options.configStore ?? defaultConfigStore;
  }

  setStatusCallback(cb: (status: TVStatus) => void) {
    this.onStatusChange = cb;
  }

  /** Subscribe to human-readable pairing/credential notices (never secrets). */
  setMessageCallback(cb: (message: string) => void) {
    this.onMessage = cb;
  }

  private notify(message: string) {
    this.onMessage?.(message);
  }

  getStatus(): TVStatus {
    return {
      status: this.status,
      tvIp: this.tvIp,
      pairingType: this.pairingType,
      currentApp: this.currentApp,
      volume: this.volume,
      muted: this.muted,
    };
  }

  private setStatus(s: TVConnectionStatus) {
    this.status = s;
    this.onStatusChange?.(this.getStatus());
  }

  async loadConfig(): Promise<TVConfig | null> {
    return this.configStore.load();
  }

  private async saveConfig() {
    if (!this.tvIp || !this.clientKey) return;
    const config: TVConfig = { tvIp: this.tvIp, clientKey: this.clientKey };
    await this.configStore.save(config);
  }

  private nextId(): string {
    return `msg_${++this.msgId}`;
  }

  private sendMain(msg: Record<string, unknown>): Promise<LGResponse> {
    return new Promise((resolve, reject) => {
      if (!this.mainWs || this.mainWs.readyState !== SOCKET_OPEN) {
        return reject(new Error("Main WebSocket not connected"));
      }
      const id = msg.id as string || this.nextId();
      msg.id = id;
      this.pendingRequests.set(id, resolve);
      this.mainWs.send(JSON.stringify(msg));
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request ${id} timed out`));
        }
      }, 10000);
    });
  }

  async connect(ip: string) {
    if (this.mainWs) this.disconnect();

    this.tvIp = ip;

    // Always start from a clean key: a previous TV's key must never leak into a
    // new connection, and a saved key is only reused when the stored IP matches.
    this.clientKey = null;
    this.usedSavedKey = false;
    this.keylessRetryUsed = false;
    this.pairingType = null;
    this.pinSubmitted = false;

    const rawConfig = await this.loadConfig();
    if (isValidConfig(rawConfig)) {
      if (rawConfig.tvIp === ip) {
        this.clientKey = rawConfig.clientKey;
        this.usedSavedKey = true;
        console.log(`  Reusing saved client key for ${ip}.`);
      } else {
        console.log(`  Ignoring saved config for ${rawConfig.tvIp} (does not match ${ip}).`);
      }
    } else if (rawConfig !== null) {
      console.log("  Saved TV config is malformed; ignoring it.");
      this.notify("The saved TV config was unreadable, so a fresh pairing will be required.");
    }

    this.setStatus("connecting");

    const wsUrls = [`wss://${ip}:3001`, `wss://${ip}:3000`, `ws://${ip}:3000`];
    const errors: string[] = [];

    for (const wsUrl of wsUrls) {
      this.setStatus("connecting");
      console.log(`  Trying ${wsUrl}...`);
      try {
        await this.connectWebSocket(wsUrl);
        return;
      } catch (e) {
        // An explicit TV-side pairing rejection is fatal: the same reachable TV
        // would just re-prompt on the next endpoint, so stop immediately rather
        // than spamming pairing prompts across all endpoints.
        if (e instanceof RegistrationRejectedError) {
          this.cleanupSocket();
          this.setStatus("disconnected");
          throw e;
        }
        const message = e instanceof Error ? e.message : String(e);
        errors.push(`${wsUrl} -> ${message}`);
        console.log(`  Failed: ${message}`);
        this.cleanupSocket();
      }
    }

    this.setStatus("disconnected");
    throw new Error(`Failed to connect to TV. Attempts: ${errors.join(" | ")}`);
  }

  private cleanupSocket() {
    this.mainWs?.close();
    this.mainWs = null;
    this.pointerWs?.close();
    this.pointerWs = null;
  }

  private connectWebSocket(wsUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        fail(new Error(`Connection timed out at ${wsUrl}`));
      }, 12000);

      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(err);
      };

      this.mainWs = this.socketFactory(wsUrl, {
        secure: wsUrl.startsWith("wss://"),
        serverName: this.tvIp ?? undefined,
      });

      this.mainWs.onopen = () => {
        clearTimeout(timeout);
        this.register()
          .then(() => {
            if (settled) return;
            settled = true;
            resolve();
          })
          .catch((e) => {
            // Propagate the original error so connect() can tell a registration
            // rejection (RegistrationRejectedError) apart from a transport fault.
            fail(e instanceof Error ? e : new Error(String(e)));
          });
      };

      this.mainWs.onmessage = (event) => {
        this.handleMainMessage(event.data as string);
      };

      this.mainWs.onerror = (err) => {
        console.error("Main WS error:", err);
        const details = err instanceof Error ? err.message : String(err);
        fail(new Error(`WebSocket connection failed at ${wsUrl}: ${details}`));
      };

      this.mainWs.onclose = () => {
        this.pointerWs?.close();
        this.pointerWs = null;
        if (!settled) {
          fail(new Error(`Socket closed at ${wsUrl}`));
          return;
        }
        this.setStatus("disconnected");
      };
    });
  }

  /**
   * Register on the current socket, recovering once if a *saved* key is
   * rejected by clearing it and re-pairing from scratch on the same socket.
   */
  private register(): Promise<void> {
    return this.attemptRegistration().catch((err) => {
      if (
        err instanceof RegistrationRejectedError
        && this.usedSavedKey
        && !this.keylessRetryUsed
      ) {
        console.log("  Saved client key rejected by TV; retrying with fresh pairing...");
        this.clientKey = null;
        this.usedSavedKey = false;
        this.keylessRetryUsed = true;
        return this.attemptRegistration();
      }
      throw err;
    });
  }

  private attemptRegistration(): Promise<void> {
    const payload: LGRegistrationPayload = buildRegistrationPayload(this.clientKey ?? undefined);
    const id = this.nextId();
    this.registrationRequestId = id;
    this.pairingType = "PROMPT";
    this.pinSubmitted = false;
    this.setStatus("pairing");
    console.log(`  Registering${this.clientKey ? " with saved key" : " (fresh pairing)"}...`);

    return new Promise<void>((resolve, reject) => {
      const registrationTimer = setTimeout(() => {
        this.pendingRequests.delete(id);
        if (this.registrationRequestId === id) this.registrationRequestId = null;
        this.pairingType = null;
        this.pinSubmitted = false;
        reject(new Error("Registration timed out - check TV for pairing prompt"));
      }, 30000);

      const handler = (resp: LGResponse) => {
        const returnedClientKey = resp.payload?.["client-key"];
        if (
          resp.type === "registered"
          || (resp.type === "response" && typeof returnedClientKey === "string" && returnedClientKey.length > 0)
        ) {
          clearTimeout(registrationTimer);
          this.pendingRequests.delete(id);
          this.registrationRequestId = null;
          if (typeof returnedClientKey === "string" && returnedClientKey.length > 0) {
            this.clientKey = returnedClientKey;
          }
          this.pairingType = null;
          this.pinSubmitted = false;
          this.saveConfig().catch((e) => {
            const reason = e instanceof Error ? e.message : String(e);
            console.error("  Failed to save TV config:", reason);
            this.notify(
              `Could not save pairing credentials (${reason}). Pairing may be required again on the next start.`,
            );
          });
          this.setStatus("ready");
          this.setupPointerSocket().catch(() => {}); // Non-blocking
          this.subscribeToStatus();
          resolve();
        } else if (resp.type === "error" || resp.returnValue === false) {
          clearTimeout(registrationTimer);
          this.pendingRequests.delete(id);
          this.registrationRequestId = null;
          this.pairingType = null;
          this.pinSubmitted = false;
          this.setStatus("disconnected");
          reject(new RegistrationRejectedError(
            resp.error || resp.errorText || "Registration rejected by TV",
            resp.error,
          ));
        } else if (resp.type === "response" && resp.payload?.pairingType === "PIN") {
          // The TV wants PIN pairing: keep the registration handler open and ask
          // the UI for the PIN, then keep waiting for the registered response
          // that follows a correct ssap://pairing/setPin.
          this.pairingType = "PIN";
          this.setStatus("pairing");
          console.log("  TV requires a PIN; awaiting PIN entry.");
          this.notify("Enter the PIN displayed on the TV to complete pairing.");
        } else if (resp.type === "response" && resp.payload?.pairingType === "PROMPT") {
          this.pairingType = "PROMPT";
          this.setStatus("pairing");
          this.notify("Approve the pairing prompt on the TV screen.");
        }
        // Other intermediate responses - keep waiting for a terminal one.
      };
      this.pendingRequests.set(id, handler);

      this.mainWs!.send(JSON.stringify({
        id,
        type: "register",
        payload,
      }));
    });
  }

  private handleMainMessage(data: string) {
    try {
      const resp = JSON.parse(data) as LGResponse;
      const handler = this.pendingRequests.get(resp.id);
      if (handler) {
        const isSubscription = this.subscriptionIds.has(resp.id);
        const isRegistration = this.registrationRequestId === resp.id;
        const registrationDone = resp.type === "registered"
          || resp.type === "error"
          || typeof resp.payload?.["client-key"] === "string";

        if (!isSubscription && !isRegistration) {
          this.pendingRequests.delete(resp.id);
        } else if (isRegistration && registrationDone) {
          this.pendingRequests.delete(resp.id);
          this.registrationRequestId = null;
        }

        handler(resp);
        return;
      }

      if (resp.payload) {
        if ("appId" in resp.payload) {
          this.currentApp = resp.payload.appId as string;
          this.onStatusChange?.(this.getStatus());
        }
        if ("volume" in resp.payload) {
          this.volume = resp.payload.volume as number;
          this.muted = (resp.payload.muted as boolean) ?? this.muted;
          this.onStatusChange?.(this.getStatus());
        }
      }
    } catch (e) {
      console.error("Failed to parse main WS message:", e);
    }
  }

  private async setupPointerSocket() {
    try {
      const resp = await this.sendMain({
        type: "request",
        uri: "ssap://com.webos.service.networkinput/getPointerInputSocket",
      });

      const socketPath = resp.payload?.socketPath as string;
      if (!socketPath) {
        console.error("No socketPath in pointer response");
        return;
      }

      this.pointerWs = this.socketFactory(socketPath, {
        secure: socketPath.startsWith("wss://"),
        serverName: this.tvIp ?? undefined,
      });
      this.pointerWs.binaryType = "arraybuffer";

      this.pointerWs.onerror = (err) => {
        console.error("Pointer WS error:", err);
      };

      this.pointerWs.onclose = () => {
        this.pointerWs = null;
      };
    } catch {
      // Pointer socket setup failed - not critical, mouse control won't work
    }
  }

  private async subscribeToStatus() {
    try {
      const fgId = this.nextId();
      this.subscriptionIds.add(fgId);
      this.pendingRequests.set(fgId, (resp) => {
        if (resp.payload?.appId) {
          this.currentApp = resp.payload.appId as string;
          this.onStatusChange?.(this.getStatus());
        }
      });
      this.mainWs!.send(JSON.stringify({
        id: fgId,
        type: "subscribe",
        uri: "ssap://com.webos.applicationManager/getForegroundAppInfo",
      }));

      const volId = this.nextId();
      this.subscriptionIds.add(volId);
      this.pendingRequests.set(volId, (resp) => {
        if (resp.payload && "volume" in resp.payload) {
          this.volume = resp.payload.volume as number;
          this.muted = (resp.payload.muted as boolean) ?? this.muted;
          this.onStatusChange?.(this.getStatus());
        }
      });
      this.mainWs!.send(JSON.stringify({
        id: volId,
        type: "subscribe",
        uri: "ssap://audio/getVolume",
      }));
    } catch (e) {
      console.error("Failed to subscribe to status:", e);
    }
  }

  moveMouse(dx: number, dy: number) {
    if (!this.pointerWs || this.pointerWs.readyState !== SOCKET_OPEN) return;
    const buf = Buffer.alloc(6);
    buf.writeUInt8(1, 0);
    buf.writeUInt8(0, 1);
    buf.writeInt16LE(Math.round(dx), 2);
    buf.writeInt16LE(Math.round(dy), 4);
    this.pointerWs.send(buf);
  }

  click() {
    if (!this.pointerWs || this.pointerWs.readyState !== SOCKET_OPEN) return;
    const down = Buffer.from([2, 1, 0, 0]);
    const up = Buffer.from([3, 1, 0, 0]);
    this.pointerWs.send(down);
    setTimeout(() => {
      this.pointerWs?.send(up);
    }, 50);
  }

  async sendButton(key: string) {
    if (this.status !== "ready") throw new Error("Not connected");
    await this.sendMain({
      type: "request",
      uri: "ssap://com.webos.service.networkinput/sendButton",
      payload: { name: key },
    });
  }

  async sendInput(text: string) {
    if (this.status !== "ready") throw new Error("Not connected");
    await this.sendMain({
      type: "request",
      uri: "ssap://com.webos.service.ime/sendText",
      payload: { text, replace: 0 },
    });
  }

  /**
   * Submit the on-screen PIN during PIN pairing. Validates locally, then sends
   * `ssap://pairing/setPin`. The pending registration resolves/rejects from its
   * own handler afterwards. The PIN is never logged or broadcast.
   */
  async submitPairingPin(pin: string) {
    if (this.status !== "pairing") {
      throw new Error("Cannot submit a PIN: no pairing is in progress");
    }
    if (this.pairingType !== "PIN") {
      throw new Error("Cannot submit a PIN: the TV did not request PIN pairing");
    }
    if (this.pinSubmitted) {
      throw new Error("A PIN has already been submitted for this pairing");
    }
    if (!/^\d{4,8}$/.test(pin.trim())) {
      throw new Error("PIN must be 4-8 digits");
    }
    if (!this.mainWs || this.mainWs.readyState !== SOCKET_OPEN) {
      throw new Error("Not connected to TV");
    }
    this.pinSubmitted = true;
    this.mainWs.send(JSON.stringify({
      id: this.nextId(),
      type: "request",
      uri: "ssap://pairing/setPin",
      payload: { pin: pin.trim() },
    }));
  }

  disconnect() {
    this.mainWs?.close();
    this.pointerWs?.close();
    this.mainWs = null;
    this.pointerWs = null;
    this.clientKey = null;
    this.usedSavedKey = false;
    this.keylessRetryUsed = false;
    this.pairingType = null;
    this.pinSubmitted = false;
    this.setStatus("disconnected");
    this.currentApp = null;
    this.volume = null;
    this.muted = null;
    this.pendingRequests.clear();
    this.subscriptionIds.clear();
    this.registrationRequestId = null;
  }
}
