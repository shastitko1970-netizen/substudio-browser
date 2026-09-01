/**
 * Official xAI only:
 * 1) SubStudio OpenAI-compatible gateway (already holds xAI OAuth)
 * 2) auth.x.ai device-code (OIDC, public Grok-CLI client, no cookie scrape)
 * 3) Official API key from console.x.ai
 */
export const XAI_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
export const XAI_DEVICE = "https://auth.x.ai/oauth2/device/code";
export const XAI_TOKEN = "https://auth.x.ai/oauth2/token";
export const XAI_USERINFO = "https://auth.x.ai/oauth2/userinfo";
export const XAI_API = "https://api.x.ai/v1";
export const XAI_SCOPE =
  "openid profile email offline_access grok-cli:access api:access conversations:read conversations:write";

const AUTH_KEY = "ssb_xai_auth";

export async function getAuth() {
  const stored = await browser.storage.local.get({ [AUTH_KEY]: null });
  return stored[AUTH_KEY];
}

async function setAuth(auth) {
  if (auth) {
    await browser.storage.local.set({ [AUTH_KEY]: auth });
  } else {
    await browser.storage.local.remove(AUTH_KEY);
  }
  return auth;
}

export async function probeSubStudio(origin) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1800);
  try {
    const res = await fetch(`${origin}/v1/models`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(String(res.status));
    }
    const body = await res.json().catch(() => ({}));
    return { ok: true, origin, models: body.data || [] };
  } catch (error) {
    return { ok: false, origin, error: error.name === "AbortError" ? "timeout" : "offline" };
  } finally {
    clearTimeout(timer);
  }
}

export async function sessionStatus(settings) {
  const origin = `http://${settings.substudioHost}:${settings.substudioPort}`;
  const studio = await probeSubStudio(origin);
  if (studio.ok) {
    return { source: "substudio", origin, user: { id: "substudio", name: "SubStudio" } };
  }
  const auth = await getAuth();
  if (auth?.access_token) {
    if (auth.expires_at && Date.now() > auth.expires_at - 30_000) {
      try {
        await refreshAuth(auth);
      } catch {
        /* keep stale token; next call may fail */
      }
    }
    const current = (await getAuth()) || auth;
    return {
      source: current.api_key ? "apikey" : "xai",
      user: current.user || { id: "xai", name: "Grok" },
    };
  }
  return { source: "none" };
}

export async function startDeviceLogin() {
  const body = new URLSearchParams({
    client_id: XAI_CLIENT_ID,
    scope: XAI_SCOPE,
  });
  const res = await fetch(XAI_DEVICE, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`device code HTTP ${res.status}`);
  }
  return res.json();
}

export async function pollDeviceLogin(device) {
  const started = Date.now();
  const expires = (device.expires_in || 600) * 1000;
  let interval = Math.max(3, device.interval || 5) * 1000;
  while (Date.now() - started < expires) {
    await new Promise((resolve) => setTimeout(resolve, interval));
    const res = await fetch(XAI_TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_id: XAI_CLIENT_ID,
        device_code: device.device_code,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok && json.access_token) {
      const user = await fetchUser(json.access_token);
      return setAuth({
        access_token: json.access_token,
        refresh_token: json.refresh_token,
        expires_at: Date.now() + (json.expires_in || 3600) * 1000,
        user,
      });
    }
    if (json.error === "slow_down") {
      interval += 5000;
      continue;
    }
    if (json.error && json.error !== "authorization_pending") {
      throw new Error(json.error);
    }
  }
  throw new Error("device code expired");
}

async function refreshAuth(auth) {
  if (!auth.refresh_token) {
    return auth;
  }
  const res = await fetch(XAI_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: XAI_CLIENT_ID,
      refresh_token: auth.refresh_token,
    }),
  });
  if (!res.ok) {
    throw new Error("refresh failed");
  }
  const json = await res.json();
  return setAuth({
    ...auth,
    access_token: json.access_token,
    refresh_token: json.refresh_token || auth.refresh_token,
    expires_at: Date.now() + (json.expires_in || 3600) * 1000,
  });
}

async function fetchUser(token) {
  try {
    const res = await fetch(XAI_USERINFO, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      return { id: "xai", name: "Grok" };
    }
    const user = await res.json();
    return { id: user.sub || user.email || "xai", name: user.name || user.email || "Grok", email: user.email };
  } catch {
    return { id: "xai", name: "Grok" };
  }
}

export async function saveApiKey(apiKey) {
  const key = String(apiKey || "").trim();
  if (!key) {
    throw new Error("empty key");
  }
  return setAuth({
    api_key: key,
    access_token: key,
    user: { id: "apikey", name: "console.x.ai" },
  });
}

export async function signOut() {
  await setAuth(null);
}

