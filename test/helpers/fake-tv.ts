import type { TVSocketFactory, SavedTvsStore, WebSocketLike } from "../../src/tv-connection";
import type { SavedTV } from "../../src/types";

type Json = Record<string, unknown>;

/**
 * Minimal WebSocket stand-in. Tests drive connection lifecycle by calling
 * `open()` / `receive()` / `error()` / `closeRemote()`, and inspect `sent`.
 */
export class FakeSocket implements WebSocketLike {
  readyState = 0;
  binaryType: WebSocketLike["binaryType"] = "arraybuffer";
  onopen: WebSocketLike["onopen"] = null;
  onmessage: WebSocketLike["onmessage"] = null;
  onerror: WebSocketLike["onerror"] = null;
  onclose: WebSocketLike["onclose"] = null;
  readonly sent: Json[] = [];
  /** Called for every sent message; default auto-replies to non-register traffic. */
  onSend: (msg: Json, socket: FakeSocket) => void = defaultAutoResponder;

  constructor(readonly url: string) {}

  send(data: string | ArrayBuffer | Uint8Array): void {
    if (typeof data === "string") {
      try {
        this.sent.push(JSON.parse(data) as Json);
      } catch {
        this.sent.push({ _raw: data });
      }
    } else {
      this.sent.push({ _raw: Array.from(new Uint8Array(data instanceof ArrayBuffer ? data : data.buffer ?? new ArrayBuffer(0))) });
    }
    const last = this.sent[this.sent.length - 1];
    if (last && !("_raw" in last)) this.onSend(last, this);
  }

  close(): void {
    this.readyState = 3;
  }

  // ---- test drivers ----
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(msg: Json): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  error(event: unknown): void {
    this.onerror?.(event);
  }
  closeRemote(): void {
    this.readyState = 3;
    this.onclose?.({});
  }
  lastSent(): Json {
    return this.sent[this.sent.length - 1];
  }
}

/** Replies to pointer-socket and subscription requests so they never hang. */
function defaultAutoResponder(msg: Json, socket: FakeSocket): void {
  if (msg.type !== "request" && msg.type !== "subscribe") return;
  const uri = msg.uri as string | undefined;
  const id = msg.id as string;
  if (uri?.includes("getPointerInputSocket")) {
    socket.receive({ id, type: "response", payload: { socketPath: "wss://fake-tv/pointer" } });
  } else {
    socket.receive({ id, type: "response", payload: {} });
  }
}

export interface FakeFactory {
  factory: TVSocketFactory;
  sockets: FakeSocket[];
  /** First socket created is the main control socket for a connection attempt. */
  main: () => FakeSocket;
  /** Most recent socket whose URL contains `substr` (e.g. an IP or port). */
  forUrl: (substr: string) => FakeSocket | undefined;
}

export function makeFakeFactory(): FakeFactory {
  const sockets: FakeSocket[] = [];
  const factory: TVSocketFactory = (url) => {
    const s = new FakeSocket(url);
    sockets.push(s);
    return s;
  };
  const forUrl = (substr: string) =>
    sockets.filter((s) => s.url.includes(substr)).at(-1);
  return { factory, sockets, main: () => sockets[0], forUrl };
}

export interface MemoryStore {
  store: SavedTvsStore;
  saveCalls: SavedTV[][];
  /** First saved entry (the "active" one in single-TV scenarios). */
  current: () => SavedTV | null;
  /** Every saved entry. */
  all: () => SavedTV[];
  /** Look up a saved entry by IP. */
  findByIp: (ip: string) => SavedTV | undefined;
}

export function makeMemoryStore(initial: SavedTV[] = []): MemoryStore {
  let value = [...initial];
  const saveCalls: SavedTV[][] = [];
  const store: SavedTvsStore = {
    async load() {
      return value;
    },
    async save(tvs) {
      value = [...tvs];
      saveCalls.push([...tvs]);
    },
  };
  return {
    store,
    saveCalls,
    current: () => value[0] ?? null,
    all: () => value,
    findByIp: (ip) => value.find((t) => t.ip === ip),
  };
}

export const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function waitFor<T>(fn: () => T | undefined | null | false, timeoutMs = 1000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v as T;
    if (Date.now() - start >= timeoutMs) throw new Error(`waitFor timed out after ${timeoutMs}ms`);
    await tick(1);
  }
}

/** The registration message a TV would send back on a successful pairing. */
export function registeredResponse(id: string, clientKey: string): Json {
  return { id, type: "registered", payload: { "client-key": clientKey } };
}
