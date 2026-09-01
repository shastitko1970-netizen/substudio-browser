import { PRODUCT_VERSION } from "./settings.js";

export const RELEASES_API =
  "https://api.github.com/repos/shastitko1970-netizen/substudio-browser/releases/latest";

function parseTag(tag) {
  return String(tag || "").replace(/^v/, "");
}

export async function checkUpdate() {
  const res = await fetch(RELEASES_API, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!res.ok) {
    throw new Error(`GitHub Releases HTTP ${res.status}`);
  }
  const json = await res.json();
  const latest = parseTag(json.tag_name);
  return {
    current: PRODUCT_VERSION,
    latest,
    newer: compare(latest, PRODUCT_VERSION) > 0,
    htmlUrl: json.html_url,
    assets: (json.assets || []).map((item) => ({ name: item.name, url: item.browser_download_url, size: item.size })),
  };
}

function compare(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] || 0) !== (pb[i] || 0)) {
      return (pa[i] || 0) - (pb[i] || 0);
    }
  }
  return 0;
}
