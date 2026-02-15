import { createSocket } from "node:dgram";
import type { DiscoveredTV } from "../src/types";

const SSDP_ADDR = "239.255.255.250";
const SSDP_PORT = 1900;

const SEARCH_TARGETS = [
  "urn:lge-com:service:webOSSecondScreen:1",
  "urn:dial-multiscreen-org:service:dial:1",
  "ssdp:all",
];

function buildMSearch(st: string): string {
  return [
    "M-SEARCH * HTTP/1.1",
    `HOST: ${SSDP_ADDR}:${SSDP_PORT}`,
    'MAN: "ssdp:discover"',
    "MX: 5",
    `ST: ${st}`,
    "",
    "",
  ].join("\r\n");
}

function parseHeaders(raw: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of raw.split("\r\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
    }
  }
  return headers;
}

function extractIpFromLocation(location: string): string | null {
  try {
    return new URL(location).hostname;
  } catch {
    return null;
  }
}

function isLGWebOS(raw: string): boolean {
  const lc = raw.toLowerCase();
  return lc.includes("webos") || lc.includes("lge") || lc.includes("lg ");
}

async function fetchDeviceName(ip: string): Promise<string> {
  const urls = [
    `http://${ip}:3000/`,
    `http://${ip}:1998/`,
    `http://${ip}:1150/`,
  ];
  for (const url of urls) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(2000) });
      const text = await resp.text();
      const match = text.match(/<friendlyName>([^<]+)<\/friendlyName>/);
      if (match) return match[1];
      const modelMatch = text.match(/<modelName>([^<]+)<\/modelName>/);
      if (modelMatch) return modelMatch[1];
    } catch {
      continue;
    }
  }
  return "LG TV";
}

export async function discoverTVs(timeoutMs = 8000): Promise<DiscoveredTV[]> {
  const found = new Map<string, DiscoveredTV>();
  const pendingNames: Promise<void>[] = [];

  return new Promise((resolve) => {
    const socket = createSocket({ type: "udp4", reuseAddr: true });

    socket.on("message", (buf, rinfo) => {
      const raw = buf.toString();
      if (!isLGWebOS(raw)) return;

      const headers = parseHeaders(raw);
      const location = headers["location"];
      const usn = headers["usn"] || rinfo.address;
      const ip = location ? extractIpFromLocation(location) : rinfo.address;
      if (!ip || found.has(ip)) return;

      const tv: DiscoveredTV = { name: "LG TV", ip, uuid: usn };
      found.set(ip, tv);

      const namePromise = fetchDeviceName(ip).then((name) => {
        tv.name = name;
      });
      pendingNames.push(namePromise);
    });

    socket.on("error", (err) => {
      console.error("SSDP socket error:", err.message);
      socket.close();
      resolve([...found.values()]);
    });

    socket.bind(0, "0.0.0.0", () => {
      socket.setBroadcast(true);

      for (const st of SEARCH_TARGETS) {
        const b = Buffer.from(buildMSearch(st));
        socket.send(b, 0, b.length, SSDP_PORT, SSDP_ADDR);
      }

      setTimeout(() => {
        for (const st of SEARCH_TARGETS) {
          const b = Buffer.from(buildMSearch(st));
          socket.send(b, 0, b.length, SSDP_PORT, SSDP_ADDR);
        }
      }, 2000);
    });

    setTimeout(async () => {
      socket.close();
      await Promise.allSettled(pendingNames);
      resolve([...found.values()]);
    }, timeoutMs);
  });
}
