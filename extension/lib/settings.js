export const PRODUCT_VERSION = "0.1.1";

export const DEFAULT_SETTINGS = {
  substudioHost: "127.0.0.1",
  substudioPort: 1234,
  proxyEnabled: true,
  proxies: [],
  grokModel: "grok-4-latest",
  uiTheme: "system",
};

export async function loadSettings() {
  const stored = await browser.storage.local.get(DEFAULT_SETTINGS);
  return {
    substudioHost: stored.substudioHost || DEFAULT_SETTINGS.substudioHost,
    substudioPort: Number(stored.substudioPort) || DEFAULT_SETTINGS.substudioPort,
    proxyEnabled: stored.proxyEnabled !== false,
    proxies: Array.isArray(stored.proxies) ? stored.proxies : [],
    grokModel: stored.grokModel || DEFAULT_SETTINGS.grokModel,
    uiTheme: stored.uiTheme || DEFAULT_SETTINGS.uiTheme,
  };
}

export function substudioOrigin(settings) {
  return `http://${settings.substudioHost}:${settings.substudioPort}`;
}
