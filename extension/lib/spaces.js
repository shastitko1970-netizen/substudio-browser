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
      id: "personal",
      name: "Personal",
      from: "#3a1848",
      to: "#5a2040",
      folderColor: "#e56b4e",
    },
  ],
  folders: [
    { id: "basics", spaceId: "work", title: "Arc Basics" },
    { id: "baza", spaceId: "work", title: "Baza" },
    { id: "wuapi", spaceId: "work", title: "WuApi" },
  ],
};

export async function loadSpaces() {
  const stored = await browser.storage.local.get({ [SPACES_KEY]: DEFAULT_SPACES });
  const data = stored[SPACES_KEY] || DEFAULT_SPACES;
  if (!Array.isArray(data.spaces) || data.spaces.length === 0) {
    return structuredClone(DEFAULT_SPACES);
  }
  return data;
}

export async function saveSpaces(data) {
  await browser.storage.local.set({ [SPACES_KEY]: data });
  return data;
}

export function spaceById(data, id) {
  return data.spaces.find((item) => item.id === id) || data.spaces[0];
}

export async function applySpaceTheme(space) {
  if (!browser.theme?.update || !space) return;
  try {
    await browser.theme.update({
      colors: {
        frame: space.from,
        tab_background_text: "#f4efe6",
        toolbar: "#fffcf9",
        toolbar_text: "#14110e",
        ntp_background: "#fffcf9",
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
    return (await browser.sessions.getTabValue(tabId, "ssbSpace")) || null;
  } catch {
    return null;
  }
}

export async function setTabSpace(tabId, spaceId) {
  if (!browser.sessions?.setTabValue) return;
  await browser.sessions.setTabValue(tabId, "ssbSpace", spaceId);
}

export async function applySpaceVisibility(data) {
  if (!browser.tabs.hide || !browser.tabs.show) return;
  const tabs = await browser.tabs.query({ currentWindow: true });
  for (const tab of tabs) {
    const assigned = (await tabSpaceId(tab.id)) || data.activeId;
    try {
      if (assigned === data.activeId) {
        await browser.tabs.show(tab.id);
      } else if (!tab.active) {
        await browser.tabs.hide(tab.id);
      }
    } catch {
      /* tabHide not granted */
    }
  }
}

export async function listSpaceSnapshot(data) {
  const windowTabs = await browser.tabs.query({ currentWindow: true });
  const active = spaceById(data, data.activeId);
  const rows = [];
  for (const tab of windowTabs) {
    if (!tab.url || tab.url.startsWith("about:addons")) continue;
    const assigned = (await tabSpaceId(tab.id)) || data.activeId;
    if (assigned !== active.id) continue;
    rows.push({
      id: tab.id,
      title: tab.title || tab.url,
      url: tab.url,
      favIconUrl: tab.favIconUrl || "",
      pinned: Boolean(tab.pinned),
      active: Boolean(tab.active),
      groupId: tab.groupId,
    });
  }
  const pins = rows.filter((item) => item.pinned).slice(0, 9);
  while (pins.length < 9) {
    pins.push(null);
  }
  const folders = (data.folders || []).filter((item) => item.spaceId === active.id);
  return {
    space: active,
    spaces: data.spaces,
    pins,
    folders,
    tabs: rows.filter((item) => !item.pinned),
  };
}

export async function switchSpace(data, spaceId) {
  data.activeId = spaceId;
  await saveSpaces(data);
  await applySpaceTheme(spaceById(data, spaceId));
  await applySpaceVisibility(data);
  return listSpaceSnapshot(data);
}

export async function newTabInSpace(data) {
  const tab = await browser.tabs.create({ active: true });
  await setTabSpace(tab.id, data.activeId);
  return tab;
}

export async function togglePin(tabId) {
  const tab = await browser.tabs.get(tabId);
  await browser.tabs.update(tabId, { pinned: !tab.pinned });
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
    browser.tabs.create({ url: "about:preferences" }),
  );
}
