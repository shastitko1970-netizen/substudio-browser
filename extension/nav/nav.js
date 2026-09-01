import { bootTheme } from "../lib/theme.js";

bootTheme();

const send = (type, payload = {}) => browser.runtime.sendMessage({ type, ...payload });
const $ = (id) => document.getElementById(id);

function favicon(url, fallback) {
  if (fallback) return fallback;
  try {
    const host = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${host}&sz=32`;
  } catch {
    return "";
  }
}

function paint(snapshot) {
  if (!snapshot?.space) return;
  const root = $("spacebar");
  root.style.setProperty("--from", snapshot.space.from);
  root.style.setProperty("--to", snapshot.space.to);
  root.style.setProperty("--folder", snapshot.space.folderColor);
  $("space-name").textContent = snapshot.space.name;
  document.querySelectorAll("[data-space]").forEach((node) => {
    node.classList.toggle("on", node.getAttribute("data-space") === snapshot.space.id);
  });

  const pins = $("pins");
  pins.replaceChildren();
  for (const pin of snapshot.pins) {
    const btn = document.createElement("button");
    btn.className = pin ? "pin" : "pin empty";
    btn.type = "button";
    if (pin) {
      const img = document.createElement("img");
      img.alt = "";
      img.src = favicon(pin.url, pin.favIconUrl);
      btn.append(img);
      btn.title = pin.title;
      btn.onclick = () => send("activateTab", { tabId: pin.id });
    }
    pins.append(btn);
  }

  const folders = $("folders");
  folders.replaceChildren();
  for (const folder of snapshot.folders) {
    const row = document.createElement("button");
    row.className = "row";
    row.type = "button";
    row.innerHTML = `<span class="folder-ico"></span><span>${folder.title}</span>`;
    row.onclick = () => send("focusFolder", { folderId: folder.id });
    folders.append(row);
  }

  const tabs = $("tabs");
  tabs.replaceChildren();
  for (const tab of snapshot.tabs) {
    const row = document.createElement("button");
    row.className = `row${tab.active ? " active" : ""}`;
    row.type = "button";
    const img = document.createElement("img");
    img.alt = "";
    img.src = favicon(tab.url, tab.favIconUrl);
    const label = document.createElement("span");
    label.textContent = tab.title;
    row.append(img, label);
    row.onclick = () => send("activateTab", { tabId: tab.id });
    tabs.append(row);
  }
}

async function refresh() {
  const snapshot = await send("spaceSnapshot");
  if (snapshot.error) return;
  paint(snapshot);
}

$("space-work").onclick = () => send("switchSpace", { spaceId: "work" }).then(paint);
$("space-personal").onclick = () => send("switchSpace", { spaceId: "personal" }).then(paint);
$("newtab").onclick = () => send("newSpaceTab");
$("library").onclick = () => send("openLibrary");
$("add").onclick = () => send("pinActiveTab");
$("logo").onclick = () => send("switchSpace", { spaceId: "work" }).then(paint);

refresh();
browser.tabs.onUpdated.addListener(refresh);
browser.tabs.onCreated.addListener(refresh);
browser.tabs.onRemoved.addListener(refresh);
browser.tabs.onActivated.addListener(refresh);
browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.ssbSpaces) refresh();
});
