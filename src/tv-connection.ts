import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TVConfig, TVConnectionStatus, TVStatus, LGResponse } from "./types";
import { LG_HANDSHAKE_PAYLOAD } from "./types";

const CONFIG_PATH = join(import.meta.dir, "..", "tv_config.json");

export class TVConnection {
  private mainWs: WebSocket | null = null;
  private pointerWs: WebSocket | null = null;
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

  setStatusCallback(cb: (status: TVStatus) => void) {
    this.onStatusChange = cb;
  }

  getStatus(): TVStatus {
    return {
      status: this.status,
      tvIp: this.tvIp,
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
    try {
      const raw = await readFile(CONFIG_PATH, "utf-8");
      return JSON.parse(raw) as TVConfig;
    } catch {
      return null;
    }
  }

  private async saveConfig() {
    if (!this.tvIp || !this.clientKey) return;
    const config: TVConfig = { tvIp: this.tvIp, clientKey: this.clientKey };
    await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
  }

  private nextId(): string {
    return `msg_${++this.msgId}`;
  }

  private sendMain(msg: Record<string, unknown>): Promise<LGResponse> {
    return new Promise((resolve, reject) => {
      if (!this.mainWs || this.mainWs.readyState !== WebSocket.OPEN) {
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
    this.setStatus("connecting");

    const config = await this.loadConfig();
    if (config && config.tvIp === ip) {
      this.clientKey = config.clientKey;
    }

    const wsUrls = [`wss://${ip}:3001`, `wss://${ip}:3000`, `ws://${ip}:3000`];
    const errors: string[] = [];

    for (const wsUrl of wsUrls) {
      this.setStatus("connecting");
      console.log(`  Trying ${wsUrl}...`);
      try {
        await this.connectWebSocket(wsUrl);
        return;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        errors.push(`${wsUrl} -> ${message}`);
        console.log(`  Failed: ${message}`);
        this.mainWs?.close();
        this.mainWs = null;
        this.pointerWs?.close();
        this.pointerWs = null;
      }
    }

    this.setStatus("disconnected");
    throw new Error(`Failed to connect to TV. Attempts: ${errors.join(" | ")}`);
  }

  private connectWebSocket(wsUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        fail(`Connection timed out at ${wsUrl}`);
      }, 12000);

      const fail = (message: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(new Error(message));
      };

      const WebSocketCtor = WebSocket as unknown as new (url: string, options?: unknown) => WebSocket;
      this.mainWs = wsUrl.startsWith("wss://")
        ? new WebSocketCtor(wsUrl, {
          tls: {
            rejectUnauthorized: false,
            serverName: this.tvIp ?? undefined,
          },
        })
        : new WebSocketCtor(wsUrl);

      this.mainWs.onopen = () => {
        clearTimeout(timeout);
        this.setStatus("pairing");
        console.log("  Connected, registering...");
        this.register().then(() => {
          settled = true;
          resolve();
        }).catch((e) => {
          const message = e instanceof Error ? e.message : String(e);
          fail(message);
        });
      };

      this.mainWs.onmessage = (event) => {
        this.handleMainMessage(event.data as string);
      };

      this.mainWs.onerror = (err) => {
        console.error("Main WS error:", err);
        const details = err instanceof Error ? err.message : String(err);
        fail(`WebSocket connection failed at ${wsUrl}: ${details}`);
      };

      this.mainWs.onclose = () => {
        this.pointerWs?.close();
        this.pointerWs = null;
        if (!settled) {
          fail(`Socket closed at ${wsUrl}`);
          return;
        }
        this.setStatus("disconnected");
      };
    });
  }

  private async register() {
    const payload: Record<string, unknown> = { ...LG_HANDSHAKE_PAYLOAD };
    if (this.clientKey) {
      payload["client-key"] = this.clientKey;
    }

    const id = this.nextId();
    this.registrationRequestId = id;

    return new Promise<void>((resolve, reject) => {
      console.log("  Waiting for pairing response (check TV for prompt)...");
      const handler = (resp: LGResponse) => {
        const returnedClientKey = resp.payload?.["client-key"];
        if (
          resp.type === "registered"
          || (resp.type === "response" && typeof returnedClientKey === "string" && returnedClientKey.length > 0)
        ) {
          if (typeof returnedClientKey === "string" && returnedClientKey.length > 0) {
            this.clientKey = returnedClientKey;
          }
          this.saveConfig().catch(() => {});
          this.setStatus("ready");
          this.setupPointerSocket().catch(() => {}); // Non-blocking
          this.subscribeToStatus();
          resolve();
        } else if (resp.type === "error") {
          this.setStatus("disconnected");
          reject(new Error(resp.error || "Registration failed"));
        }
      };
      this.pendingRequests.set(id, handler);

      const regMsg = {
        id,
        type: "register",
        payload,
      };
      this.mainWs!.send(JSON.stringify(regMsg));

      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          this.registrationRequestId = null;
          reject(new Error("Registration timed out - check TV for pairing prompt"));
        }
      }, 30000);
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

      const WebSocketCtor = WebSocket as unknown as new (url: string, options?: unknown) => WebSocket;
      this.pointerWs = socketPath.startsWith("wss://")
        ? new WebSocketCtor(socketPath, {
          tls: {
            rejectUnauthorized: false,
            serverName: this.tvIp ?? undefined,
          },
        })
        : new WebSocketCtor(socketPath);
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
    if (!this.pointerWs || this.pointerWs.readyState !== WebSocket.OPEN) return;
    const buf = Buffer.alloc(6);
    buf.writeUInt8(1, 0);
    buf.writeUInt8(0, 1);
    buf.writeInt16LE(Math.round(dx), 2);
    buf.writeInt16LE(Math.round(dy), 4);
    this.pointerWs.send(buf);
  }

  click() {
    if (!this.pointerWs || this.pointerWs.readyState !== WebSocket.OPEN) return;
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

  disconnect() {
    this.mainWs?.close();
    this.pointerWs?.close();
    this.mainWs = null;
    this.pointerWs = null;
    this.setStatus("disconnected");
    this.currentApp = null;
    this.volume = null;
    this.muted = null;
    this.pendingRequests.clear();
    this.subscriptionIds.clear();
    this.registrationRequestId = null;
  }
}
