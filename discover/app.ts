const scanBtn = document.getElementById("scan-btn") as HTMLButtonElement;
const scanStatus = document.getElementById("scan-status")!;
const tvList = document.getElementById("tv-list")!;

const ws = new WebSocket(`ws://${location.host}/control`);

function send(msg: object) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);

  switch (msg.type) {
    case "discovered":
      renderTVs(msg.tvs);
      break;
    case "status":
      break;
    case "error":
      scanStatus.textContent = `Error: ${msg.message}`;
      scanBtn.disabled = false;
      break;
  }
};

function renderTVs(tvs: Array<{ name: string; ip: string; uuid: string }>) {
  scanBtn.disabled = false;
  scanStatus.textContent = `Found ${tvs.length} TV(s)`;

  tvList.innerHTML = "";
  for (const tv of tvs) {
    const card = document.createElement("div");
    card.className = "tv-card";
    card.innerHTML = `
      <div class="info">
        <div class="name">${tv.name}</div>
        <div class="ip">${tv.ip}</div>
        <div class="uuid">${tv.uuid}</div>
      </div>
    `;
    const btn = document.createElement("button");
    btn.textContent = "Connect";
    btn.onclick = () => {
      send({ type: "connect_tv", ip: tv.ip });
      window.location.href = "/";
    };
    card.appendChild(btn);
    tvList.appendChild(card);
  }

  if (tvs.length === 0) {
    tvList.innerHTML = '<div class="tv-card"><div class="info"><div class="name">No TVs found</div><div class="ip">Make sure your TV is on and connected to the same network</div></div></div>';
  }
}

scanBtn.onclick = () => {
  scanBtn.disabled = true;
  scanStatus.textContent = "Scanning... (this takes ~5 seconds)";
  tvList.innerHTML = "";
  send({ type: "discover" });
};
