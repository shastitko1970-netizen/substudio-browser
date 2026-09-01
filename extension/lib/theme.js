export const THEME_KEY = "uiTheme";

function parseColor(value) {
  if (!value) return null;
  const hex = String(value).trim();
  const short = /^#([0-9a-f]{3})$/i.exec(hex);
  if (short) {
    const [r, g, b] = short[1].split("").map((ch) => parseInt(ch + ch, 16));
    return { r, g, b };
  }
  const full = /^#([0-9a-f]{6})$/i.exec(hex);
  if (full) {
    return {
      r: parseInt(full[1].slice(0, 2), 16),
      g: parseInt(full[1].slice(2, 4), 16),
      b: parseInt(full[1].slice(4, 6), 16),
    };
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(hex);
  if (rgb) {
    return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) };
  }
  return null;
}

function isDarkColor(value) {
  const rgb = parseColor(value);
  if (!rgb) return null;
  const luma = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
  return luma < 0.45;
}

export function prefersDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export async function browserThemeDark() {
  if (!browser.theme?.getCurrent) {
    return prefersDark();
  }
  try {
    const theme = await browser.theme.getCurrent();
    const colors = theme?.colors || {};
    const probe = colors.frame || colors.toolbar || colors.popup;
    const dark = isDarkColor(probe);
    if (dark != null) return dark;
  } catch {
    /* theme API optional */
  }
  return prefersDark();
}

function resolveDark(mode, systemDark) {
  switch (mode) {
    case "light":
      return false;
    case "dark":
      return true;
    case "system":
      return systemDark;
    default:
      return systemDark;
  }
}

export function paintTheme(mode, systemDark) {
  const dark = resolveDark(mode, systemDark);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  return dark;
}

export async function loadThemeMode() {
  const stored = await browser.storage.local.get({ [THEME_KEY]: "system" });
  return stored[THEME_KEY] || "system";
}

export async function applyStoredTheme() {
  const mode = await loadThemeMode();
  return paintTheme(mode, await browserThemeDark());
}

export async function setThemeMode(mode) {
  let next = mode;
  switch (mode) {
    case "light":
    case "dark":
    case "system":
      next = mode;
      break;
    default:
      next = "system";
  }
  await browser.storage.local.set({ [THEME_KEY]: next });
  await applyStoredTheme();
  return next;
}

export async function toggleTheme() {
  const current = document.documentElement.dataset.theme === "dark";
  return setThemeMode(current ? "light" : "dark");
}

export function bindThemeToggle(button) {
  if (!button) return;
  const sync = () => {
    const dark = document.documentElement.dataset.theme === "dark";
    button.title = dark ? "Светлая тема" : "Тёмная тема";
    button.setAttribute("aria-label", button.title);
    button.dataset.theme = dark ? "dark" : "light";
    if (button.dataset.themeCaption === "en") {
      button.textContent = dark ? "Light" : "Dark";
    }
  };
  button.addEventListener("click", async () => {
    await toggleTheme();
    sync();
  });
  sync();
}

export function bootTheme() {
  paintTheme("system", prefersDark());
  applyStoredTheme().then(() => {
    document.querySelectorAll("[data-theme-toggle]").forEach((node) => bindThemeToggle(node));
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    applyStoredTheme();
  });
  if (browser.theme?.onUpdated) {
    browser.theme.onUpdated.addListener(() => applyStoredTheme());
  }
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[THEME_KEY]) {
      applyStoredTheme();
    }
  });
}
