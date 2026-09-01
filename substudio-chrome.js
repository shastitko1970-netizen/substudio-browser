// SubStudio Browser — privileged chrome boot (AutoConfig, sandbox off).
// SPDX-License-Identifier: MPL-2.0
// Lives next to mozilla.cfg in the *copied* runtime only.
// Grok is a collapsible right panel (closed on first launch).
// The companion sidebar_action owns the LEFT Space bar. Never forks mozilla-central.

const SSB_ADDON_ID = "substudio-companion@substudio.browser";
const SSB_GROK_PATH = "sidecar/sidecar.html";
const SSB_BOX_ID = "substudio-grok-box";
const SSB_SPLIT_ID = "substudio-grok-splitter";
const SSB_BROWSER_ID = "substudio-grok-browser";
const SSB_BUTTON_ID = "substudio-grok-button";
const SSB_GROK_KEY = "ssbGrokOpen";
const SSB_RAIL_KEY = "ssbRailCompact";

function ssbIsBrowserWindow(win) {
  try {
    const href = String(win?.location?.href || "");
    return href.startsWith("chrome://browser/content/browser.");
  } catch {
    return false;
  }
}

function ssbPolicyUrl(win) {
  const Policy = win.WebExtensionPolicy || globalThis.WebExtensionPolicy;
  if (!Policy?.getByID) return "";
  const policy = Policy.getByID(SSB_ADDON_ID);
  if (!policy?.getURL) return "";
  try {
    return String(policy.getURL(SSB_GROK_PATH) || "");
  } catch {
    return "";
  }
}

function ssbCreate(win, tag) {
  if (typeof win.document.createXULElement === "function") {
    return win.document.createXULElement(tag);
  }
  return win.document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", tag);
}

let ssbServices = null;
let ssbSessionStore = null;

function ssbGetServices() {
  if (ssbServices) return ssbServices;
  ssbServices = ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs").Services;
  return ssbServices;
}

function ssbGetSessionStore() {
  if (ssbSessionStore !== null) return ssbSessionStore;
  try {
    ssbSessionStore = ChromeUtils.importESModule(
      "resource:///modules/sessionstore/SessionStore.sys.mjs",
    ).SessionStore;
  } catch {
    ssbSessionStore = undefined;
  }
  return ssbSessionStore;
}

function ssbWindowValue(win, key) {
  const store = ssbGetSessionStore();
  try {
    if (store?.getCustomWindowValue) {
      return store.getCustomWindowValue(win, key) || "";
    }
  } catch {
    /* session not ready */
  }
  return "";
}

function ssbSetWindowValue(win, key, value) {
  const store = ssbGetSessionStore();
  try {
    if (store?.setCustomWindowValue) {
      store.setCustomWindowValue(win, key, value);
    }
  } catch {
    /* session not ready */
  }
}

function ssbBridgeUri() {
  const Services = ssbGetServices();
  const file = Services.dirsvc.get("CurProcD", Components.interfaces.nsIFile);
  file.append("substudio-bridge.js");
  if (!file.exists()) return "";
  return Services.io.newFileURI(file).spec;
}

function ssbLoadSidecar(browserEl, url) {
  if (browserEl.getAttribute("src") === url) return;
  browserEl.setAttribute("src", url);
  try {
    if (typeof browserEl.fixupAndLoadURIString === "function") {
      browserEl.fixupAndLoadURIString(url, {
        triggeringPrincipal: ssbGetServices().scriptSecurityManager.getSystemPrincipal(),
      });
    }
  } catch {
    /* src attribute is enough on ESR 128 */
  }
}

function ssbDefaultGrokOpen() {
  return false;
}

function ssbReadGrokOpen(win) {
  const saved = ssbWindowValue(win, SSB_GROK_KEY);
  if (saved === "1") return true;
  if (saved === "0") return false;
  const spaceId = win.ssbActiveSpaceId;
  if (spaceId && win.ssbGrokBySpace && Object.prototype.hasOwnProperty.call(win.ssbGrokBySpace, spaceId)) {
    return Boolean(win.ssbGrokBySpace[spaceId]);
  }
  return ssbDefaultGrokOpen();
}

