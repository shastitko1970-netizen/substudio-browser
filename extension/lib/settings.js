export const PRODUCT_VERSION = "0.1.3";

export const DEFAULT_SETTINGS = {
  substudioHost: "127.0.0.1",
  substudioPort: 1234,
  proxyEnabled: true,
  proxies: [],
  grokModel: "grok-4-latest",
  uiTheme: "system",
  hermesBaseUrl: "",
  hermesApiKey: "",
  hermesPortApi: 8642,
  hermesPortProxy: 8645,
  assistant: "grok",
};

export async function loadSettings() {
  const stored = await browser.storage.local.get(DEFAULT_SETTINGS);
  const extra = await browser.storage.local.get({ ssb_assistant: stored.assistant || "grok" });
  const assistant = extra.ssb_assistant === "hermes" || stored.assistant === "hermes" ? "hermes" : "grok";
  return {
    substudioHost: stored.substudioHost || DEFAULT_SETTINGS.substudioHost,
    substudioPort: Number(stored.substudioPort) || DEFAULT_SETTINGS.substudioPort,
    proxyEnabled: stored.proxyEnabled !== false,
    proxies: Array.isArray(stored.proxies) ? stored.proxies : [],
    grokModel: stored.grokModel || DEFAULT_SETTINGS.grokModel,
    uiTheme: stored.uiTheme || DEFAULT_SETTINGS.uiTheme,
    hermesBaseUrl: stored.hermesBaseUrl || "",
    hermesApiKey: stored.hermesApiKey || "",
    hermesPortApi: Number(stored.hermesPortApi) || DEFAULT_SETTINGS.hermesPortApi,
    hermesPortProxy: Number(stored.hermesPortProxy) || DEFAULT_SETTINGS.hermesPortProxy,
    assistant,
  };
}

export function substudioOrigin(settings) {
  return `http://${settings.substudioHost}:${settings.substudioPort}`;
}
