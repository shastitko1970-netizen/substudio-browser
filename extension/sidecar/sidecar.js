const $ = (id) => document.getElementById(id);
const send = (type, payload = {}) => browser.runtime.sendMessage({ type, ...payload });

let thread = { id: crypto.randomUUID(), messages: [], previousResponseId: null, title: "" };
let tabs = [];

function renderMarkdown(text) {
  const escape = (value) =>
    value.replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch]));
  return escape(text || "")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function addBubble(role, text, cites = []) {
  const root = $("messages");
  const wrap = document.createElement("div");
  wrap.className = `msg ${role}`;
  wrap.innerHTML = `<div class="bubble">${renderMarkdown(text)}</div>`;
  for (const cite of cites) {
    const a = document.createElement("a");
    a.className = "cite";
    a.href = cite;
    a.textContent = cite;
    wrap.append(a);
  }
  root.append(wrap);
  root.scrollTop = root.scrollHeight;
  return wrap.querySelector(".bubble");
}

async function refreshSession() {
  const state = await send("getState");
  const session = state.session || {};
  $("dot").className = `dot ${session.source && session.source !== "none" ? "on" : "off"}`;
  const label = {
    substudio: "SubStudio",
    xai: "xAI",
    apikey: "API",
    none: "нет сессии",
  }[session.source] || session.source;
  $("source").textContent = label;
  if (session.source === "none") {
    $("hint").textContent = "Запусти SubStudio или войди в Grok в настройках.";
  } else {
    $("hint").textContent = session.user?.name || "";
  }
  const pending = state.pending || [];
  const box = $("permits");
  box.replaceChildren();
  for (const item of pending) {
    const row = document.createElement("div");
    row.className = "permit";
    row.innerHTML = `<span>Grok хочет: ${item.kind}</span>`;
    const allow = document.createElement("button");
    allow.className = "primary";
    allow.textContent = "Разрешить";
    allow.onclick = async () => {
      await send("resolvePermission", { id: item.id, allow: true });
      await refreshSession();
    };
    const deny = document.createElement("button");
    deny.textContent = "Отклонить";
    deny.onclick = async () => {
      await send("resolvePermission", { id: item.id, allow: false });
      await refreshSession();
    };
    row.append(allow, deny);
    box.append(row);
  }
  return state;
}

async function loadTabs() {
  const result = await send("listTabs");
  tabs = result.tabs || [];
}

function expandMentions(text) {
  return text.replace(/@(\d+)/g, (_, id) => {
    const tab = tabs.find((item) => String(item.id) === id);
    return tab ? `[${tab.title}](${tab.url})` : `@${id}`;
  }).replace(/@tab/gi, () => {
    const active = tabs.find((item) => item.active) || tabs[0];
    return active ? `[${active.title}](${active.url})` : "";
  });
}

async function ask(text) {
  const content = expandMentions(text);
  thread.messages.push({ role: "user", content });
  addBubble("user", content);
  $("input").value = "";
  const bubble = addBubble("assistant", "…");
  const result = await send("chat", {
    messages: thread.messages,
    previousResponseId: thread.previousResponseId,
  });
  if (result.error) {
    bubble.textContent = result.error === "no-session" ? "Нет сессии Grok. Открой настройки." : result.error;
    return;
  }
  bubble.innerHTML = renderMarkdown(result.text || "");
  if (result.citations) {
    for (const cite of result.citations) {
      const a = document.createElement("a");
      a.className = "cite";
      a.href = cite;
      a.textContent = cite;
      bubble.parentElement.append(a);
    }
  }
  if (result.responseId) {
    thread.previousResponseId = result.responseId;
  }
  if (result.text) {
    thread.messages.push({ role: "assistant", content: result.text });
  }
  if (result.confirmations?.length) {
    await refreshSession();
  }
  thread.title = thread.title || content.slice(0, 48);
  await send("saveThread", { thread });
}

$("send").onclick = () => {
  const text = $("input").value.trim();
  if (text) {
    ask(text);
  }
};
$("input").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    $("send").click();
  }
});
$("new").onclick = () => {
  thread = { id: crypto.randomUUID(), messages: [], previousResponseId: null, title: "" };
  $("messages").replaceChildren();
};
$("settings").onclick = () => browser.runtime.openOptionsPage();
$("summarize").onclick = async () => {
  await loadTabs();
  const active = tabs.find((item) => item.active);
  ask(`Суммаризируй активную вкладку @${active?.id || "tab"}: ${active?.title || ""} ${active?.url || ""}. Если нужен текст — вызови get_tab_text.`);
};
$("draft").onclick = async () => {
  await loadTabs();
  const active = tabs.find((item) => item.active);
  ask(`Напиши черновик на основе страницы @${active?.id || "tab"}. Запроси текст инструментом, если его нет.`);
};
$("compare").onclick = async () => {
  await loadTabs();
  const list = tabs.slice(0, 8).map((item) => `- ${item.id}: ${item.title} — ${item.url}`).join("\n");
  ask(`Сравни открытые вкладки и скажи, что общее и чем отличаются:\n${list}`);
};

refreshSession();
loadTabs();
setInterval(refreshSession, 8000);
