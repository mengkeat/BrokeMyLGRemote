export interface TVConfig {
  tvIp: string;
  clientKey: string;
}

export interface DiscoveredTV {
  name: string;
  ip: string;
  uuid: string;
}

export type TVConnectionStatus = "disconnected" | "connecting" | "pairing" | "ready";

/** How the TV wants the user to authenticate. `PROMPT` = approve on screen, `PIN` = enter a PIN. */
export type PairingType = "PROMPT" | "PIN";

export interface TVStatus {
  status: TVConnectionStatus;
  tvIp: string | null;
  currentApp: string | null;
  volume: number | null;
  muted: boolean | null;
}

export type ControlMessage =
  | { type: "mouse_move"; dx: number; dy: number }
  | { type: "mouse_click" }
  | { type: "send_button"; key: string }
  | { type: "send_text"; text: string }
  | { type: "discover" }
  | { type: "connect_tv"; ip: string }
  | { type: "submit_pairing_pin"; pin: string }
  | { type: "get_status" };

export type ServerMessage =
  | { type: "status"; data: TVStatus }
  | { type: "discovered"; tvs: DiscoveredTV[] }
  | { type: "error"; message: string }
  | { type: "pairing"; message: string };

export interface LGRequest {
  id: string;
  type: "register" | "request" | "subscribe";
  uri?: string;
  payload?: Record<string, unknown>;
}

export interface LGResponse {
  id: string;
  type: string;
  /** Present and `false` when a `request`/`subscribe`/`register` call is rejected. */
  returnValue?: boolean;
  /** TV-side error text (e.g. "AUTH_ERROR", "PIN code mismatch"). */
  error?: string;
  /** Human-readable error text returned by some endpoints. */
  errorText?: string;
  payload?: Record<string, unknown>;
}

/**
 * The signed portion of the manifest is an inseparable LG vendor fixture.
 *
 * `manifest.signed` and `manifest.signatures` are bound together: the signature
 * in `signatures` was computed by LG over a specific `signed` blob. Changing any
 * field inside `signed` (names, permissions, serial, etc.) invalidates that
 * signature, and webOS firmware that validates the signature will reject the
 * registration *before* pairing is offered. Do not edit fields inside `signed`
 * independently of `signatures` — restore both from the canonical fixture instead.
 */
export interface LGSignature {
  signatureVersion: number;
  signature: string;
}

export interface LGSignedManifest {
  created: string;
  appId: string;
  vendorId: string;
  localizedAppNames: Record<string, string>;
  localizedVendorNames: Record<string, string>;
  permissions: string[];
  serial: string;
}

export interface LGManifest {
  manifestVersion: number;
  appVersion: string;
  /** Vendor fixture — do not edit fields inside `signed` (see file header note). */
  signed: LGSignedManifest;
  /** Unsigned permission requests; extra entries are ignored by the TV. */
  permissions: string[];
  signatures: LGSignature[];
}

export interface LGRegistrationPayload {
  forcePairing: boolean;
  pairingType: PairingType;
  manifest: LGManifest;
  /** Optional saved client key; only present when reconnecting a known TV. */
  "client-key"?: string;
}

export const LG_HANDSHAKE_PAYLOAD: LGRegistrationPayload = {
  "forcePairing": false,
  "pairingType": "PROMPT",
  "manifest": {
    "manifestVersion": 1,
    "appVersion": "1.1",
    "signed": {
      "created": "20140509",
      "appId": "com.lge.test",
      "vendorId": "com.lge",
      "localizedAppNames": {
        "": "LG Remote App",
        "ko-KR": "리모컨 앱",
        "zxx-XX": "ЛГ Rэмotэ AПП"
      },
      "localizedVendorNames": {
        "": "LG Electronics"
      },
      "permissions": [
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
        "READ_TV_CURRENT_TIME"
      ],
      "serial": "2f930e2d2cfe083771f68e4fe7bb07"
    },
    "permissions": [
      "LAUNCH",
      "LAUNCH_WEBAPP",
      "APP_TO_APP",
      "CLOSE",
      "TEST_OPEN",
      "TEST_PROTECTED",
      "CONTROL_AUDIO",
      "CONTROL_DISPLAY",
      "CONTROL_INPUT_JOYSTICK",
      "CONTROL_INPUT_MEDIA_RECORDING",
      "CONTROL_INPUT_MEDIA_PLAYBACK",
      "CONTROL_INPUT_TV",
      "CONTROL_POWER",
      "READ_APP_STATUS",
      "READ_CURRENT_CHANNEL",
      "READ_INPUT_DEVICE_LIST",
      "READ_NETWORK_STATE",
      "READ_RUNNING_APPS",
      "READ_TV_CHANNEL_LIST",
      "WRITE_NOTIFICATION_TOAST",
      "READ_POWER_STATE",
      "READ_COUNTRY_INFO",
      "READ_SETTINGS",
      "CONTROL_TV_SCREEN",
      "CONTROL_TV_STANBY",
      "CONTROL_FAVORITE_GROUP",
      "CONTROL_USER_INFO",
      "CHECK_PAIRING_TV_STATE",
      "CONTROL_INPUT_TEXT",
      "CONTROL_MOUSE_AND_KEYBOARD",
      "READ_INSTALLED_APPS",
      "CONTROL_AUDIO_PLAYBACK",
      "CONTROL_AUDIO_MODE"
    ],
    "signatures": [
      {
        "signatureVersion": 1,
        "signature": "eyJhbGdvcml0aG0iOiJSU0EtU0hBMjU2Iiwia2V5SWQiOiJ0ZXN0LXNpZ25pbmctY2VydCIsInNpZ25hdHVyZVZlcnNpb24iOjF9.hrVRgjCwXVvE2OOSpDZ58hR+59aFNwYDyjQgKk3auukd7pcegmE2CzPCa0bJ0ZsRAcKkCTJrWo5iDzNhMBWRyaMOv5zWSrthlf7G128qvIlpMT0YNY+n/FaOHE73uLrS/g7swl3/qH/BGFG2Hu4RlL48eb3lLKqTt2xKHdCs6Cd4RMfJPYnzgvI4BNrFUKsjkcu+WD4OO2A27Pq1n50cMchmcaXadJhGrOqH5YmHdOCj5NSHzJYrsW0HPlpuAx/ECMeIZYDh6RMqaFM2DXzdKX9NmmyqzJ3o/0lkk/N97gfVRLW5hA29yeAwaCViZNCP8iC9aO0q9fQojoa7NQnAtw=="
      }
    ]
  }
};

/**
 * Build the registration payload for a TV connection.
 *
 * `clientKey` is omitted entirely for first-time pairing (which is what triggers
 * the on-screen prompt / PIN challenge) and included under the wire name
 * `client-key` only when reconnecting a previously paired TV. The vendor manifest
 * is deep-copied so callers can never mutate the shared fixture.
 */
export function buildRegistrationPayload(clientKey?: string): LGRegistrationPayload {
  const manifest = structuredClone(LG_HANDSHAKE_PAYLOAD.manifest);
  const payload: LGRegistrationPayload = {
    forcePairing: LG_HANDSHAKE_PAYLOAD.forcePairing,
    pairingType: LG_HANDSHAKE_PAYLOAD.pairingType,
    manifest,
  };
  if (clientKey) {
    payload["client-key"] = clientKey;
  }
  return payload;
}
