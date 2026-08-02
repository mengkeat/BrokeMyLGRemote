import { test, expect } from "bun:test";
import { TVConnection } from "../src/tv-connection";
import { makeFakeFactory, makeMemoryStore, waitFor, registeredResponse } from "./helpers/fake-tv";

function setup(config: ReturnType<typeof makeMemoryStore> = makeMemoryStore()) {
  const fake = makeFakeFactory();
  const tv = new TVConnection({ socketFactory: fake.factory, configStore: config.store });
  return { tv, fake, config };
}

test("first-time pairing sends no client-key and persists the returned key", async () => {
  const { tv, fake, config } = setup();

  const connectPromise = tv.connect("192.0.2.10");
  const main = await waitFor(() => fake.sockets[0]);

  main.open(); // socket connected → client registers immediately
  const reg = (await waitFor(() => main.lastSent())) as {
    id: string;
    type: string;
    payload?: Record<string, unknown>;
  };
  expect(reg.type).toBe("register");
  expect(reg.payload?.["client-key"]).toBeUndefined(); // first time: no key sent

  main.receive(registeredResponse(reg.id, "client-key-A"));
  await connectPromise;

  expect(tv.getStatus().status).toBe("ready");
  expect(config.current()).toEqual({ tvIp: "192.0.2.10", clientKey: "client-key-A" });

  tv.disconnect();
});

test("reconnecting with a matching saved key sends the key and reaches ready silently", async () => {
  const { tv, fake, config } = setup(
    makeMemoryStore({ tvIp: "192.0.2.20", clientKey: "saved-key-B" }),
  );

  const connectPromise = tv.connect("192.0.2.20");
  const main = await waitFor(() => fake.sockets[0]);

  main.open();
  const reg = (await waitFor(() => main.lastSent())) as {
    id: string;
    payload?: Record<string, unknown>;
  };
  expect(reg.payload?.["client-key"]).toBe("saved-key-B");

  main.receive(registeredResponse(reg.id, "saved-key-B")); // no new pairing prompt
  await connectPromise;

  expect(tv.getStatus().status).toBe("ready");
  // The saved key is preserved on disk across a silent reconnect.
  expect(config.current()).toEqual({ tvIp: "192.0.2.20", clientKey: "saved-key-B" });

  tv.disconnect();
});

test("connecting to a different TV never reuses the previous TV's saved key", async () => {
  const { tv, fake, config } = setup(
    makeMemoryStore({ tvIp: "192.0.2.30", clientKey: "tv-A-key" }),
  );

  // Stored config is for 192.0.2.30; connecting to a different IP must drop it.
  const connectPromise = tv.connect("192.0.2.99");
  const main = await waitFor(() => fake.forUrl("192.0.2.99"));

  main.open();
  const reg = (await waitFor(() => main.lastSent())) as {
    id: string;
    payload?: Record<string, unknown>;
  };
  expect(reg.payload?.["client-key"]).toBeUndefined(); // no stale key leaked

  main.receive(registeredResponse(reg.id, "tv-B-key"));
  await connectPromise;

  expect(config.current()).toEqual({ tvIp: "192.0.2.99", clientKey: "tv-B-key" });
  tv.disconnect();
});

test("a rejected saved key recovers with one fresh keyless pairing on the same socket", async () => {
  const { tv, fake, config } = setup(
    makeMemoryStore({ tvIp: "192.0.2.40", clientKey: "stale-key" }),
  );

  const connectPromise = tv.connect("192.0.2.40");
  const main = await waitFor(() => fake.forUrl("192.0.2.40"));

  main.open();
  const reg1 = (await waitFor(() =>
    main.sent.find((m) => m.type === "register"),
  )) as { id: string; payload?: Record<string, unknown> };
  expect(reg1.payload?.["client-key"]).toBe("stale-key");

  // TV rejects the saved key.
  main.receive({ id: reg1.id, type: "error", error: "AUTH_ERROR" });

  // ...which triggers exactly one keyless retry on the same socket.
  const reg2 = (await waitFor(() => {
    const regs = main.sent.filter((m) => m.type === "register");
    return regs.length >= 2 ? regs[1] : undefined;
  })) as { id: string; payload?: Record<string, unknown> };
  expect(reg2.payload?.["client-key"]).toBeUndefined();

  main.receive(registeredResponse(reg2.id, "fresh-key"));
  await connectPromise;

  expect(tv.getStatus().status).toBe("ready");
  expect(config.current()).toEqual({ tvIp: "192.0.2.40", clientKey: "fresh-key" });
  // No second endpoint was tried; recovery stayed on the first socket.
  expect(fake.sockets.filter((s) => s.url.includes(":3001"))).toHaveLength(1);
  tv.disconnect();
});

test("a rejected keyless registration fails fast without looping or re-prompting", async () => {
  const { tv, fake, config } = setup(
    makeMemoryStore({ tvIp: "192.0.2.50", clientKey: "stale-key" }),
  );

  const connectPromise = tv.connect("192.0.2.50");
  const main = await waitFor(() => fake.forUrl("192.0.2.50"));

  main.open();
  const reg1 = (await waitFor(() =>
    main.sent.find((m) => m.type === "register"),
  )) as { id: string };
  main.receive({ id: reg1.id, type: "error", error: "AUTH_ERROR" });

  const reg2 = (await waitFor(() => {
    const regs = main.sent.filter((m) => m.type === "register");
    return regs.length >= 2 ? regs[1] : undefined;
  })) as { id: string };
  main.receive({ id: reg2.id, type: "error", error: "AUTH_ERROR" });

  await expect(connectPromise).rejects.toThrow(/AUTH_ERROR|Registration rejected/i);
  expect(tv.getStatus().status).toBe("disconnected");
  // Only one endpoint socket was ever opened.
  expect(fake.sockets).toHaveLength(1);
  // The original saved key is left on disk (not erased on a failed re-pair).
  expect(config.current()).toEqual({ tvIp: "192.0.2.50", clientKey: "stale-key" });
  tv.disconnect();
});
