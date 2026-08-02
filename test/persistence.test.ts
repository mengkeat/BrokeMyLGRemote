import { test, expect } from "bun:test";
import { access, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TVConnection, createFileSavedTvsStore } from "../src/tv-connection";
import type { SavedTvsStore } from "../src/tv-connection";
import { makeFakeFactory, waitFor, registeredResponse } from "./helpers/fake-tv";

test("file saved-TVs store writes the list atomically with user-only permissions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lgcfg-"));
  const configPath = join(dir, "tv_config.json");
  const tmpPath = `${configPath}.tmp`;
  const store = createFileSavedTvsStore(configPath);
  try {
    await store.save([{ ip: "192.0.2.77", clientKey: "K" }]);

    // No leftover temp file after a successful write.
    const tmpExists = await access(tmpPath).then(() => true, () => false);
    expect(tmpExists).toBe(false);

    const s = await stat(configPath);
    expect(s.isFile()).toBe(true);
    if (process.platform !== "win32") {
      expect(s.mode & 0o777).toBe(0o600); // owner-only
    }

    // The document is versioned and never contains a bare { tvIp, clientKey }.
    const raw = await Bun.file(configPath).text();
    const doc = JSON.parse(raw);
    expect(doc).toEqual({ version: 1, tvs: [{ ip: "192.0.2.77", clientKey: "K" }] });

    expect(await store.load()).toEqual([{ ip: "192.0.2.77", clientKey: "K" }]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("file store migrates the legacy single-TV format and drops invalid entries", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lgcfg-"));
  const legacyPath = join(dir, "tv_config.json");
  const store = createFileSavedTvsStore(legacyPath);
  try {
    await writeFile(legacyPath, JSON.stringify({ tvIp: "192.0.2.5", clientKey: "legacy" }));
    expect(await store.load()).toEqual([{ ip: "192.0.2.5", clientKey: "legacy" }]);

    // An entry that fails validation is filtered out rather than trusted.
    await writeFile(
      legacyPath,
      JSON.stringify({ version: 1, tvs: [{ ip: "", clientKey: "" }, { ip: "192.0.2.6", clientKey: "ok" }] }),
    );
    expect(await store.load()).toEqual([{ ip: "192.0.2.6", clientKey: "ok" }]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a persistence failure keeps the session usable and warns without exposing the key", async () => {
  const failingStore: SavedTvsStore = {
    load: async () => [],
    save: async () => {
      throw new Error("disk full");
    },
  };
  const fake = makeFakeFactory();
  const messages: string[] = [];
  const tv = new TVConnection({ socketFactory: fake.factory, savedTvsStore: failingStore });
  tv.setMessageCallback((m) => messages.push(m));

  const connectPromise = tv.connect("192.0.2.88");
  const main = await waitFor(() => fake.sockets[0]);
  main.open();
  const reg = (await waitFor(() => main.lastSent())) as { id: string };
  main.receive(registeredResponse(reg.id, "super-secret-key"));
  await connectPromise;

  expect(tv.getStatus().status).toBe("ready"); // session still usable

  const warning = messages.find((m) => m.toLowerCase().includes("could not save"));
  expect(warning).toBeTruthy();
  expect(warning).not.toContain("super-secret-key");

  tv.disconnect();
});
