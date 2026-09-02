const PROBE_MS = 1500;

function originOf(url) {
  return String(url || "").trim().replace(/\/$/, "");
}

async function probeOrigin(origin, signal) {
  const urls = [`${origin}/v1/models`, `${origin}/v1/capabilities`];
  let last = "offline";
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: "no-store", signal });
      if (res.ok) {
        const body = await res.json().catch(() => ({}));
        return { ok: true, body };
      }
      last = String(res.status);
    } catch (error) {
      last = error.name === "AbortError" ? "timeout" : "offline";
    }
  }
  return { ok: false, error: last };
}

export async function probeHermes(settings = {}) {
  const apiPort = Number(settings.hermesPortApi) || 8642;
  const proxyPort = Number(settings.hermesPortProxy) || 8645;
  const candidates = [
    { kind: "api-server", origin: `http://127.0.0.1:${apiPort}` },
    { kind: "proxy", origin: `http://127.0.0.1:${proxyPort}` },
  ];
  const custom = originOf(settings.hermesBaseUrl);
  if (custom) {
    candidates.push({ kind: "custom", origin: custom });
  }

  for (const item of candidates) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_MS);
    try {
      const result = await probeOrigin(item.origin, controller.signal);
      if (result.ok) {
        return { ok: true, kind: item.kind, origin: item.origin, error: "" };
      }
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, kind: "none", origin: "", error: "offline" };
}

function toolsSpec() {
  return [
    {
      type: "function",
      function: {
        name: "list_tabs",
        description: "List open tabs: id, title, url, active, pinned.",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "get_tab_text",
        description: "Read visible text or selection from a tab. Requires user confirmation.",
        parameters: {
          type: "object",
          properties: { tabId: { type: "number" } },
          required: ["tabId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "switch_tab",
        description: "Activate a tab.",
        parameters: {
          type: "object",
          properties: { tabId: { type: "number" } },
          required: ["tabId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "open_tab",
        description: "Open a URL in a new tab. Cross-site opens need confirmation.",
        parameters: {
          type: "object",
          properties: { url: { type: "string" } },
          required: ["url"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "close_tabs",
        description: "Close tabs. Destructive — always confirmed in the UI.",
        parameters: {
          type: "object",
          properties: { tabIds: { type: "array", items: { type: "number" } } },
          required: ["tabIds"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "pin_tab",
        description: "Pin or unpin a tab.",
        parameters: {
          type: "object",
          properties: { tabId: { type: "number" }, pinned: { type: "boolean" } },
          required: ["tabId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "remember",
        description: "Store a short memory note.",
        parameters: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
        },
      },
    },
  ];
}

function bearer(settings) {
  const key = String(settings.hermesApiKey || "").trim();
  return key || "local";
}

function collectToolCalls(message) {
  const calls = [];
  for (const call of message.tool_calls || []) {
    calls.push({
      id: call.id,
      name: call.function?.name || call.name,
      arguments: call.function?.arguments || call.arguments || "{}",
    });
  }
  return calls;
}

export async function complete({ settings, messages, onDelta }) {
  const probe = await probeHermes(settings);
  if (!probe.ok) {
    throw new Error("hermes-offline");
  }
  const token = bearer(settings);
  const res = await fetch(`${probe.origin}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model: "hermes",
      stream: false,
      messages,
      tools: toolsSpec(),
    }),
  });
  if (res.status === 401) {
    throw new Error("нужен API_SERVER_KEY");
  }
  if (!res.ok) {
    throw new Error(`Hermes HTTP ${res.status}`);
  }
  const json = await res.json();
  const message = json.choices?.[0]?.message || {};
  const text = message.content || "";
  if (onDelta && text) {
    onDelta(text);
  }
  return { text, toolCalls: collectToolCalls(message), citations: [] };
}
