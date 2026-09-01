import { bootTheme } from "../lib/theme.js";

bootTheme();

const send = (type, payload = {}) => browser.runtime.sendMessage({ type, ...payload });
const $ = (id) => document.getElementById(id);

let snapshot = null;
let menuTab = null;
let lastSpaceId = null;
let railCompact = false;

function favicon(url, fallback) {
  if (fallback) return fallback;
  try {
    const host = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${host}&sz=32`;
  } catch {
    return "";
  }
}

function hideMenu() {
  $("menu").hidden = true;
  menuTab = null;
}

function showMenu(event, tab) {
  event.preventDefault();
  menuTab = tab;
  const menu = $("menu");
  menu.hidden = false;
  const x = Math.min(event.clientX, window.innerWidth - 180);
  const y = Math.min(event.clientY, window.innerHeight - 200);
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
}

function pinCell(pin) {
  const btn = document.createElement("button");
  btn.className = pin ? `pin${pin.active ? " active" : ""}` : "pin empty";
  btn.type = "button";
  if (!pin) {
    btn.title = "Pin current tab";
    btn.onclick = () => send("pinActiveTab").then(paint);
    return btn;
  }
  if (pin.favIconUrl || pin.url) {
    const img = document.createElement("img");
    img.alt = "";
    img.src = favicon(pin.url, pin.favIconUrl);
    img.onerror = () => {
      img.remove();
      btn.textContent = pin.initials || "";
    };
    btn.append(img);
  } else {
    btn.textContent = pin.initials || "";
  }
  btn.title = pin.title;
  btn.onclick = () => send("activateTab", { tabId: pin.id });
  btn.oncontextmenu = (event) => showMenu(event, pin);
  return btn;
}

function folderRow(folder) {
  const row = document.createElement("button");
  row.className = "row";
  row.type = "button";
  const ico = document.createElement("span");
  ico.className = "folder-ico";
  const label = document.createElement("span");
  label.textContent = folder.title;
  row.append(ico, label);
  row.onclick = () => send("toggleFolder", { folderId: folder.id }).then(paint);
  return row;
}

function tabRow(tab, nested) {
  const row = document.createElement("button");
  row.className = `row${tab.active ? " active" : ""}${nested ? " nested" : ""}`;
  row.type = "button";
  const img = document.createElement("img");
  img.alt = "";
  img.src = favicon(tab.url, tab.favIconUrl);
  const label = document.createElement("span");
  label.textContent = tab.title;
  const close = document.createElement("span");
  close.className = "close";
  close.textContent = "×";
  close.title = "Close";
  close.onclick = (event) => {
    event.stopPropagation();
    send("closeTab", { tabId: tab.id });
  };
  row.append(img, label, close);
  row.onclick = () => send("activateTab", { tabId: tab.id });
  row.oncontextmenu = (event) => showMenu(event, tab);
  row.addEventListener("auxclick", (event) => {
    if (event.button === 1) {
      event.preventDefault();
      send("closeTab", { tabId: tab.id });
    }
  });
  return row;
}

function paint(next) {
  if (next?.error || !next?.space) return;
  snapshot = next;
  const root = $("spacebar");
  root.style.setProperty("--from", snapshot.space.from);
  root.style.setProperty("--to", snapshot.space.to);
  root.style.setProperty("--folder", snapshot.space.folderColor);
  root.style.setProperty("--ink", snapshot.space.ink);
  root.style.setProperty("--muted", snapshot.space.muted);
  root.classList.toggle("light", !snapshot.space.dark);
  $("space-name").textContent = snapshot.space.name;
  $("space-color").value = snapshot.space.color || snapshot.space.from;
  if (lastSpaceId !== snapshot.space.id) {
    lastSpaceId = snapshot.space.id;
    const detail = { spaceId: snapshot.space.id };
    if (typeof snapshot.space.grokOpen === "boolean") {
      detail.open = snapshot.space.grokOpen;
    }
    window.dispatchEvent(new CustomEvent("ssb-grok-set", { bubbles: true, detail }));
  }
  document.querySelectorAll("[data-space]").forEach((node) => {
    node.classList.toggle("on", node.getAttribute("data-space") === snapshot.space.id);
  });

  const pins = $("pins");
  pins.replaceChildren();
  for (const pin of snapshot.pins) {
    pins.append(pinCell(pin));
  }

  const folders = $("folders");
  folders.replaceChildren();
  const loose = [];
  const grouped = new Map((snapshot.folders || []).map((folder) => [folder.id, []]));
  for (const tab of snapshot.tabs) {
    if (tab.folderId && grouped.has(tab.folderId)) {
      grouped.get(tab.folderId).push(tab);
    } else {
      loose.push(tab);
    }
  }
  for (const folder of snapshot.folders || []) {
    folders.append(folderRow(folder));
    if (folder.collapsed) continue;
    for (const tab of grouped.get(folder.id) || []) {
      folders.append(tabRow(tab, true));
    }
  }

  const tabs = $("tabs");
  tabs.replaceChildren();
  for (const tab of loose) {
    tabs.append(tabRow(tab, false));
  }
}

async function refresh() {
  const next = await send("spaceSnapshot");
  paint(next);
}

async function onMenu(act) {
  if (!menuTab) return hideMenu();
  switch (act) {
    case "pin":
      await send("pinTab", { tabId: menuTab.id, pinned: true });
      break;
    case "unpin":
      await send("pinTab", { tabId: menuTab.id, pinned: false });
      break;
    case "work":
      await send("moveTabSpace", { tabId: menuTab.id, spaceId: "work" });
      break;
    case "home":
      await send("moveTabSpace", { tabId: menuTab.id, spaceId: "home" });
      break;
    case "folder": {
      const first = snapshot?.folders?.[0];
      const title = first ? null : window.prompt("Folder name", "Folder");
      if (!first && !title) break;
      await send("assignFolder", {
        tabId: menuTab.id,
        folderId: first?.id,
        title,
      });
      break;
    }
    case "close":
      await send("closeTab", { tabId: menuTab.id });
      break;
    default: {
      const _never = act;
      void _never;
      break;
    }
  }
  hideMenu();
  await refresh();
}

$("space-work").onclick = () => send("switchSpace", { spaceId: "work" }).then(paint);
$("space-home").onclick = () => send("switchSpace", { spaceId: "home" }).then(paint);
$("space-color").oninput = () => {
  if (!snapshot?.space) return;
  send("updateSpaceColor", { spaceId: snapshot.space.id, color: $("space-color").value }).then(paint);
};
$("newtab").onclick = () => send("newSpaceTab");
$("library").onclick = () => send("openLibrary");
$("add").onclick = async (event) => {
  if (event.shiftKey) {
    const title = window.prompt("Folder name", "Folder");
    if (title) await send("createFolder", { title });
    await refresh();
    return;
  }
  await send("pinActiveTab").then(paint);
};
$("logo").onclick = () => send("switchSpace", { spaceId: "work" }).then(paint);
$("grok-toggle").onclick = () => send("toggleGrok");
$("collapse").onclick = () => {
  railCompact = !railCompact;
  $("spacebar").classList.toggle("compact", railCompact);
  window.dispatchEvent(
    new CustomEvent("ssb-rail-compact", { bubbles: true, detail: { compact: railCompact } }),
  );
  send("setRailCompact", { compact: railCompact });
};
document.addEventListener("click", (event) => {
  if (!$("menu").contains(event.target)) hideMenu();
});
$("menu").onclick = (event) => {
  const act = event.target?.getAttribute?.("data-act");
  if (act) onMenu(act);
};

refresh();
browser.tabs.onUpdated.addListener(refresh);
browser.tabs.onCreated.addListener(refresh);
browser.tabs.onRemoved.addListener(refresh);
browser.tabs.onActivated.addListener(refresh);
browser.tabs.onMoved?.addListener?.(refresh);
browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.ssbSpaces) refresh();
});
