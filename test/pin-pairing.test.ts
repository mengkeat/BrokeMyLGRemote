import { test, expect } from "bun:test";
import { TVConnection } from "../src/tv-connection";
import { makeFakeFactory, makeMemoryStore, waitFor, registeredResponse } from "./helpers/fake-tv";

test("PIN pairing: TV requests a PIN, client submits it, registration completes", async () => {
  const fake = makeFakeFactory();
  const config = makeMemoryStore();
  const messages: string[] = [];
  const tv = new TVConnection({ socketFactory: fake.factory, savedTvsStore: config.store });
  tv.setMessageCallback((m) => messages.push(m));

  const connectPromise = tv.connect("192.0.2.60");
  const main = await waitFor(() => fake.sockets[0]);
  main.open();

  const reg = (await waitFor(() => main.sent.find((m) => m.type === "register"))) as { id: string };

  // TV signals PIN pairing is required.
  main.receive({ id: reg.id, type: "response", payload: { pairingType: "PIN" } });
  await waitFor(() => tv.getStatus().pairingType === "PIN");
  expect(tv.getStatus().status).toBe("pairing");
  expect(messages.some((m) => /enter the pin/i.test(m))).toBe(true);

  // Client submits the on-screen PIN.
  await tv.submitPairingPin("123456");
  const setPin = main.sent.find(
    (m) => m.type === "request" && String(m.uri).includes("pairing/setPin"),
  );
  expect(setPin).toBeTruthy();
  expect((setPin!.payload as { pin: string }).pin).toBe("123456");

  // TV accepts → registration completes with a client key.
  main.receive(registeredResponse(reg.id, "pin-client-key"));
  await connectPromise;

  expect(tv.getStatus().status).toBe("ready");
  expect(tv.getStatus().pairingType).toBeNull();
  expect(config.findByIp("192.0.2.60")).toEqual({ ip: "192.0.2.60", clientKey: "pin-client-key" });

  // The PIN must never surface in any notice.
  expect(messages.some((m) => m.includes("123456"))).toBe(false);

  tv.disconnect();
});

test("submitPairingPin rejects invalid input and the wrong pairing state", async () => {
  const fake = makeFakeFactory();
  const tv = new TVConnection({ socketFactory: fake.factory, savedTvsStore: makeMemoryStore().store });

  // Not pairing at all.
  await expect(tv.submitPairingPin("123456")).rejects.toThrow(/no pairing/i);

  const connectPromise = tv.connect("192.0.2.61");
  const main = await waitFor(() => fake.sockets[0]);
  main.open();
  await waitFor(() => main.sent.find((m) => m.type === "register"));

  // Default is PROMPT pairing → PIN not allowed.
  expect(tv.getStatus().pairingType).toBe("PROMPT");
  await expect(tv.submitPairingPin("123456")).rejects.toThrow(/did not request PIN/i);

  // Switch the TV to PIN mode.
  const reg = main.sent.find((m) => m.type === "register") as { id: string };
  main.receive({ id: reg.id, type: "response", payload: { pairingType: "PIN" } });
  await waitFor(() => tv.getStatus().pairingType === "PIN");

  // Malformed PINs are rejected locally; nothing is sent.
  const before = main.sent.length;
  await expect(tv.submitPairingPin("12a6")).rejects.toThrow(/4-8 digits/i);
  await expect(tv.submitPairingPin("12")).rejects.toThrow(/4-8 digits/i);
  await expect(tv.submitPairingPin("")).rejects.toThrow(/4-8 digits/i);
  expect(main.sent.length).toBe(before);

  // A valid PIN goes through once; a second submission is blocked.
  await tv.submitPairingPin("654321");
  await expect(tv.submitPairingPin("654321")).rejects.toThrow(/already been submitted/i);

  // Clean up the still-pending pairing.
  main.receive({ id: reg.id, type: "error", error: "CANCELLED" });
  await expect(connectPromise).rejects.toThrow(/CANCELLED|Registration rejected/i);
  tv.disconnect();
});
