import { discoverTVs } from "./discover";
import { TVConnection } from "../src/tv-connection";

const args = process.argv.slice(2);
const connectAfterScan = args.includes("--connect") || args.includes("-c");
const help = args.includes("--help") || args.includes("-h");

const ipArgIndex = args.findIndex((arg) => arg === "--ip");
const ipArg = ipArgIndex >= 0 ? args[ipArgIndex + 1] : undefined;

if (help) {
  console.log("Usage: bun run discover/cli.ts [--connect|-c] [--ip <tv-ip>]");
  console.log("  --connect, -c   Connect after discovery");
  console.log("  --ip <tv-ip>    Specific TV IP to connect to");
  process.exit(0);
}

console.log("Scanning for LG webOS TVs on the network...\n");

const tvs = await discoverTVs(8000);

if (tvs.length === 0) {
  console.log("No LG TVs found. Make sure your TV is powered on and on the same network.");
  process.exit(1);
}

console.log(`Found ${tvs.length} TV(s):\n`);
for (const tv of tvs) {
  console.log(`  Name : ${tv.name}`);
  console.log(`  IP   : ${tv.ip}`);
  console.log(`  UUID : ${tv.uuid}`);
  console.log();
}

if (!connectAfterScan) {
  process.exit(0);
}

const selectedIp = ipArg || (tvs.length === 1 ? tvs[0].ip : null);
if (!selectedIp) {
  console.log("Multiple TVs found. Re-run with --ip <tv-ip> to choose which one to connect.");
  process.exit(1);
}

console.log(`Connecting to ${selectedIp}...`);
const connection = new TVConnection();

try {
  await connection.connect(selectedIp);
  console.log("Connected successfully.");
} catch (e) {
  const message = e instanceof Error ? e.message : String(e);
  console.error(`Connection failed: ${message}`);
  process.exitCode = 1;
} finally {
  connection.disconnect();
}
