(() => {
  const screens = ["welcome", "runtime", "installing", "done"];
  let mode = "esr";
  let installing = false;
  let finished = false;
  let native = typeof window.ssbGetState === "function";
  let windowsTheme = "";
  let themeMode =
    new URLSearchParams(location.search).get("theme") ||
    localStorage.getItem("ssb-theme") ||
    "system";

  const $ = (id) => document.getElementById(id);

  function systemDark() {
    if (windowsTheme === "dark") return true;
    if (windowsTheme === "light") return false;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  function effectiveDark() {
    switch (themeMode) {
      case "light":
        return false;
      case "dark":
        return true;
      case "system":
        return systemDark();
      default:
        return systemDark();
    }
  }

  function applyTheme() {
    document.documentElement.dataset.theme = effectiveDark() ? "dark" : "light";
    const btn = $("btn-theme");
    if (btn) {
      btn.title = effectiveDark() ? "Light theme" : "Dark theme";
    }
  }

  function toggleTheme() {
    themeMode = effectiveDark() ? "light" : "dark";
    localStorage.setItem("ssb-theme", themeMode);
    applyTheme();
  }

  applyTheme();
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (themeMode === "system") applyTheme();
  });

  function show(name) {
    screens.forEach((key) => {
      $("screen-" + key).classList.toggle("on", key === name);
    });
  }

  function applyState(state) {
    if (!state) return;
    if (state.version) {
      $("ver").textContent = state.version;
      $("done-copy").textContent =
        "SubStudio Browser " +
        state.version +
        " готов. Обновления прилетят с GitHub Releases, не из магазина Mozilla.";
    }
    if (state.destPath) {
      $("dest-path").textContent = state.destPath;
    }
    if (state.windowsTheme) {
      windowsTheme = state.windowsTheme;
      applyTheme();
    }
  }

  function showFailActions(on) {
    const actions = $("fail-actions");
    const phase = $("install-phase");
    if (actions) actions.hidden = !on;
    if (phase) phase.hidden = on;
  }

  function closeWindow() {
    if (typeof window.ssbClose === "function") {
      window.ssbClose(false);
      return;
    }
    window.close();
  }

  function onProgress(payload) {
    if (!payload) return;
    if (payload.percent != null) {
      $("bar-fill").style.width = Math.max(0, Math.min(100, payload.percent)) + "%";
      document.querySelector(".bar").setAttribute("aria-valuenow", String(payload.percent));
    }
    if (payload.detail || payload.status) {
      $("install-status").textContent = payload.status || payload.detail;
    }
    if (payload.phase === "error") {
      $("install-phase").textContent = "Failed";
      $("install-hint").textContent = payload.detail || "Install failed.";
      $("install-hint").classList.add("err");
      showFailActions(true);
      installing = false;
      return;
    }
    if (payload.phase === "done") {
      finished = true;
      installing = false;
      $("install-phase").textContent = "Ready";
      showFailActions(false);
      show("done");
    }
  }

  window.ssbOnProgress = onProgress;

  function demoInstall() {
    const steps = [
      { percent: 12, status: "Fetching Firefox ESR..." },
      { percent: 40, status: "Extracting ESR..." },
      { percent: 72, status: "Fetching Grok sidecar..." },
      { percent: 88, status: "Private profile..." },
      { percent: 100, status: "Ready", phase: "done" },
    ];
    let i = 0;
    const tick = () => {
      onProgress(steps[i]);
      i += 1;
      if (i < steps.length) setTimeout(tick, 420);
    };
    tick();
  }

  async function beginInstall() {
    if (installing) return;
    installing = true;
    finished = false;
    $("install-hint").classList.remove("err");
    $("install-phase").textContent = "Working";
    showFailActions(false);
    $("bar-fill").style.width = "8%";
    $("install-status").textContent =
      mode === "esr" ? "Fetching Firefox ESR..." : "Copying Firefox...";
    $("install-hint").textContent =
      "Это не системный браузер. Можно закрыть окно — докачаем в фоне.";
    show("installing");
    if (typeof window.ssbStartInstall === "function") {
      try {
        await window.ssbStartInstall(mode);
      } catch (err) {
        onProgress({ phase: "error", detail: String(err && err.message ? err.message : err) });
      }
      return;
    }
    demoInstall();
  }

  $("btn-continue").addEventListener("click", () => show("runtime"));
  $("btn-back").addEventListener("click", () => show("welcome"));

  document.querySelectorAll(".card").forEach((card) => {
    card.addEventListener("click", () => {
      document.querySelectorAll(".card").forEach((item) => item.classList.remove("on"));
      card.classList.add("on");
      mode = card.getAttribute("data-mode") || "esr";
    });
  });

  $("btn-install").addEventListener("click", () => {
    beginInstall();
  });
  $("btn-retry").addEventListener("click", () => {
    beginInstall();
  });
  $("btn-fail-close").addEventListener("click", closeWindow);
  $("btn-win-close").addEventListener("click", closeWindow);

  $("btn-folder").addEventListener("click", () => {
    if (typeof window.ssbOpenFolder === "function") window.ssbOpenFolder();
  });
  $("btn-launch").addEventListener("click", () => {
    if (typeof window.ssbLaunch === "function") window.ssbLaunch();
  });
  $("btn-min").addEventListener("click", () => {
    if (typeof window.ssbMinimize === "function") window.ssbMinimize();
  });

  $("btn-theme").addEventListener("click", toggleTheme);

  document.addEventListener("keydown", (event) => {
    if (event.altKey && event.key === "F4") {
      event.preventDefault();
      closeWindow();
    }
  });

  document.querySelector(".caption").addEventListener("mousedown", (event) => {
    if (event.target.closest("button")) return;
    if (typeof window.ssbDrag === "function") window.ssbDrag();
  });
  document.querySelector(".art").addEventListener("mousedown", () => {
    if (typeof window.ssbDrag === "function") window.ssbDrag();
  });

  if (native) {
    window.ssbGetState().then(applyState).catch(() => {});
  }
})();
