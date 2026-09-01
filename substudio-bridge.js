// SubStudio Browser — frame script (sidebar + Grok content → chrome).
// SPDX-License-Identifier: MPL-2.0
// Loaded into the companion sidebar / sidecar <browser>. Not a Gecko fork.

function ssbForward(name, detail) {
  try {
    sendAsyncMessage(name, detail || {});
  } catch {
    /* manager gone */
  }
}

addEventListener(
  "ssb-toggle-grok",
  () => {
    ssbForward("ssb-toggle-grok");
  },
  true,
);

addEventListener(
  "ssb-grok-set",
  (event) => {
    ssbForward("ssb-grok-set", event.detail || {});
  },
  true,
);

addEventListener(
  "ssb-rail-compact",
  (event) => {
    ssbForward("ssb-rail-compact", event.detail || {});
  },
  true,
);
