import { join } from "node:path";
import { existsSync } from "node:fs";
import { TVConnection } from "./tv-connection";
import { discoverTVs } from "../discover/discover";
import type { ControlMessage, ServerMessage } from "./types";

const tv = new TVConnection();
const clients = new Set<any>();

function broadcast(msg: ServerMessage) {
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === 1) {
      ws.send(data);
    }
  }
}

tv.setStatusCallback((status) => {
  broadcast({ type: "status", data: status });
});

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".ts": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function getMimeType(path: string): string {
  const ext = path.slice(path.lastIndexOf("."));
  return MIME_TYPES[ext] || "application/octet-stream";
}

async function serveStaticFile(filePath: string): Promise<Response> {
  const file = Bun.file(filePath);
  if (await file.exists()) {
    if (filePath.endsWith(".ts") && !filePath.includes("src/")) {
      const transpiler = new Bun.Transpiler({ loader: "ts" });
      const text = await file.text();
      const js = transpiler.transformSync(text);
      return new Response(js, {
        headers: { "Content-Type": "text/javascript" },
      });
    }
    return new Response(file, {
      headers: { "Content-Type": getMimeType(filePath) },
    });
  }
  return new Response("Not Found", { status: 404 });
}

const ROOT = join(import.meta.dir, "..");

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 8080,
  async fetch(req, server) {
    const url = new URL(req.url);

    if (url.pathname === "/control") {
      const upgraded = server.upgrade(req);
      if (upgraded) return undefined as any;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    if (url.pathname === "/api/discover") {
      try {
        const tvs = await discoverTVs(5000);
        return Response.json(tvs);
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500 });
      }
    }

    if (url.pathname === "/api/status") {
      return Response.json(tv.getStatus());
    }

    if (url.pathname === "/api/connect" && req.method === "POST") {
      try {
        const body = await req.json() as { ip: string };
        await tv.connect(body.ip);
        return Response.json({ success: true });
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500 });
      }
    }

    let filePath: string;
    if (url.pathname.startsWith("/dashboard")) {
      const subPath = url.pathname.replace("/dashboard", "") || "/index.html";
      filePath = join(ROOT, "dashboard", subPath === "/" ? "index.html" : subPath);
    } else if (url.pathname.startsWith("/discover")) {
      const subPath = url.pathname.replace("/discover", "") || "/index.html";
      filePath = join(ROOT, "discover", subPath === "/" ? "index.html" : subPath);
    } else {
      const subPath = url.pathname === "/" ? "/index.html" : url.pathname;
      filePath = join(ROOT, "public", subPath);
    }

    return serveStaticFile(filePath);
  },
  websocket: {
    open(ws) {
      clients.add(ws);
      ws.send(JSON.stringify({ type: "status", data: tv.getStatus() } satisfies ServerMessage));
    },
    async message(ws, raw) {
      try {
        const msg = JSON.parse(raw as string) as ControlMessage;

        switch (msg.type) {
          case "mouse_move":
            tv.moveMouse(msg.dx, msg.dy);
            break;
          case "mouse_click":
            tv.click();
            break;
          case "send_button":
            await tv.sendButton(msg.key);
            break;
          case "send_text":
            await tv.sendInput(msg.text);
            break;
          case "discover": {
            const tvs = await discoverTVs(5000);
            ws.send(JSON.stringify({ type: "discovered", tvs } satisfies ServerMessage));
            break;
          }
          case "connect_tv":
            try {
              await tv.connect(msg.ip);
            } catch (e: any) {
              ws.send(JSON.stringify({ type: "error", message: e.message } satisfies ServerMessage));
            }
            break;
          case "get_status":
            ws.send(JSON.stringify({ type: "status", data: tv.getStatus() } satisfies ServerMessage));
            break;
        }
      } catch (e: any) {
        ws.send(JSON.stringify({ type: "error", message: e.message } satisfies ServerMessage));
      }
    },
    close(ws) {
      clients.delete(ws);
    },
  },
});

console.log(`Server running at http://127.0.0.1:${server.port}`);

const config = await tv.loadConfig();
if (config) {
  console.log(`Found saved config for TV at ${config.tvIp}, auto-connecting...`);
  tv.connect(config.tvIp).catch((e) => {
    console.log(`Auto-connect failed: ${e.message}`);
  });
}
