const pending = new Map();

export function tabSummary(tab) {
  return {
    id: tab.id,
    title: tab.title || "",
    url: tab.url || "",
    active: Boolean(tab.active),
    pinned: Boolean(tab.pinned),
    cookieStoreId: tab.cookieStoreId,
    discarded: Boolean(tab.discarded),
  };
}

export async function listTabs() {
  const tabs = await browser.tabs.query({ currentWindow: true });
  return tabs.filter((tab) => tab.url && !tab.url.startsWith("about:addons")).map(tabSummary);
}

export async function requestAction(kind, payload, execute) {
  const id = crypto.randomUUID();
  const entry = { id, kind, payload, execute };
  const promise = new Promise((resolve, reject) => {
    entry.resolve = resolve;
    entry.reject = reject;
  });
  pending.set(id, entry);
  return { pending: true, request: { id, kind, payload }, promise };
}

export function getPending() {
  return [...pending.values()].map((item) => ({ id: item.id, kind: item.kind, payload: item.payload }));
}

export async function resolvePending(id, allow) {
  const entry = pending.get(id);
  if (!entry) {
    throw new Error("unknown permission");
  }
  pending.delete(id);
  if (!allow) {
    entry.resolve({ denied: true });
    return { denied: true };
  }
  const result = await entry.execute();
  entry.resolve(result);
  return result;
}

export async function runTool(name, args, helpers) {
  switch (name) {
    case "list_tabs":
      return listTabs();
    case "get_tab_text": {
      const asked = await requestAction("read-text", { tabId: args.tabId }, () => readTabText(args.tabId));
      return asked.pending ? { needsConfirmation: asked.request } : asked;
    }
    case "switch_tab":
      await browser.tabs.update(args.tabId, { active: true });
      return { ok: true };
    case "open_tab": {
      const url = String(args.url || "");
      const current = (await browser.tabs.query({ active: true, currentWindow: true }))[0];
      const sameHost = safeSameHost(current?.url, url);
      if (!sameHost) {
        const asked = await requestAction("open-cross-site", { url }, () => browser.tabs.create({ url }));
        return asked.pending ? { needsConfirmation: asked.request } : asked;
      }
      return browser.tabs.create({ url });
    }
    case "close_tabs": {
      const tabIds = args.tabIds || [];
      const asked = await requestAction("close-tabs", { tabIds }, () => browser.tabs.remove(tabIds));
      return asked.pending ? { needsConfirmation: asked.request } : asked;
    }
    case "pin_tab":
      await browser.tabs.update(args.tabId, { pinned: args.pinned !== false });
      return { ok: true };
    case "group_tabs":
      if (!browser.tabGroups || !browser.tabs.group) {
        return { error: "tabGroups unsupported" };
      }
      {
        const groupId = await browser.tabs.group({ tabIds: args.tabIds });
        if (args.title) {
          await browser.tabGroups.update(groupId, { title: args.title });
        }
        return { groupId };
      }
    case "remember":
      return helpers.remember(args.text);
    default:
      return { error: `unknown tool ${name}` };
  }
}

function safeSameHost(a, b) {
  try {
    return new URL(a).host === new URL(b).host;
  } catch {
    return false;
  }
}

export async function readTabText(tabId) {
  const results = await browser.scripting.executeScript({
    target: { tabId },
    func: () => {
      const selection = window.getSelection()?.toString()?.trim();
      const text = selection || document.body?.innerText || "";
      return text.replace(/\s+/g, " ").trim().slice(0, 8000);
    },
  });
  return { text: results?.[0]?.result || "" };
}
