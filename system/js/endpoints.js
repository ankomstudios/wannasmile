"use strict";

// ── Backend endpoints ──────────────────────────────────────────────────
// Apps Script is disabled in this development build. Keep these endpoints
// empty so optional legacy features cannot silently fall back to it.
//
// Catalogs (themes, banners, frames, gif packs, widgets, wrappers) come only
// from the local JSON files under /json via WS_LocalCatalogs below.
//
// This file loads before other system scripts, so they can read
// window.WS_ENDPOINTS and the local catalog loader.
//
window.WS_ENDPOINTS = Object.freeze({
  data: "",
  mod: "",
  // WannaChat runs on its dedicated Cloudflare Worker. Do not route chat
  // traffic through data, which remains disabled for other legacy services.
  chat: "https://global-chat.ankomstudios.workers.dev",
  // Public SQL (D1) library used for the homepage and DevBuild assets.
  // One exported JSON file ({ updated, items }) rebuilt by the ankom-api Worker
  // from D1. The endpoint versions its edge cache against the R2 object ETag.
  library: "https://api.ankomstudios.com/library/items",
  // Asks the ankom-api Worker to rebuild that JSON file now instead of waiting
  // for its 3-hour schedule. The R shortcut calls it (15 per 24 hrs, see
  // WS_Rebuild in main.js). POST, no body.
  rebuild: "https://api.ankomstudios.com/library/rebuild",
  // Your Cloudflare Worker HTML-fetch endpoint used by "qwerty" assets.
  // This fetches the initial HTML document only; it is not a WebSocket relay.
  fetch: "https://ankom-url-api.ankomstudios.workers.dev/fetch?url=",
});

// Defense in depth: no site code or stale saved URL may call an Apps Script
// deployment while this dev build has those services turned off.
const nativeFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const rawUrl = input instanceof Request ? input.url : input;
  const url = new URL(rawUrl, location.href);
  if (
    url.hostname === "script.google.com" ||
    url.hostname === "script.googleusercontent.com"
  ) {
    return Promise.reject(new Error("Apps Script requests are disabled in this build."));
  }
  return nativeFetch(input, init);
};

window.WS_LocalCatalogs = (() => {
  const files = Object.freeze({
    banners: "banners.json",
    frames: "frames.json",
    gifpacks: "gifpacks.json",
    themes: "themes.json",
    widgets: "widgets.json",
    wrappers: "wrappers.json",
  });
  const base = new URL("../json/", document.currentScript?.src || location.href);
  const pending = new Map();

  function load(type) {
    const file = files[type];
    if (!file) return Promise.reject(new Error(`Unknown local catalog: ${type}`));
    if (!pending.has(type)) {
      pending.set(type, fetch(new URL(file, base), { cache: "no-cache" }).then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status} loading ${file}`);
        const rows = await response.json();
        if (!Array.isArray(rows)) throw new Error(`${file} must contain a JSON array`);
        return rows;
      }).catch((error) => {
        pending.delete(type);
        throw error;
      }));
    }
    return pending.get(type);
  }

  return Object.freeze({ load });
})();

// Account setup is required before using chat; public site content stays open.
window.WS_ACCOUNTS_ENABLED = true;

// ── General media (mediabaseWS) ────────────────────────────────────────
// Banners, profile pics, stickers and theme art live in their own repo,
// github.com/wannasmile4evr/mediabaseWS, not in this site:
//
//   assets/media/banners/         -> banners/<id>/splash.<ext>
//   assets/media/images/profile/  -> profile/
//   assets/media/stickers/        -> stickers/
//   assets/media/themes/          -> themes/
//   (new, never lived on this site)  frames/<id>/splash.<ext>, wrappers/<id>/splash.<ext>
//
// A sheet row or saved value may also just name the repo path directly
// ("banners/buni/splash.jpg", optionally with a "site:" prefix, which banner
// picks are saved with); those resolve against this repo too. Old flat
// banner names (banners/banner7.jpg) no longer exist there: the banners were
// renamed to per-id folders, so BannerWS rows must use the new paths.
//
// Sheet rows and browser caches can still hold old site paths, old repo URLs,
// or the former theme/gif-pack directories. Normalize those to this repo's
// current layout while leaving unrelated URLs alone.
window.WS_MEDIABASE = "https://raw.githubusercontent.com/wannasmile4evr/mediabaseWS/main/";
window.WS_SITE_ASSETS = "https://ws.ankomstudios.com/";

window.toSiteAsset = (url) => {
  if (typeof url !== "string") return url;
  const value = url.trim();
  const legacy = value.match(
    /^(?:site:)?(?:(?:https?:)?\/\/(?:wannasmile4evr|vvannazmile)\.github\.io\.?\/)?(?:\/|(?:\.\.?\/)*)assets\/(.+)$/i
  );
  return legacy ? window.WS_SITE_ASSETS + legacy[1] : url;
};

window.toMediabase = (() => {
  const host = location.host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const moved = new RegExp(
    String.raw`^(?:site:|(?:https?:)?//(?:wannasmile4evr\.github\.io\.?|vvannazmile\.github\.io\.?${host ? "|" + host : ""})/(?:[^?#]*?/)?|/|(?:\.\.?/)*)` +
    String.raw`(?:assets/)?media/(banners|stickers|themes|images/profile)/`, "i");
  const direct = /^(?:site:)?((?:banners|stickers|themes|profile|frames|wrappers|gif-packs)\/.+)$/i;
  const oldRepo = /^https?:\/\/raw\.githubusercontent\.com\/wannasmile4evr\/(?:wannabase|mediabaseWS)\/main\/(.*)$/i;
  const normalizePath = (path) => path
    .replace(/^themes\/([^/]+)\/system-media\//i, "themes/$1/")
    .replace(/^themes\/([^/]+)\/gif-states\//i, "gif-packs/$1/");

  return (url) => {
    if (typeof url !== "string") return url;
    const v = url.trim();
    const m = v.match(moved);
    if (m) {
      const dir = m[1].toLowerCase() === "images/profile" ? "profile" : m[1].toLowerCase();
      return window.WS_MEDIABASE + normalizePath(dir + "/" + v.slice(m[0].length));
    }
    const old = v.match(oldRepo);
    if (old) return window.WS_MEDIABASE + normalizePath(old[1]);
    const d = v.match(direct);
    return d ? window.WS_MEDIABASE + normalizePath(d[1]) : url;
  };
})();
