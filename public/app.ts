const ws = new WebSocket(`ws://${location.host}/control`);

const statusDot = document.getElementById("status-dot")!;
const statusText = document.getElementById("status-text")!;
const tvIpInput = document.getElementById("tv-ip") as HTMLInputElement;
const connectBtn = document.getElementById("connect-btn")!;
const discoverBtn = document.getElementById("discover-btn")!;
const discoveredList = document.getElementById("discovered-list")!;
const savedList = document.getElementById("saved-list")!;
const pairingNotice = document.getElementById("pairing-notice")!;
const pinPairing = document.getElementById("pin-pairing")!;
const pinInput = document.getElementById("pin-input") as HTMLInputElement;
const submitPinBtn = document.getElementById("submit-pin-btn")!;
const remote = document.getElementById("remote")!;
const touchpad = document.getElementById("touchpad")!;
const textInput = document.getElementById("text-input") as HTMLInputElement;
const sendTextBtn = document.getElementById("send-text-btn")!;

// Wire up every button that declares a remote key via data-key.
function sendButton(key: string) {
  send({ type: "send_button", key });
  flashKey(key);
}

// Briefly highlight the matching on-screen key (e.g. when triggered by keyboard).
function flashKey(key: string) {
  const el = remote.querySelector<HTMLElement>(`[data-key="${key}"]`);
  if (!el) return;
  el.classList.add("flash");
  setTimeout(() => el.classList.remove("flash"), 140);
}

remote.addEventListener("click", (e: MouseEvent) => {
  const target = (e.target as HTMLElement).closest<HTMLElement>("[data-key]");
  if (target && remote.contains(target)) {
    sendButton(target.dataset.key!);
  }
});

const KEY_MAP: Record<string, string> = {
  ArrowUp: "UP",
  ArrowDown: "DOWN",
  ArrowLeft: "LEFT",
  ArrowRight: "RIGHT",
  Enter: "ENTER",
  Backspace: "BACK",
  Escape: "EXIT",
};

function send(msg: object) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function updateStatus(data: { status: string; pairingType?: string | null }) {
  statusDot.className = data.status;
  const labels: Record<string, string> = {
    disconnected: "Disconnected",
    connecting: "Connecting...",
    pairing: "Pairing - check TV screen",
    ready: "Ready",
  };
  statusText.textContent = labels[data.status] || data.status;
  remote.classList.toggle("offline", data.status !== "ready");

  // Show the PIN entry only when the TV has requested PIN pairing.
  const pinNeeded = data.status === "pairing" && data.pairingType === "PIN";
  pinPairing.hidden = !pinNeeded;
  if (!pinNeeded) {
    pinInput.value = "";
    submitPinBtn.disabled = false;
  }

  // Clear the pairing notice once pairing is done.
  if (data.status !== "pairing") {
    pairingNotice.hidden = true;
  }
}

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);

  switch (msg.type) {
    case "status":
      updateStatus(msg.data);
      break;
    case "discovered":
      renderDiscoveredTVs(msg.tvs);
      break;
    case "saved_tvs":
      renderSavedTVs(msg.tvs);
      break;
    case "pairing":
      pairingNotice.textContent = msg.message;
      pairingNotice.hidden = !msg.message;
      break;
    case "error":
      console.error("Server error:", msg.message);
      break;
  }
};

ws.onclose = () => updateStatus({ status: "disconnected" });

function renderDiscoveredTVs(tvs: Array<{ name: string; ip: string }>) {
  discoveredList.innerHTML = "";
  for (const tv of tvs) {
    const div = document.createElement("div");
    div.className = "discovered-tv";
    div.innerHTML = `<span>${tv.name} (${tv.ip})</span>`;
    const btn = document.createElement("button");
    btn.textContent = "Connect";
    btn.onclick = () => {
      tvIpInput.value = tv.ip;
      send({ type: "connect_tv", ip: tv.ip, name: tv.name });
    };
    div.appendChild(btn);
    discoveredList.appendChild(div);
  }
  if (tvs.length === 0) {
    discoveredList.innerHTML = '<div class="discovered-tv"><span>No TVs found</span></div>';
  }
}

function renderSavedTVs(tvs: Array<{ ip: string; name: string }>) {
  savedList.innerHTML = "";
  if (tvs.length === 0) return; // nothing saved yet: hide the section entirely

  const heading = document.createElement("div");
  heading.className = "list-label";
  heading.textContent = "Saved TVs";
  savedList.appendChild(heading);

  for (const tv of tvs) {
    const div = document.createElement("div");
    div.className = "discovered-tv";
    div.innerHTML = `<span>${tv.name} (${tv.ip})</span>`;
    const btn = document.createElement("button");
    btn.textContent = "Connect";
    btn.onclick = () => {
      tvIpInput.value = tv.ip;
      send({ type: "connect_tv", ip: tv.ip, name: tv.name });
    };
    div.appendChild(btn);
    savedList.appendChild(div);
  }
}

connectBtn.onclick = () => {
  const ip = tvIpInput.value.trim();
  if (ip) send({ type: "connect_tv", ip });
};

discoverBtn.onclick = () => {
  discoveredList.innerHTML = '<div class="discovered-tv"><span>Scanning...</span></div>';
  send({ type: "discover" });
};

// Touchpad mouse tracking
touchpad.addEventListener("mousemove", (e: MouseEvent) => {
  if (e.buttons === 0 && !document.pointerLockElement) return;
  send({ type: "mouse_move", dx: e.movementX, dy: e.movementY });
});

touchpad.addEventListener("mousedown", (e: MouseEvent) => {
  if (e.button === 0) {
    touchpad.requestPointerLock();
  }
});

touchpad.addEventListener("mouseup", (e: MouseEvent) => {
  if (e.button === 0) {
    send({ type: "mouse_click" });
    document.exitPointerLock();
  }
});

document.addEventListener("pointerlockchange", () => {
  touchpad.classList.toggle("locked", document.pointerLockElement === touchpad);
});

// Keyboard → remote keys (only when text input not focused)
document.addEventListener("keydown", (e: KeyboardEvent) => {
  if (document.activeElement === textInput) return;

  const lgKey = KEY_MAP[e.key];
  if (lgKey) {
    e.preventDefault();
    sendButton(lgKey);
  }
});

// Send text
sendTextBtn.onclick = () => {
  const text = textInput.value;
  if (text) {
    send({ type: "send_text", text });
    textInput.value = "";
  }
};

textInput.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key === "Enter") {
    sendTextBtn.click();
  }
});

// PIN pairing submission
function submitPin() {
  const pin = pinInput.value.trim();
  if (!/^\d{4,8}$/.test(pin)) {
    pairingNotice.textContent = "PIN must be 4-8 digits.";
    pairingNotice.hidden = false;
    return;
  }
  submitPinBtn.disabled = true; // block duplicate submissions until state changes
  send({ type: "submit_pairing_pin", pin });
}

submitPinBtn.onclick = submitPin;
pinInput.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key === "Enter") submitPin();
});
