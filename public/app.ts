const ws = new WebSocket(`ws://${location.host}/control`);

const statusDot = document.getElementById("status-dot")!;
const statusText = document.getElementById("status-text")!;
const tvIpInput = document.getElementById("tv-ip") as HTMLInputElement;
const connectBtn = document.getElementById("connect-btn")!;
const discoverBtn = document.getElementById("discover-btn")!;
const discoveredList = document.getElementById("discovered-list")!;
const touchpad = document.getElementById("touchpad")!;
const textInput = document.getElementById("text-input") as HTMLInputElement;
const sendTextBtn = document.getElementById("send-text-btn")!;

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

function updateStatus(status: string) {
  statusDot.className = status;
  const labels: Record<string, string> = {
    disconnected: "Disconnected",
    connecting: "Connecting...",
    pairing: "Pairing - check TV screen",
    ready: "Ready",
  };
  statusText.textContent = labels[status] || status;
}

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);

  switch (msg.type) {
    case "status":
      updateStatus(msg.data.status);
      if (msg.data.tvIp) {
        tvIpInput.value = msg.data.tvIp;
      }
      break;
    case "discovered":
      renderDiscoveredTVs(msg.tvs);
      break;
    case "error":
      console.error("Server error:", msg.message);
      break;
  }
};

ws.onclose = () => updateStatus("disconnected");

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
      send({ type: "connect_tv", ip: tv.ip });
    };
    div.appendChild(btn);
    discoveredList.appendChild(div);
  }
  if (tvs.length === 0) {
    discoveredList.innerHTML = '<div class="discovered-tv"><span>No TVs found</span></div>';
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
  if (document.pointerLockElement === touchpad) {
    touchpad.style.borderColor = "#7c3aed";
  } else {
    touchpad.style.borderColor = "#334155";
  }
});

// Keyboard → remote keys (only when text input not focused)
document.addEventListener("keydown", (e: KeyboardEvent) => {
  if (document.activeElement === textInput) return;

  const lgKey = KEY_MAP[e.key];
  if (lgKey) {
    e.preventDefault();
    send({ type: "send_button", key: lgKey });
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
