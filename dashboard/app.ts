const ws = new WebSocket(`ws://${location.host}/control`);

const statusDot = document.getElementById("status-dot")!;
const statusText = document.getElementById("status-text")!;
const tvIpEl = document.getElementById("tv-ip")!;
const tvStatusEl = document.getElementById("tv-status")!;
const tvAppEl = document.getElementById("tv-app")!;
const tvVolumeEl = document.getElementById("tv-volume")!;
const tvList = document.getElementById("tv-list")!;
const refreshBtn = document.getElementById("refresh-btn")!;

function send(msg: object) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function updateStatus(data: any) {
  statusDot.className = data.status;
  const labels: Record<string, string> = {
    disconnected: "Disconnected",
    connecting: "Connecting...",
    pairing: "Pairing - check TV screen",
    ready: "Ready",
  };
  statusText.textContent = labels[data.status] || data.status;
  tvIpEl.textContent = data.tvIp || "--";
  tvStatusEl.textContent = data.status || "--";
  tvAppEl.textContent = data.currentApp || "--";

  if (data.volume !== null && data.volume !== undefined) {
    const muteLabel = data.muted ? " (muted)" : "";
    tvVolumeEl.textContent = `${data.volume}${muteLabel}`;
  } else {
    tvVolumeEl.textContent = "--";
  }
}

ws.onopen = () => {
  send({ type: "get_status" });
};

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);

  switch (msg.type) {
    case "status":
      updateStatus(msg.data);
      break;
    case "discovered":
      renderTVs(msg.tvs);
      break;
    case "error":
      console.error("Server error:", msg.message);
      break;
  }
};

ws.onclose = () => {
  statusDot.className = "disconnected";
  statusText.textContent = "Server disconnected";
};

function renderTVs(tvs: Array<{ name: string; ip: string }>) {
  tvList.innerHTML = "";
  for (const tv of tvs) {
    const div = document.createElement("div");
    div.className = "tv-list-item";
    div.innerHTML = `<span>${tv.name} (${tv.ip})</span>`;
    const btn = document.createElement("button");
    btn.textContent = "Connect";
    btn.onclick = () => send({ type: "connect_tv", ip: tv.ip });
    div.appendChild(btn);
    tvList.appendChild(div);
  }
  if (tvs.length === 0) {
    tvList.innerHTML = '<div class="tv-list-item"><span>No TVs found on network</span></div>';
  }
}

refreshBtn.onclick = () => {
  tvList.innerHTML = '<div class="tv-list-item"><span>Scanning...</span></div>';
  send({ type: "discover" });
};
