import { bootTheme, loadThemeMode, setThemeMode } from "../lib/theme.js";

bootTheme();

const send = (type, payload = {}) => browser.runtime.sendMessage({ type, ...payload });
const $ = (id) => document.getElementById(id);

$("open-spaces").onclick = () => send("openSpaceBar");
$("open-grok").onclick = () => send("openGrok");

async function refresh() {
  const state = await send("getState");
  $("ver").textContent = state.version || "";
  $("host").value = state.settings.substudioHost;
  $("port").value = state.settings.substudioPort;
  $("proxy-enabled").checked = state.settings.proxyEnabled;
  $("hermes-url").value = state.settings.hermesBaseUrl || "";
  if (!$("hermes-key").value) {
    $("hermes-key").placeholder = state.settings.hermesApiKey ? "••••" : "";
  }
  const hermes = await send("probeHermes");
  $("hermes-status").textContent = hermes.ok
    ? `Найден ${hermes.kind} · ${hermes.origin}`
    : "Hermes не запущен. Открой Hermes Desktop или hermes gateway / hermes proxy.";
  const session = state.session || {};
  $("session").textContent =
    session.source === "none"
      ? "Нет сессии. Запусти SubStudio или войди в Grok."
      : `${session.source}: ${session.user?.name || session.user?.id || ""}`;

  const containers = Array.isArray(state.containers) ? state.containers : [];
  $("containers").textContent = containers.map((item) => item.name).join(" · ") || "нет";
  const select = $("proxy-container");
  select.replaceChildren(new Option("—", ""));
  for (const identity of containers) {
    select.append(new Option(identity.name, identity.cookieStoreId));
  }
  $("proxies").replaceChildren();
  for (const proxy of state.settings.proxies || []) {
    const row = document.createElement("div");
    row.className = "item";
    row.textContent = `${proxy.name} ${proxy.host}:${proxy.port}`;
    const del = document.createElement("button");
    del.textContent = "Удалить";
    del.onclick = async () => {
      await send("deleteProxy", { id: proxy.id });
      refresh();
    };
    row.append(del);
    $("proxies").append(row);
  }

  const notes = (await send("memoryNotes")).notes || [];
  $("notes").textContent = notes.map((item) => item.text).join(" · ") || "пусто";
  const theme = await loadThemeMode();
  document.querySelectorAll("[data-theme-mode]").forEach((node) => {
    node.classList.toggle("on", node.getAttribute("data-theme-mode") === theme);
  });
}

document.querySelectorAll("[data-theme-mode]").forEach((node) => {
  node.addEventListener("click", async () => {
    await setThemeMode(node.getAttribute("data-theme-mode"));
    refresh();
  });
});

$("save-settings").onclick = async () => {
  await send("saveSettings", {
    substudioHost: $("host").value,
    substudioPort: $("port").value,
    proxyEnabled: $("proxy-enabled").checked,
  });
  refresh();
};

$("save-hermes").onclick = async () => {
  const payload = { hermesBaseUrl: $("hermes-url").value };
  if ($("hermes-key").value) payload.hermesApiKey = $("hermes-key").value;
  await send("saveSettings", payload);
  $("hermes-key").value = "";
  refresh();
};

$("login").onclick = async () => {
  const device = await send("startLogin");
  if (device.error) {
    $("device").textContent = device.error;
    return;
  }
  $("device").textContent = `${device.user_code}\n${device.verification_uri}`;
  if (device.verification_uri_complete) {
    await browser.tabs.create({ url: device.verification_uri_complete });
  } else if (device.verification_uri) {
    await browser.tabs.create({ url: device.verification_uri });
  }
  const result = await send("pollLogin", { device });
  $("device").textContent = result.error || "Вход выполнен.";
  refresh();
};

$("logout").onclick = async () => {
  await send("signOut");
  refresh();
};

$("save-key").onclick = async () => {
  const result = await send("saveApiKey", { apiKey: $("apikey").value });
  $("apikey").value = "";
  $("session").textContent = result.error || "Ключ сохранён локально.";
  refresh();
};

$("ensure").onclick = async () => {
  await send("ensureContainers");
  refresh();
};

$("proxy-form").onsubmit = async (event) => {
  event.preventDefault();
  const data = new FormData(event.target);
  await send("saveProxy", {
    proxy: {
      id: data.get("id") || undefined,
      name: data.get("name"),
      host: data.get("host"),
      port: data.get("port"),
      username: data.get("username"),
      password: data.get("password"),
      cookieStoreId: data.get("cookieStoreId"),
    },
  });
  event.target.reset();
  refresh();
};

$("export-foxy").onclick = async () => {
  const result = await send("exportFoxyProxy");
  const blob = new Blob([JSON.stringify(result.config, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "foxyproxy-substudio.json";
  a.click();
  URL.revokeObjectURL(url);
};

$("export-mem").onclick = async () => {
  const vault = await send("exportMemory");
  const blob = new Blob([JSON.stringify(vault, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "substudio-memory.json";
  a.click();
  URL.revokeObjectURL(url);
};

$("clear-mem").onclick = async () => {
  await send("clearMemory");
  refresh();
};

$("check-upd").onclick = async () => {
  const result = await send("checkUpdate");
  if (result.error) {
    $("upd").textContent = result.error;
    return;
  }
  $("upd").textContent = result.newer
    ? `Доступно ${result.latest}. Лаунчер скачает релиз. ${result.htmlUrl}`
    : `Уже ${result.current}.`;
};

refresh();
