const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

let settings = { proxyEnabled: true, proxies: [], substudioHost: "127.0.0.1" };

function isLocalUrl(urlString) {
  try {
    const url = new URL(urlString);
    return LOCAL_HOSTS.has(url.hostname) || url.hostname === settings.substudioHost;
  } catch {
    return false;
  }
}

async function resolveCookieStoreId(details) {
  if (details.cookieStoreId && details.cookieStoreId !== "firefox-default") {
    return details.cookieStoreId;
  }
  if (typeof details.tabId === "number" && details.tabId >= 0) {
    try {
      const tab = await browser.tabs.get(details.tabId);
      if (tab.cookieStoreId) {
        return tab.cookieStoreId;
      }
    } catch {
      /* closed */
    }
  }
  return details.cookieStoreId || "firefox-default";
}

async function onProxyRequest(details) {
  if (isLocalUrl(details.url)) {
    return { type: "direct" };
  }
  const cookieStoreId = await resolveCookieStoreId(details);
  const profile = (settings.proxies || []).find(
    (item) => item.cookieStoreId === cookieStoreId && item.host,
  );
  if (!profile) {
    return { type: "direct" };
  }
  const info = {
    type: "socks",
    host: profile.host,
    port: Number(profile.port) || 1080,
    proxyDNS: true,
    failoverTimeout: 5,
    connectionIsolationKey: cookieStoreId,
  };
  if (profile.username) {
    info.username = profile.username;
  }
  if (profile.password) {
    info.password = profile.password;
  }
  return [info, { type: "direct" }];
}

export function syncProxyListener(next) {
  settings = next;
  if (browser.proxy.onRequest.hasListener(onProxyRequest)) {
    browser.proxy.onRequest.removeListener(onProxyRequest);
  }
  const active = settings.proxyEnabled && (settings.proxies || []).some((item) => item.host && item.cookieStoreId);
  if (active) {
    browser.proxy.onRequest.addListener(onProxyRequest, { urls: ["<all_urls>"] });
  }
}

export function toFoxyProxyExport(proxies) {
  const container = {};
  const data = (proxies || []).map((item) => {
    if (item.cookieStoreId) {
      container[item.cookieStoreId] = item.id;
    }
    return {
      active: true,
      title: item.name || item.host,
      type: "socks5",
      hostname: item.host,
      port: String(item.port || 1080),
      username: item.username || "",
      password: item.password || "",
      cc: "",
      city: "",
      color: "#e8a87c",
      pac: "",
      pacString: "",
      proxyDNS: true,
      include: [],
      exclude: [],
      tabProxy: [],
    };
  });
  return {
    mode: "disable",
    sync: false,
    autoBackup: false,
    passthrough: "localhost, 127.0.0.1, [::1]",
    theme: "",
    container,
    commands: {},
    data,
  };
}
