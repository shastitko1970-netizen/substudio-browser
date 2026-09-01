(() => {
  const screens = ["welcome", "runtime", "installing", "done"];
  let mode = "esr";
  let installing = false;
  let finished = false;
  let native = typeof window.ssbGetState === "function";

  const $ = (id) => document.getElementById(id);

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
      installing = false;
      return;
    }
    if (payload.phase === "done") {
      finished = true;
      installing = false;
      $("install-phase").textContent = "Ready";
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

  $("btn-continue").addEventListener("click", () => show("runtime"));
  $("btn-back").addEventListener("click", () => show("welcome"));

  document.querySelectorAll(".card").forEach((card) => {
    card.addEventListener("click", () => {
      document.querySelectorAll(".card").forEach((item) => item.classList.remove("on"));
      card.classList.add("on");
      mode = card.getAttribute("data-mode") || "esr";
    });
  });

  $("btn-install").addEventListener("click", async () => {
    if (installing) return;
    installing = true;
    $("install-hint").classList.remove("err");
    $("install-phase").textContent = "Working";
    $("bar-fill").style.width = "8%";
    $("install-status").textContent =
      mode === "esr" ? "Fetching Firefox ESR..." : "Copying Firefox...";
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
  });

  $("btn-folder").addEventListener("click", () => {
    if (typeof window.ssbOpenFolder === "function") window.ssbOpenFolder();
  });
  $("btn-launch").addEventListener("click", () => {
    if (typeof window.ssbLaunch === "function") window.ssbLaunch();
  });
  $("btn-close").addEventListener("click", () => {
    if (typeof window.ssbClose === "function") {
      window.ssbClose(installing && !finished);
      return;
    }
    window.close();
  });
  $("btn-min").addEventListener("click", () => {
    if (typeof window.ssbMinimize === "function") window.ssbMinimize();
  });

  document.querySelector(".art").addEventListener("mousedown", () => {
    if (typeof window.ssbDrag === "function") window.ssbDrag();
  });

  if (native) {
    window.ssbGetState().then(applyState).catch(() => {});
  }
})();
