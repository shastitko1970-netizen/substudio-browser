export const SPACES_KEY = "ssbSpaces";

export const PALETTE = {
  paper: "#F4EFE6",
  window: "#FFFDF8",
  ink: "#17140F",
  muted: "#6D6558",
  coral: "#E36B4A",
  plum: "#5B4B8A",
  darkPaper: "#1A1612",
  darkWindow: "#221C16",
  darkInk: "#F4EFE6",
  darkMuted: "#B5AA9A",
  darkCoral: "#F08A68",
};

export const DEFAULT_SPACES = {
  activeId: "work",
  spaces: [
    {
      id: "work",
      name: "Work",
      color: PALETTE.coral,
      from: PALETTE.coral,
      to: PALETTE.plum,
      folderColor: PALETTE.plum,
    },
    {
      id: "home",
      name: "Home",
      color: PALETTE.paper,
      from: PALETTE.paper,
      to: PALETTE.window,
      folderColor: PALETTE.ink,
    },
  ],
  folders: [
    { id: "basics", spaceId: "work", title: "Arc Basics", collapsed: false },
    { id: "baza", spaceId: "work", title: "Baza", collapsed: false },
    { id: "wuapi", spaceId: "work", title: "WuApi", collapsed: false },
  ],
};

export function migrateSpaces(data) {
  const next = structuredClone(data && Array.isArray(data.spaces) ? data : DEFAULT_SPACES);
  if (!Array.isArray(next.spaces) || next.spaces.length === 0) {
    return structuredClone(DEFAULT_SPACES);
  }
  const personal = next.spaces.find((item) => item.id === "personal");
  if (personal && !next.spaces.find((item) => item.id === "home")) {
    personal.id = "home";
    personal.name = "Home";
  }
  if (next.activeId === "personal") {
    next.activeId = "home";
  }
  if (!next.spaces.find((item) => item.id === "home")) {
    next.spaces.push(structuredClone(DEFAULT_SPACES.spaces[1]));
  }
  if (!next.spaces.find((item) => item.id === "work")) {
    next.spaces.unshift(structuredClone(DEFAULT_SPACES.spaces[0]));
  }
  next.folders = (next.folders || []).map((folder) => ({
    ...folder,
    spaceId: folder.spaceId === "personal" ? "home" : folder.spaceId,
    collapsed: Boolean(folder.collapsed),
  }));
  for (const space of next.spaces) {
    if (space.color) continue;
    const fallback = DEFAULT_SPACES.spaces.find((item) => item.id === space.id);
    if (fallback) {
      space.color = fallback.color;
      space.from = fallback.from;
      space.to = fallback.to;
      space.folderColor = fallback.folderColor;
    } else {
      applyPickedColor(space, space.from || PALETTE.coral);
    }
  }
  return next;
}

export async function loadSpaces() {
  const stored = await browser.storage.local.get({ [SPACES_KEY]: DEFAULT_SPACES });
  const migrated = migrateSpaces(stored[SPACES_KEY] || DEFAULT_SPACES);
  const raw = stored[SPACES_KEY] || {};
  if (raw.activeId === "personal" || (raw.spaces || []).some((item) => item.id === "personal")) {
    await saveSpaces(migrated);
  }
  return migrated;
}

export async function saveSpaces(data) {
  await browser.storage.local.set({ [SPACES_KEY]: data });
  return data;
}

export function spaceById(data, id) {
  return data.spaces.find((item) => item.id === id) || data.spaces[0];
}

export function parseHex(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!match) return null;
  return {
    r: parseInt(match[1].slice(0, 2), 16),
    g: parseInt(match[1].slice(2, 4), 16),
    b: parseInt(match[1].slice(4, 6), 16),
  };
}

