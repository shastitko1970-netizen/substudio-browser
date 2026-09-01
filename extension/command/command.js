import { bootTheme } from "../lib/theme.js";

bootTheme();

const send = (type, payload = {}) => browser.runtime.sendMessage({ type, ...payload });
const q = document.getElementById("q");
const hits = document.getElementById("hits");
let items = [];
let index = 0;

async function render() {
  const query = q.value.trim();
  const tabs = (await send("listTabs")).tabs || [];
  const skills = [
    { kind: "skill", title: "Сжать вкладку", run: "summarize" },
    { kind: "skill", title: "Черновик со страницы", run: "draft" },
    { kind: "skill", title: "Сравнить вкладки", run: "compare" },
    { kind: "skill", title: "Настройки", run: "settings" },
  ];
  items = [
    ...skills.filter((item) => !query || item.title.toLowerCase().includes(query.toLowerCase())),
    ...tabs
      .filter((tab) => `${tab.title} ${tab.url}`.toLowerCase().includes(query.toLowerCase()))
      .map((tab) => ({ kind: "tab", title: tab.title, url: tab.url, id: tab.id })),
  ];
  if (query && !query.startsWith("/")) {
    items.unshift({ kind: "grok", title: `Grok: ${query}`, prompt: query });
  }
  index = 0;
  hits.replaceChildren();
  items.forEach((item, i) => {
    const row = document.createElement("div");
    row.className = `hit${i === 0 ? " active" : ""}`;
    row.innerHTML = `<b>${item.title}</b>${item.url ? `<span>${item.url}</span>` : ""}`;
    row.onmousedown = (event) => {
      event.preventDefault();
      choose(item);
    };
    hits.append(row);
  });
}

async function choose(item) {
  if (item.kind === "tab") {
    await browser.tabs.update(item.id, { active: true });
    window.close();
    return;
  }
  if (item.run === "settings") {
    await browser.runtime.openOptionsPage();
    window.close();
    return;
  }
  if (browser.sidebarAction?.open) {
    await browser.sidebarAction.open();
  }
  const prompt =
    item.prompt ||
    (item.run === "summarize" && "Суммаризируй активную вкладку.") ||
    (item.run === "draft" && "Черновик со страницы.") ||
    (item.run === "compare" && "Сравни открытые вкладки.") ||
    "";
  await browser.runtime.sendMessage({ type: "chat", messages: [{ role: "user", content: prompt }] });
  window.close();
}

q.addEventListener("input", render);
q.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown") {
    index = Math.min(items.length - 1, index + 1);
  } else if (event.key === "ArrowUp") {
    index = Math.max(0, index - 1);
  } else if (event.key === "Enter" && items[index]) {
    choose(items[index]);
    return;
  } else if (event.key === "Escape") {
    window.close();
    return;
  } else {
    return;
  }
  [...hits.children].forEach((node, i) => node.classList.toggle("active", i === index));
  event.preventDefault();
});

render();
