const KEY = "ssb_vault";

async function getKey(userId) {
  const stored = await browser.storage.local.get({ ssb_master: null });
  let raw = stored.ssb_master;
  if (!raw) {
    raw = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    await browser.storage.local.set({ ssb_master: raw });
  }
  const material = new TextEncoder().encode(`${raw}:${userId || "anon"}`);
  const digest = await crypto.subtle.digest("SHA-256", material);
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function bufToB64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function b64ToBuf(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function readVault(userId) {
  const packed = await browser.storage.local.get({ [KEY]: null });
  if (!packed[KEY]) {
    return { threads: [], notes: [] };
  }
  try {
    const key = await getKey(userId);
    const iv = b64ToBuf(packed[KEY].iv);
    const data = b64ToBuf(packed[KEY].data);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    return { threads: [], notes: [] };
  }
}

async function writeVault(userId, vault) {
  const key = await getKey(userId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(vault)),
  );
  await browser.storage.local.set({
    [KEY]: { iv: bufToB64(iv), data: bufToB64(data) },
  });
}

export async function listThreads(userId) {
  const vault = await readVault(userId);
  return vault.threads;
}

export async function saveThread(userId, thread) {
  const vault = await readVault(userId);
  const index = vault.threads.findIndex((item) => item.id === thread.id);
  if (index >= 0) {
    vault.threads[index] = thread;
  } else {
    vault.threads.unshift(thread);
  }
  vault.threads = vault.threads.slice(0, 40);
  await writeVault(userId, vault);
  return thread;
}

export async function listNotes(userId) {
  return (await readVault(userId)).notes;
}

export async function saveNote(userId, text) {
  const vault = await readVault(userId);
  const note = { id: crypto.randomUUID(), text, createdAt: Date.now() };
  vault.notes.unshift(note);
  vault.notes = vault.notes.slice(0, 80);
  await writeVault(userId, vault);
  return note;
}

export async function clearVault(userId) {
  await writeVault(userId, { threads: [], notes: [] });
}

export async function exportVault(userId) {
  return readVault(userId);
}
