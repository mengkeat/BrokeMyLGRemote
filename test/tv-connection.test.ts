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