function toolsSpec() {
  return [
    {
      type: "function",
      name: "list_tabs",
      description: "List open tabs: id, title, url, active, pinned.",
      parameters: { type: "object", properties: {} },
    },
    {
      type: "function",
      name: "get_tab_text",
      description: "Read visible text or selection from a tab. Requires user confirmation.",
      parameters: {
        type: "object",
        properties: { tabId: { type: "number" } },
        required: ["tabId"],
      },
    },
    {
      type: "function",
      name: "switch_tab",
      description: "Activate a tab.",
      parameters: {
        type: "object",
        properties: { tabId: { type: "number" } },
        required: ["tabId"],
      },
    },
    {
      type: "function",
      name: "open_tab",
      description: "Open a URL in a new tab. Cross-site opens need confirmation.",
      parameters: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"],
      },
    },
    {
      type: "function",
      name: "close_tabs",
      description: "Close tabs. Destructive — always confirmed in the UI.",
      parameters: {
        type: "object",
        properties: { tabIds: { type: "array", items: { type: "number" } } },
        required: ["tabIds"],
      },
    },
    {
      type: "function",
      name: "pin_tab",
      description: "Pin or unpin a tab.",
      parameters: {
        type: "object",
        properties: { tabId: { type: "number" }, pinned: { type: "boolean" } },
        required: ["tabId"],
      },
    },
    {
      type: "function",
      name: "group_tabs",
      description: "Group tabs together if the browser supports tabGroups.",
      parameters: {
        type: "object",
        properties: {
          tabIds: { type: "array", items: { type: "number" } },
          title: { type: "string" },
        },
        required: ["tabIds"],
      },
    },
    {
      type: "function",
      name: "remember",
      description: "Store a short memory note tied to the signed-in Grok user.",
      parameters: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
      },
    },
  ];
}

export async function complete({ settings, messages, previousResponseId, onDelta }) {
  const status = await sessionStatus(settings);
  if (status.source === "none") {
    throw new Error("no-session");
  }
  if (status.source === "substudio") {
    return completeChatCompletions({
      base: status.origin,
      token: null,
      settings,
      messages,
      onDelta,
    });
  }
  const auth = await getAuth();
  return completeResponses({
    token: auth.access_token,
    settings,
    messages,
    previousResponseId,
    onDelta,
  });
}

async function completeChatCompletions({ base, token, settings, messages, onDelta }) {
  const headers = { "Content-Type": "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: settings.grokModel || "grok-4-latest",
      stream: true,
      messages,
      tools: toolsSpec().map((tool) => ({
        type: "function",
        function: { name: tool.name, description: tool.description, parameters: tool.parameters },
      })),
    }),
  });
  if (!res.ok) {
    throw new Error(`SubStudio HTTP ${res.status}`);
  }
  return readOpenAiStream(res, onDelta);
}

async function completeResponses({ token, settings, messages, previousResponseId, onDelta }) {
  const input = messages.map((item) => ({ role: item.role, content: item.content }));
  const payload = {
    model: settings.grokModel || "grok-4-latest",
    input,
    tools: [{ type: "web_search" }, ...toolsSpec()],
    store: true,
  };
  if (previousResponseId) {
    payload.previous_response_id = previousResponseId;
    payload.input = input.filter((item) => item.role === "user").slice(-1);
  }
  const res = await fetch(`${XAI_API}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`xAI HTTP ${res.status}: ${detail.slice(0, 180)}`);
  }
  const json = await res.json();
  const text = collectResponseText(json);
  if (onDelta && text) {
    onDelta(text);
  }
  return {
    text,
    responseId: json.id,
    toolCalls: collectFunctionCalls(json),
    citations: collectCitations(json),
  };
}

function collectResponseText(json) {
  const parts = [];
  for (const item of json.output || []) {
    if (item.type === "message") {
      for (const chunk of item.content || []) {
        if (chunk.text) {
          parts.push(chunk.text);
        }
      }
    }
  }
  return parts.join("\n") || json.output_text || "";
}

function collectFunctionCalls(json) {
  const calls = [];
  for (const item of json.output || []) {
    if (item.type === "function_call") {
      calls.push({
        id: item.call_id || item.id,
        name: item.name,
        arguments: item.arguments,
      });
    }
  }
  return calls;
}

function collectCitations(json) {
  const cites = [];
  const blob = JSON.stringify(json);
  const matches = blob.matchAll(/https?:\/\/[^\\"\s]+/g);
  for (const match of matches) {
    if (!match[0].includes("x.ai") && cites.length < 8) {
      cites.push(match[0]);
    }
  }
  return [...new Set(cites)];
}

async function readOpenAiStream(res, onDelta) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  const toolAcc = {};
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n");
    buffer = chunks.pop() || "";
    for (const line of chunks) {
      if (!line.startsWith("data:")) {
        continue;
      }
      const data = line.slice(5).trim();
      if (data === "[DONE]") {
        continue;
      }
      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta || {};
        if (delta.content) {
          text += delta.content;
          if (onDelta) {
            onDelta(delta.content);
          }
        }
        for (const call of delta.tool_calls || []) {
          const idx = call.index || 0;
          toolAcc[idx] = toolAcc[idx] || { id: call.id, name: call.function?.name, arguments: "" };
          if (call.function?.name) {
            toolAcc[idx].name = call.function.name;
          }
          if (call.function?.arguments) {
            toolAcc[idx].arguments += call.function.arguments;
          }
        }
      } catch {
        /* partial json */
      }
    }
  }
  return { text, toolCalls: Object.values(toolAcc), citations: [] };
}
