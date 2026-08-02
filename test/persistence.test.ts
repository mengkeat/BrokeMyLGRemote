import { test, expect } from "bun:test";
import { access, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TVConnection, createFileConfigStore } from "../src/tv-connection";
import type { ConfigStore } from "../src/tv-connection";
import type { TVConfig } from "../src/types";
import { makeFakeFactory, waitFor, registeredResponse } from "./helpers/fake-tv";

test("file config store writes credentials atomically with user-only permissions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lgcfg-"));
  const configPath = join(dir, "tv_config.json");
  const tmpPath = `${configPath}.tmp`;
  const store = createFileConfigStore(configPath);
  try {
    await store.save({ tvIp: "192.0.2.77", clientKey: "K" });

    // No leftover temp file after a successful write.
    const tmpExists = await access(tmpPath).then(() => true, () => false);
    expect(tmpExists).toBe(false);

    const s = await stat(configPath);
    expect(s.isFile()).toBe(true);
    if (process.platform !== "win32") {
      expect(s.mode & 0o777).toBe(0o600); // owner-only
    }

    expect(await store.load()).toEqual({ tvIp: "192.0.2.77", clientKey: "K" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a persistence failure keeps the session usable and warns without exposing the key", async () => {
  const failingStore: ConfigStore = {
    load: async () => null,
    save: async () => {
      throw new Error("disk full");
    },
  };
  const fake = makeFakeFactory();
  const messages: string[] = [];
  const tv = new TVConnection({ socketFactory: fake.factory, configStore: failingStore });
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

test("a malformed saved config is ignored with a notice and a fresh pairing", async () => {
  const malformedStore: ConfigStore = {
    load: async () => ({ tvIp: "", clientKey: "" } as unknown as TVConfig), // fails validation
    save: async () => {},
  };
  const fake = makeFakeFactory();
  const messages: string[] = [];
  const tv = new TVConnection({ socketFactory: fake.factory, configStore: malformedStore });
  tv.setMessageCallback((m) => messages.push(m));

  const connectPromise = tv.connect("192.0.2.5");
  const main = await waitFor(() => fake.sockets[0]);
  main.open();
  const reg = (await waitFor(() => main.lastSent())) as {
    id: string;
    payload?: Record<string, unknown>;
  };
  expect(reg.payload?.["client-key"]).toBeUndefined(); // malformed key not reused

  main.receive(registeredResponse(reg.id, "new-key"));
  await connectPromise;

  expect(messages.some((m) => m.toLowerCase().includes("unreadable"))).toBe(true);
  tv.disconnect();
});
