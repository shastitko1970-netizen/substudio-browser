// SubStudio Browser — privileged chrome boot (AutoConfig, sandbox off).
// SPDX-License-Identifier: MPL-2.0
// Lives next to mozilla.cfg in the *copied* runtime only.
// Docks official Grok sidecar on the RIGHT. The companion sidebar_action
// owns the LEFT Space bar. Never forks mozilla-central.

const SSB_ADDON_ID = "substudio-companion@substudio.browser";
const SSB_GROK_PATH = "sidecar/sidecar.html";
const SSB_BOX_ID = "substudio-grok-box";
const SSB_SPLIT_ID = "substudio-grok-splitter";
const SSB_BROWSER_ID = "substudio-grok-browser";

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

function ssbGetServices() {
  if (ssbServices) return ssbServices;
  ssbServices = ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs").Services;
  return ssbServices;
}

function ssbLoadSidecar(browserEl, url) {
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

function ssbAttachGrok(win) {
  const doc = win.document;
  if (!doc || doc.getElementById(SSB_BOX_ID)) return true;
  const host = doc.getElementById("browser");
  if (!host) return false;
  const url = ssbPolicyUrl(win);
  if (!url) return false;

  const splitter = ssbCreate(win, "splitter");
  splitter.id = SSB_SPLIT_ID;
  splitter.setAttribute("resizebefore", "flex");
  splitter.setAttribute("resizeafter", "sibling");
  splitter.setAttribute("class", "sidebar-splitter substudio-grok-splitter");

  const box = ssbCreate(win, "vbox");
  box.id = SSB_BOX_ID;
  box.setAttribute("class", "substudio-grok-box");
  box.setAttribute("width", "320");
  box.setAttribute("persist", "width");
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
  ssbLoadSidecar(grok, url);
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
