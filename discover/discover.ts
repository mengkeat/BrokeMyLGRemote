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

/** Decode the URL-encoded `DLNADeviceName.lge.com` SSDP header value. */
function decodeDlnaName(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value).trim();
    return decoded || null;
  } catch {
    return null;
  }
}

/**
 * Fetch the friendly name from the device-description XML at the SSDP LOCATION.
 * The location port varies by responder (e.g. 1873 DIAL, 1340 DLNA/DMR, 1400,
 * 1505), so probing fixed ports does not work — always use the advertised URL.
 * Returns null if unreachable so the caller keeps its default name.
 */
async function fetchDeviceName(locationUrl: string): Promise<string | null> {
  try {
    const resp = await fetch(locationUrl, { signal: AbortSignal.timeout(2000) });
    const text = await resp.text();
    const match = text.match(/<friendlyName>([^<]+)<\/friendlyName>/);
    if (match) return match[1];
  } catch {
    // device description unreachable; caller falls back to the default name
  }
  return null;
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

      // Prefer the name embedded in the SSDP packet (no network round-trip),
      // then fall back to the device-description XML at the LOCATION URL.
      const packetName = headers["dlndevicename.lge.com"]
        ? decodeDlnaName(headers["dlndevicename.lge.com"]!)
        : null;
      const tv: DiscoveredTV = { name: packetName ?? "LG TV", ip, uuid: usn };
      found.set(ip, tv);

      if (!packetName && location) {
        const namePromise = fetchDeviceName(location).then((name) => {
          if (name) tv.name = name;
        });
        pendingNames.push(namePromise);
      }
    });

    socket.on("error", (err) => {
      console.error("SSDP socket error:", err.message);
      socket.close();
      resolve([...found.values()]);
    });

    socket.bind(0, "0.0.0.0", () => {
      socket.setBroadcast(true);
      // Default multicast TTL can be too low for some networks/subnet
      // configurations; raise it so M-SEARCH reliably stays on the local link.
      socket.setMulticastTTL(4);

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