export function hexColor(r, g, b) {
  const clamp = (value) => Math.max(0, Math.min(255, Math.round(value)));
  return `#${[r, g, b].map((value) => clamp(value).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

export function mixHex(left, right, amount) {
  const a = parseHex(left);
  const b = parseHex(right);
  if (!a || !b) return left;
  return hexColor(a.r + (b.r - a.r) * amount, a.g + (b.g - a.g) * amount, a.b + (b.b - a.b) * amount);
}

export function isDarkHex(hex) {
  const rgb = parseHex(hex);
  if (!rgb) return true;
  return (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255 < 0.55;
}

export function applyPickedColor(space, color) {
  const rgb = parseHex(color);
  if (!space || !rgb) return space;
  const normalized = hexColor(rgb.r, rgb.g, rgb.b);
  space.color = normalized;
  space.from = normalized;
  space.to = mixHex(normalized, isDarkHex(normalized) ? PALETTE.ink : PALETTE.plum, 0.42);
  space.folderColor = isDarkHex(normalized) ? PALETTE.darkCoral : PALETTE.plum;
  return space;
}

export function spaceInk(space) {
  return isDarkHex(space?.from) ? PALETTE.darkInk : PALETTE.ink;
}

export function tileLabel(title, url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const parts = host.split(".").filter(Boolean);
    const name = parts.length > 1 ? parts[parts.length - 2] : parts[0] || title;
    return String(name || "?").slice(0, 2).toUpperCase();
  } catch {
    return String(title || "?").slice(0, 2).toUpperCase();
  }
}

export async function applySpaceTheme(space) {
  if (!browser.theme?.update || !space) return;
  const ink = spaceInk(space);
  try {
    await browser.theme.update({
      colors: {
        frame: space.from,
        tab_background_text: ink,
        toolbar: PALETTE.window,
        toolbar_text: PALETTE.ink,
        ntp_background: PALETTE.paper,
        ntp_text: PALETTE.ink,
        sidebar: space.from,
        sidebar_text: ink,
        bookmark_text: PALETTE.ink,
      },
    });
  } catch {
    /* theme.write may be denied */
  }
}

export async function tabSpaceId(tabId) {
  if (!browser.sessions?.getTabValue) return null;
  try {
    const value = await browser.sessions.getTabValue(tabId, "ssbSpace");
    return value === "personal" ? "home" : value || null;
  } catch {
    return null;
  }
}

export async function setTabSpace(tabId, spaceId) {
  if (!browser.sessions?.setTabValue) return;
  await browser.sessions.setTabValue(tabId, "ssbSpace", spaceId === "personal" ? "home" : spaceId);
}

export async function tabFolderId(tabId) {
  if (!browser.sessions?.getTabValue) return null;
  try {
    return (await browser.sessions.getTabValue(tabId, "ssbFolder")) || null;
  } catch {
    return null;
  }
}

export async function setTabFolder(tabId, folderId) {
  if (!browser.sessions?.setTabValue) return;
  if (!folderId) {
    try {
      await browser.sessions.removeTabValue(tabId, "ssbFolder");
    } catch {
      await browser.sessions.setTabValue(tabId, "ssbFolder", "");
    }
    return;
  }
  await browser.sessions.setTabValue(tabId, "ssbFolder", folderId);
}

function isCompanionPage(url) {
  if (!url) return false;
  if (url.startsWith("about:addons")) return true;
  return url.includes("moz-extension://") && /\/(nav|sidecar|options|command|popup)\//.test(url);
}

export async function applySpaceVisibility(data) {
  if (!browser.tabs.hide || !browser.tabs.show) return;
  const tabs = await browser.tabs.query({ currentWindow: true });
  const keep = [];
  const hide = [];
  for (const tab of tabs) {
    let assigned = await tabSpaceId(tab.id);
    if (!assigned) {
      assigned = data.activeId;
      await setTabSpace(tab.id, assigned);
    }
    if (assigned === data.activeId) {
      keep.push(tab);
    } else {
      hide.push(tab);
    }
  }
  for (const tab of keep) {
    try {
      await browser.tabs.show(tab.id);
    } catch {
      /* already visible or pinned constraints */
    }
  }
  const activeKeep = keep.find((tab) => tab.active) || keep[0];
  if (activeKeep && hide.some((tab) => tab.active)) {
    try {
      await browser.tabs.update(activeKeep.id, { active: true });
    } catch {
      /* window focus */
    }
  }
  for (const tab of hide) {
    try {
      await browser.tabs.hide(tab.id);
    } catch {
      /* pinned tabs cannot hide; native strip is already userChrome-hidden */
    }
  }
}

function toRow(tab, assigned, folderId) {
  return {
    id: tab.id,
    title: tab.title || tab.url,
    url: tab.url,
    favIconUrl: tab.favIconUrl || "",
    pinned: Boolean(tab.pinned),
    active: Boolean(tab.active),
    groupId: tab.groupId,
    cookieStoreId: tab.cookieStoreId || "",
    spaceId: assigned,
    folderId,
    initials: tileLabel(tab.title || "", tab.url || ""),
  };
}

export async function listSpaceSnapshot(data) {
  const windowTabs = await browser.tabs.query({ currentWindow: true });
  const active = spaceById(data, data.activeId);
  const rows = [];
  for (const tab of windowTabs) {
    if (isCompanionPage(tab.url)) continue;
    let assigned = (await tabSpaceId(tab.id)) || data.activeId;
    if (assigned === "personal") assigned = "home";
    if (assigned !== active.id) continue;
    rows.push(toRow(tab, assigned, await tabFolderId(tab.id)));
  }
  const pins = rows.filter((item) => item.pinned).slice(0, 9);
  while (pins.length < 9) {
    pins.push(null);
  }
  let folders = (data.folders || []).filter((item) => item.spaceId === active.id);
  if (browser.tabGroups?.query) {
    try {
      const groups = await browser.tabGroups.query({});
      for (const group of groups) {
        if (folders.some((folder) => folder.groupId === group.id)) continue;
        folders = [
          ...folders,
          {
            id: `group-${group.id}`,
            spaceId: active.id,
            title: group.title || "Folder",
            groupId: group.id,
            collapsed: Boolean(group.collapsed),
          },
        ];
      }
    } catch {
      /* tabGroups is optional */
    }
  }
  return {
    space: {
      ...active,
      color: active.color || active.from,
      dark: isDarkHex(active.from),
      ink: spaceInk(active),
      muted: isDarkHex(active.from) ? PALETTE.darkMuted : PALETTE.muted,
    },
    spaces: data.spaces,
    pins,
    folders,
    tabs: rows.filter((item) => !item.pinned),
  };
}

export async function updateSpaceColor(data, spaceId, color) {
  const space = spaceById(data, spaceId);
  applyPickedColor(space, color);
  await saveSpaces(data);
  await applySpaceTheme(space);
  return listSpaceSnapshot(data);
}

export async function switchSpace(data, spaceId) {
  const id = spaceId === "personal" ? "home" : spaceId;
  data.activeId = id;
  await saveSpaces(data);
  await applySpaceTheme(spaceById(data, id));
  await applySpaceVisibility(data);
  return listSpaceSnapshot(data);
}

export async function newTabInSpace(data, url) {
  const tab = await browser.tabs.create(url ? { active: true, url } : { active: true });
  await setTabSpace(tab.id, data.activeId);
  return tab;
}

export async function pinTab(tabId, pinned) {
  await browser.tabs.update(tabId, { pinned });
}

export async function togglePin(tabId) {
  const tab = await browser.tabs.get(tabId);
  await pinTab(tabId, !tab.pinned);
}

export async function closeTab(tabId) {
  await browser.tabs.remove(tabId);
}

export async function createFolder(data, title) {
  const folder = {
    id: crypto.randomUUID(),
    spaceId: data.activeId,
    title: String(title || "").trim() || "Folder",
    collapsed: false,
  };
  data.folders = [...(data.folders || []), folder];
  await saveSpaces(data);
  return folder;
}

export async function toggleFolder(data, folderId) {
  data.folders = (data.folders || []).map((folder) =>
    folder.id === folderId ? { ...folder, collapsed: !folder.collapsed } : folder,
  );
  await saveSpaces(data);
  return listSpaceSnapshot(data);
}

export async function recentBookmarks() {
  if (!browser.bookmarks?.getRecent) return [];
  const items = await browser.bookmarks.getRecent(16);
  return items
    .filter((item) => item.url)
    .map((item) => ({ id: item.id, title: item.title || item.url, url: item.url }));
}

export async function openLibrary() {
  return browser.tabs.create({ url: "chrome://browser/content/places/places.xhtml" }).catch(() =>
    browser.tabs.create({ url: "about:home" }),
  );
}
