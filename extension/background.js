import { DEFAULT_SETTINGS, loadSettings, PRODUCT_VERSION } from "./lib/settings.js";
import { syncProxyListener, toFoxyProxyExport } from "./lib/proxy.js";
import {
  complete,
  sessionStatus,
  startDeviceLogin,
  pollDeviceLogin,
  saveApiKey,
  signOut,
  probeSubStudio,
} from "./lib/grok.js";
import { listThreads, saveThread, listNotes, saveNote, clearVault, exportVault } from "./lib/memory.js";
import { listTabs, runTool, resolvePending, getPending, tabSummary } from "./lib/tabs.js";
import { checkUpdate } from "./lib/update.js";

let settings = { ...DEFAULT_SETTINGS };

async function boot() {
  settings = await loadSettings();
  syncProxyListener(settings);
}

async function userId() {
  const session = await sessionStatus(settings);
  return session.user?.id || "anon";
}

const messageHandlers = {
  async getState() {
    settings = await loadSettings();
    let containers;
    try {
      containers = await browser.contextualIdentities.query({});
    } catch (error) {
      containers = { error: error.message };
    }
    return {
      settings,
      containers,
      version: PRODUCT_VERSION,
      session: await sessionStatus(settings),
      pending: getPending(),
    };
  },

  async saveSettings(message) {
    settings = await loadSettings();
    const next = {
      substudioHost: String(message.substudioHost || "127.0.0.1").trim(),
      substudioPort: Number(message.substudioPort) || 1234,
      proxyEnabled: Boolean(message.proxyEnabled),
      grokModel: message.grokModel || settings.grokModel,
      uiTheme: message.uiTheme || settings.uiTheme || "system",
    };
    settings = { ...settings, ...next, proxies: settings.proxies };
    await browser.storage.local.set(next);
    syncProxyListener(settings);
    return { settings };
  },

  async saveProxy(message) {
    const incoming = message.proxy || {};
    const record = {
      id: incoming.id || crypto.randomUUID(),
      name: String(incoming.name || "").trim() || "SOCKS5",
      host: String(incoming.host || "").trim(),
      port: Number(incoming.port) || 1080,
      username: String(incoming.username || ""),
      password: String(incoming.password || ""),
      cookieStoreId: incoming.cookieStoreId || "",
    };
    const index = settings.proxies.findIndex((item) => item.id === record.id);
    if (index >= 0) {
      settings.proxies[index] = record;
    } else {
      settings.proxies.push(record);
    }
    await browser.storage.local.set({ proxies: settings.proxies });
    syncProxyListener(settings);
    return { settings };
  },

  async deleteProxy(message) {
    settings.proxies = settings.proxies.filter((item) => item.id !== message.id);
    await browser.storage.local.set({ proxies: settings.proxies });
    syncProxyListener(settings);
    return { settings };
  },

  async ensureContainers() {
    const wanted = [
      { name: "X", color: "purple", icon: "fingerprint" },
      { name: "Grok", color: "orange", icon: "chill" },
      { name: "Work", color: "blue", icon: "briefcase" },
      { name: "Direct", color: "green", icon: "fence" },
    ];
    const existing = await browser.contextualIdentities.query({});
    const created = [];
    const skipped = [];
    for (const spec of wanted) {
      const match = existing.find((item) => item.name === spec.name);
      if (match) {
        skipped.push(match);
      } else {
        created.push(await browser.contextualIdentities.create(spec));
      }
    }
    return { created, skipped, all: await browser.contextualIdentities.query({}) };
  },

  async createContainer(message) {
    return {
      identity: await browser.contextualIdentities.create({
        name: String(message.name || "").trim(),
        color: message.color || "blue",
        icon: message.icon || "circle",
      }),
    };
  },

  async openInContainer(message) {
    return browser.tabs.create({ url: message.url, cookieStoreId: message.cookieStoreId });
  },

  async exportFoxyProxy() {
    return { config: toFoxyProxyExport(settings.proxies) };
  },

  async probeSubStudio() {
    return probeSubStudio(`http://${settings.substudioHost}:${settings.substudioPort}`);
  },

  async session() {
    return sessionStatus(settings);
  },

  async startLogin() {
    return startDeviceLogin();
  },

  async pollLogin(message) {
    return pollDeviceLogin(message.device);
  },

  async saveApiKey(message) {
    return saveApiKey(message.apiKey);
  },

  async signOut() {
    await signOut();
    return { ok: true };
  },

  async listTabs() {
    return { tabs: await listTabs() };
  },

  async chat(message) {
    const uid = await userId();
    const notes = await listNotes(uid);
    const memoryBlock = notes.length
      ? `\n\nUser memory (local, tied to Grok account):\n${notes.map((item) => `- ${item.text}`).join("\n")}`
      : "";
    const system = {
      role: "system",
      content:
        "You are Grok inside SubStudio Browser. Official xAI API only. See tabs via tools. Never request cookies or raw authenticated HTML. Destructive tab actions require a UI confirmation chip. Answer in the user's language (usually Russian)." +
        memoryBlock,
    };
    const result = await complete({
      settings,
      messages: [system, ...(message.messages || [])],
      previousResponseId: message.previousResponseId,
    });
    if (result.toolCalls?.length) {
      const confirmations = [];
      const toolResults = [];
      for (const call of result.toolCalls) {
        let args = {};
        try {
          args = typeof call.arguments === "string" ? JSON.parse(call.arguments || "{}") : call.arguments || {};
        } catch {
          args = {};
        }
        const output = await runTool(call.name, args, {
          remember: (text) => saveNote(uid, text),
        });
        if (output?.needsConfirmation) {
          confirmations.push(output.needsConfirmation);
        }
        toolResults.push({ call, output });
      }
      return { ...result, toolResults, confirmations };
    }
    return result;
  },

  async resolvePermission(message) {
    return resolvePending(message.id, Boolean(message.allow));
  },

  async threads() {
    return { threads: await listThreads(await userId()) };
  },

  async saveThread(message) {
    return saveThread(await userId(), message.thread);
  },

  async memoryNotes() {
    return { notes: await listNotes(await userId()) };
  },

  async saveNote(message) {
    return saveNote(await userId(), message.text);
  },

  async clearMemory() {
    await clearVault(await userId());
    return { ok: true };
  },

  async exportMemory() {
    return exportVault(await userId());
  },

  async checkUpdate() {
    return checkUpdate();
  },

  async activeTab() {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    return tab ? tabSummary(tab) : null;
  },
};

browser.runtime.onMessage.addListener((message) => {
  const handler = messageHandlers[message?.type];
  if (!handler) {
    return Promise.resolve({ error: `unknown message: ${message?.type}` });
  }
  return handler(message).catch((error) => ({ error: error.message || String(error) }));
});

browser.commands.onCommand.addListener(async (command) => {
  if (command === "command-bar") {
    await browser.windows.create({
      url: browser.runtime.getURL("command/command.html"),
      type: "popup",
      width: 640,
      height: 480,
    });
  }
  if (command === "toggle-sidecar" && browser.sidebarAction?.open) {
    await browser.sidebarAction.open();
  }
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.proxies || changes.proxyEnabled || changes.substudioHost || changes.substudioPort)) {
    boot();
  }
});

boot();
