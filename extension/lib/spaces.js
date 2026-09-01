export const SPACES_KEY = "ssbSpaces";

export const DEFAULT_SPACES = {
  activeId: "work",
  spaces: [
    {
      id: "work",
      name: "Work",
      from: "#1b1540",
      to: "#2a1a4a",
      folderColor: "#4f7cff",
    },
    {
      id: "home",
      name: "Home",
      from: "#3a1848",
      to: "#5a2040",
      folderColor: "#e56b4e",
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
  try {
    await browser.theme.update({
      colors: {
        frame: space.from,
        tab_background_text: "#f4efe6",
        toolbar: "#f4efe6",
        toolbar_text: "#14110e",
        ntp_background: "#f4efe6",
        ntp_text: "#14110e",
        sidebar: space.from,
        sidebar_text: "#f4efe6",
        bookmark_text: "#14110e",
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
    space: active,
    spaces: data.spaces,
    pins,
    folders,
    tabs: rows.filter((item) => !item.pinned),
  };
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
