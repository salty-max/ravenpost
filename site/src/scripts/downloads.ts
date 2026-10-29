// The download links point at the latest release's page until GitHub answers:
// then at the files themselves, the visitor's system first. Without this
// script, or when GitHub doesn't answer, the page works as it is.

import { ASSETS, type Asset, REPO } from "../data";

interface Release {
  tag_name: string;
  published_at: string;
  assets: { name: string; browser_download_url: string }[];
}

const API = `https://api.github.com/repos/${REPO}/releases/latest`;
const FILES = `https://github.com/${REPO}/releases/download/`;
const KEY = "ravenpost-latest";

// The HTML puts Windows first, in gold: a Mac gets its own button there.
function mine(): void {
  const downloads = document.getElementById("downloads");
  // "Macintosh", not "Mac": an iPhone's user agent says "like Mac OS X"
  if (!downloads || !/Macintosh/.test(navigator.userAgent)) return;
  const mac = downloads.querySelector('[data-asset="macos"]');
  if (!mac) return;
  for (const button of downloads.children) button.classList.remove("btn-gold");
  mac.classList.add("btn-gold");
  downloads.prepend(mac);
}

function apply(release: Release): void {
  const files = new Map<Asset, string>();
  for (const { name, browser_download_url: url } of release.assets) {
    for (const [asset, suffix] of Object.entries(ASSETS) as [Asset, string][]) {
      if (name.endsWith(suffix) && url.startsWith(FILES)) files.set(asset, url);
    }
  }
  for (const link of document.querySelectorAll<HTMLAnchorElement>("a[data-asset]")) {
    const url = files.get(link.dataset.asset as Asset);
    if (url) link.href = url;
  }
  const version = document.getElementById("version");
  if (version && release.tag_name && release.published_at) {
    const date = new Date(release.published_at).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    version.textContent = `${release.tag_name}, ${date}`;
  }
}

function cached(): Release | null {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? "null") as Release | null;
  } catch {
    return null;
  }
}

async function latest(): Promise<Release | null> {
  try {
    const response = await fetch(API, { headers: { Accept: "application/vnd.github+json" } });
    if (!response.ok) return null;
    const release = (await response.json()) as Release;
    const kept: Release = {
      tag_name: release.tag_name,
      published_at: release.published_at,
      assets: release.assets.map(({ name, browser_download_url }) => ({ name, browser_download_url })),
    };
    try {
      sessionStorage.setItem(KEY, JSON.stringify(kept));
    } catch {
      // a private window: asked again next visit
    }
    return kept;
  } catch {
    return null;
  }
}

mine();
const release = cached() ?? (await latest());
if (release) apply(release);
