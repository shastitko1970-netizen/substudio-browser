const send = (type) => browser.runtime.sendMessage({ type });
send("getState").then((state) => {
  document.getElementById("s").textContent = `${state.version} · ${state.session?.source || "нет сессии"}`;
});
document.getElementById("side").onclick = () => browser.sidebarAction?.open?.();
document.getElementById("cmd").onclick = () =>
  browser.windows.create({
    url: browser.runtime.getURL("command/command.html"),
    type: "popup",
    width: 640,
    height: 480,
  });
document.getElementById("opt").onclick = () => browser.runtime.openOptionsPage();