function ssbApplyGrok(win, open) {
  const doc = win.document;
  const box = doc.getElementById(SSB_BOX_ID);
  const splitter = doc.getElementById(SSB_SPLIT_ID);
  const grok = doc.getElementById(SSB_BROWSER_ID);
  const button = doc.getElementById(SSB_BUTTON_ID);
  if (!box) return;
  box.setAttribute("ssb-grok", open ? "open" : "closed");
  box.hidden = !open;
  if (splitter) {
    splitter.hidden = !open;
    splitter.setAttribute("ssb-grok", open ? "open" : "closed");
  }
  if (open && grok) {
    const url = ssbPolicyUrl(win);
    if (url) ssbLoadSidecar(grok, url);
  }
  if (button) {
    button.setAttribute("checked", open ? "true" : "false");
    button.setAttribute("ssb-grok", open ? "open" : "closed");
  }
  ssbSetWindowValue(win, SSB_GROK_KEY, open ? "1" : "0");
  const spaceId = win.ssbActiveSpaceId;
  if (spaceId) {
    win.ssbGrokBySpace = win.ssbGrokBySpace || {};
    win.ssbGrokBySpace[spaceId] = open;
  }
}

function ssbSetGrokOpen(win, open) {
  ssbApplyGrok(win, Boolean(open));
}

function ssbToggleGrok(win) {
  const box = win.document.getElementById(SSB_BOX_ID);
  const open = box?.getAttribute("ssb-grok") === "open";
  ssbSetGrokOpen(win, !open);
}

function ssbApplyRail(win, compact) {
  const box = win.document.getElementById("sidebar-box");
  if (!box) return;
  box.setAttribute("ssb-rail", compact ? "compact" : "wide");
  ssbSetWindowValue(win, SSB_RAIL_KEY, compact ? "1" : "0");
}

function ssbBindGrokApi(win) {
  win.gSubStudioGrok = {
    toggle: () => ssbToggleGrok(win),
    setOpen: (open) => ssbSetGrokOpen(win, open),
    isOpen: () => win.document.getElementById(SSB_BOX_ID)?.getAttribute("ssb-grok") === "open",
  };
  win.ssbSetGrokOpen = (open) => ssbSetGrokOpen(win, open);
}

function ssbAddToolbarButton(win) {
  const doc = win.document;
  if (doc.getElementById(SSB_BUTTON_ID)) return;
  const target =
    doc.getElementById("nav-bar-customization-target") ||
    doc.getElementById("nav-bar") ||
    doc.getElementById("urlbar-container")?.parentNode;
  if (!target) return;
  const btn = ssbCreate(win, "toolbarbutton");
  btn.id = SSB_BUTTON_ID;
  btn.setAttribute("class", "toolbarbutton-1 chromeclass-toolbar-additional substudio-grok-button");
  btn.setAttribute("label", "Grok");
  btn.setAttribute("tooltiptext", "Grok sidecar (Ctrl+\\)");
  btn.setAttribute("type", "checkbox");
  btn.setAttribute("checked", "false");
  btn.setAttribute("ssb-grok", "closed");
  btn.addEventListener("command", () => ssbToggleGrok(win));
  const urlbar = doc.getElementById("urlbar-container") || doc.getElementById("urlbar-wrapper");
  if (urlbar && urlbar.parentNode === target) {
    target.insertBefore(btn, urlbar.nextSibling);
  } else {
    target.appendChild(btn);
  }
}

function ssbBindKeys(win) {
  win.addEventListener(
    "keydown",
    (event) => {
      if (!event.ctrlKey || event.altKey || event.metaKey) return;
      const backslash = event.key === "\\" || event.code === "Backslash";
      const grokShift = event.shiftKey && (event.key === "G" || event.key === "g");
      if (!backslash && !grokShift) return;
      if (grokShift && !backslash) {
        /* Ctrl+Shift+G also handled by the companion command */
      }
      if (backslash && event.shiftKey) return;
      event.preventDefault();
      event.stopPropagation();
      ssbToggleGrok(win);
    },
    true,
  );
}

