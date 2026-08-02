import { test, expect } from "bun:test";
import { LG_HANDSHAKE_PAYLOAD, buildRegistrationPayload } from "../src/types";

// The signature baked into the vendor fixture. It was computed by LG over the
// canonical `signed` blob, so any drift in `signed` invalidates it. Pin it so a
// future edit cannot silently separate the signature from its signed content.
const KNOWN_SIGNATURE =
  "eyJhbGdvcml0aG0iOiJSU0EtU0hBMjU2Iiwia2V5SWQiOiJ0ZXN0LXNpZ25pbmctY2VydCIsInNpZ25hdHVyZVZlcnNpb24iOjF9.hrVRgjCwXVvE2OOSpDZ58hR+59aFNwYDyjQgKk3auukd7pcegmE2CzPCa0bJ0ZsRAcKkCTJrWo5iDzNhMBWRyaMOv5zWSrthlf7G128qvIlpMT0YNY+n/FaOHE73uLrS/g7swl3/qH/BGFG2Hu4RlL48eb3lLKqTt2xKHdCs6Cd4RMfJPYnzgvI4BNrFUKsjkcu+WD4OO2A27Pq1n50cMchmcaXadJhGrOqH5YmHdOCj5NSHzJYrsW0HPlpuAx/ECMeIZYDh6RMqaFM2DXzdKX9NmmyqzJ3o/0lkk/N97gfVRLW5hA29yeAwaCViZNCP8iC9aO0q9fQojoa7NQnAtw==";

// The exact 16-entry permission list the above signature covers. Must end at
// READ_TV_CURRENT_TIME; any locally-added permission breaks the signature.
const CANONICAL_SIGNED_PERMISSIONS = [
  "TEST_SECURE",
  "CONTROL_INPUT_TEXT",
  "CONTROL_MOUSE_AND_KEYBOARD",
  "READ_INSTALLED_APPS",
  "READ_LGE_SDX",
  "READ_NOTIFICATIONS",
  "SEARCH",
  "WRITE_SETTINGS",
  "WRITE_NOTIFICATION_ALERT",
  "CONTROL_POWER",
  "READ_CURRENT_CHANNEL",
  "READ_RUNNING_APPS",
  "READ_UPDATE_INFO",
  "UPDATE_FROM_REMOTE_APP",
  "READ_LGE_TV_INPUT_EVENTS",
  "READ_TV_CURRENT_TIME",
];

test("manifest.signed uses the canonical localized app names tied to the signature", () => {
  const names = LG_HANDSHAKE_PAYLOAD.manifest.signed.localizedAppNames;
  expect(names[""]).toBe("LG Remote App");
  expect(names["ko-KR"]).toBe("리모컨 앱");
  expect(names["zxx-XX"]).toBe("ЛГ Rэмotэ AПП");
});

test("manifest.signed.permissions is the canonical 16-entry list ending at READ_TV_CURRENT_TIME", () => {
  expect(LG_HANDSHAKE_PAYLOAD.manifest.signed.permissions).toEqual(
    CANONICAL_SIGNED_PERMISSIONS,
  );
});

test("the embedded signature and serial are pinned to the canonical vendor fixture", () => {
  const signed = LG_HANDSHAKE_PAYLOAD.manifest.signed;
  const signatures = LG_HANDSHAKE_PAYLOAD.manifest.signatures;
  expect(signed.appId).toBe("com.lge.test");
  expect(signed.vendorId).toBe("com.lge");
  expect(signed.serial).toBe("2f930e2d2cfe083771f68e4fe7bb07");
  expect(signatures).toHaveLength(1);
  expect(signatures[0].signature).toBe(KNOWN_SIGNATURE);
});

test("buildRegistrationPayload omits client-key for first-time pairing", () => {
  const payload = buildRegistrationPayload();
  expect(payload["client-key"]).toBeUndefined();
  expect(payload.forcePairing).toBe(false);
  expect(payload.pairingType).toBe("PROMPT");
  expect(payload.manifest).toEqual(LG_HANDSHAKE_PAYLOAD.manifest);
});

test("buildRegistrationPayload includes a saved key under the wire name 'client-key'", () => {
  const payload = buildRegistrationPayload("abcdef-1234");
  expect(payload["client-key"]).toBe("abcdef-1234");
  expect(payload.pairingType).toBe("PROMPT");
});

test("a client key never leaks into the shared vendor fixture", () => {
  buildRegistrationPayload("super-secret-key");
  const again = buildRegistrationPayload();
  expect(again["client-key"]).toBeUndefined();
});