function ssbListenBridge(win, browserEl) {
  if (!browserEl || browserEl.ssbBridgeBound) return;
  const uri = ssbBridgeUri();
  if (!uri || !browserEl.messageManager) return;
  try {
    browserEl.messageManager.loadFrameScript(uri, true);
    browserEl.messageManager.addMessageListener("ssb-toggle-grok", () => {
      ssbToggleGrok(win);
    });
    browserEl.messageManager.addMessageListener("ssb-grok-set", (msg) => {
      const data = msg.data || {};
      if (data.spaceId) {
        win.ssbActiveSpaceId = String(data.spaceId);
        win.ssbGrokBySpace = win.ssbGrokBySpace || {};
        if (typeof data.open === "boolean") {
          win.ssbGrokBySpace[data.spaceId] = data.open;
        }
      }
      if (typeof data.open === "boolean") {
        ssbSetGrokOpen(win, data.open);
      }
    });
    browserEl.messageManager.addMessageListener("ssb-rail-compact", (msg) => {
      ssbApplyRail(win, Boolean(msg.data?.compact));
    });
    browserEl.ssbBridgeBound = true;
  } catch {
    /* frame scripts unavailable */
  }
}

function ssbAttachGrok(win) {
  const doc = win.document;
  if (!doc) return false;
  ssbBindGrokApi(win);
  ssbAddToolbarButton(win);
  ssbBindKeys(win);
  const sidebar = doc.getElementById("sidebar");
  if (sidebar) ssbListenBridge(win, sidebar);

  if (doc.getElementById(SSB_BOX_ID)) {
    ssbApplyGrok(win, ssbReadGrokOpen(win));
    return true;
  }
  const host = doc.getElementById("browser");
  if (!host) return false;
  if (!ssbPolicyUrl(win) && !doc.getElementById(SSB_BUTTON_ID)) return false;
  if (!ssbPolicyUrl(win)) return false;

  const splitter = ssbCreate(win, "splitter");
  splitter.id = SSB_SPLIT_ID;
  splitter.setAttribute("resizebefore", "flex");
  splitter.setAttribute("resizeafter", "sibling");
  splitter.setAttribute("class", "sidebar-splitter substudio-grok-splitter");

  const box = ssbCreate(win, "vbox");
  box.id = SSB_BOX_ID;
  box.setAttribute("class", "substudio-grok-box");
  box.setAttribute("width", "320");
  box.style.minWidth = "260px";
  box.style.maxWidth = "480px";

  const grok = ssbCreate(win, "browser");
  grok.id = SSB_BROWSER_ID;
  grok.setAttribute("type", "content");
  grok.setAttribute("flex", "1");
  grok.setAttribute("remote", "true");
  grok.setAttribute("maychangeremoteness", "true");
  grok.setAttribute("disableglobalhistory", "true");
  grok.setAttribute("context", "contentAreaContextMenu");
  grok.style.minHeight = "0";
  grok.style.flex = "1";

  box.appendChild(grok);
  host.appendChild(splitter);
  host.appendChild(box);
  ssbListenBridge(win, grok);
  const compact = ssbWindowValue(win, SSB_RAIL_KEY) === "1";
  ssbApplyRail(win, compact);
  ssbApplyGrok(win, ssbReadGrokOpen(win));
  return true;
}

function ssbTryAttach(win, attempt) {
  if (!ssbIsBrowserWindow(win) || win.closed) return;
  if (ssbAttachGrok(win)) return;
  if (attempt >= 40) return;
  win.setTimeout(() => {
    try {
      ssbTryAttach(win, attempt + 1);
    } catch {
      /* window gone */
    }
  }, 500);
}

function ssbWatch(win) {
  if (!ssbIsBrowserWindow(win)) return;
  const start = () => {
    try {
      ssbTryAttach(win, 0);
    } catch {
      /* attach is best-effort */
    }
  };
  if (win.document.readyState === "complete") {
    win.setTimeout(start, 200);
    return;
  }
  win.addEventListener(
    "load",
    () => {
      win.setTimeout(start, 200);
    },
    { once: true },
  );
}

function ssbBootChrome() {
  const Services = ssbGetServices();

  Services.obs.addObserver((win) => {
    ssbWatch(win);
  }, "browser-delayed-startup-finished");

  Services.ww.registerNotification({
    observe(subject, topic) {
      if (topic !== "domwindowopened") return;
      subject.addEventListener(
        "load",
        () => {
          ssbWatch(subject);
        },
        { once: true },
      );
    },
  });
}

try {
  ssbBootChrome();
} catch {
  /* sandbox still on, or older than ESR 128 — Space bar still works */
}
