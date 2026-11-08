"use strict";

// WannaSmile desktop bridge. Load it FIRST in <head>, as a plain (not
// deferred) script, before any other script on the page.
//
// In a normal browser this file does nothing: it adds no flag, no class and
// no listeners, and window.open() / target="_blank" behave exactly as before.
//
// Inside the Windows app (WebView2, see desktop/) it:
//   - exposes window.WS_Desktop = { isApp: true } and puts class "ws-app" on <html>
//   - routes every "open in a new tab/window" request, whatever its source,
//     so the app never ends up with extra windows:
//
//       internal page of this site        -> same window (location.assign)
//       about:blank / blob: / data:       -> a full-window viewer layered over
//                                            the current page (Back button
//                                            returns to it); its contentWindow
//                                            is returned, so code that writes
//                                            into the "new tab" keeps working
//       external http(s) link             -> native side opens the default
//                                            browser (NewWindowRequested)
//       javascript: and anything else odd -> dropped
//
//   - clicks on <a target="_blank"> (or any named target) are caught in the
//     capture phase on document, so links added later by scripts are covered
//     too. Links created and click()ed while detached, and any navigation this
//     file can't see, are still caught natively (desktop/native/).
//
// How the app is detected: the native side sets window.WANNA_SMILE_APP = true
// before any page script runs (AddScriptToExecuteOnDocumentCreated) and adds
// "WannaSmileApp/<version>" to the user agent. Either one counts. Nothing
// here talks to native code: there is no postMessage channel and no host object.
(() => {
  const UA_RE = /WannaSmileApp\//;
  const isApp = window.WANNA_SMILE_APP === true || UA_RE.test(navigator.userAgent || "");

  window.WS_Desktop = Object.freeze({ isApp });
  if (!isApp) return;

  try { if (window.WANNA_SMILE_APP !== true) window.WANNA_SMILE_APP = true; } catch (_) {}
  document.documentElement.classList.add("ws-app");

  // Browser-only bits of the page (e.g. the "Desktop app" download link) hide in the app.
  const css = document.createElement("style");
  css.textContent = "html.ws-app [data-ws-browser-only]{display:none!important}";
  document.documentElement.appendChild(css);

  const nativeOpen = window.open.bind(window);
  const SITE_HOSTS = [location.hostname.toLowerCase(), "vvannazmile.github.io", "vvannazmile.github.io.", "wannasmile4evr.github.io"];

  // ── Classify a URL ────────────────────────────────────────────────────
  function classify(raw) {
    let u;
    try { u = new URL(String(raw), document.baseURI); } catch (_) { return { kind: "drop" }; }
    const p = u.protocol;
    if (p === "blob:" || p === "data:") return { kind: "viewer", url: u.href };
    if (p === "about:") return u.href === "about:blank" ? { kind: "viewer", url: "" } : { kind: "drop" };
    if (p === "http:" || p === "https:") {
      return SITE_HOSTS.indexOf(u.hostname.toLowerCase()) !== -1
        ? { kind: "internal", url: u.href }
        : { kind: "external", url: u.href };
    }
    if (p === "mailto:" || p === "tel:") return { kind: "external", url: u.href };
    return { kind: "drop" };   // javascript:, file:, ms-*:, ...
  }

  // What window.open() hands back when no real window exists: enough for the
  // usual "if (!w) pop-up blocked" and w.focus() / w.close() checks.
  function stub(href) {
    return { closed: false, opener: null, location: { href: href || "" }, focus() {}, blur() {}, close() { this.closed = true; } };
  }

  // ── Viewer: the in-app replacement for a new tab ──────────────────────
  let viewer = null;

  function closeViewer() {
    if (!viewer) return;
    const v = viewer;
    viewer = null;                       // first, so a re-entrant close() does nothing
    v.root.remove();
    document.documentElement.style.overflow = v.prevOverflow;
  }

  function openViewer(src) {
    closeViewer();
    const root = document.createElement("div");
    root.id = "wsDesktopViewer";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "WannaSmile viewer");
    root.style.cssText = "position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;background:#000;";

    const bar = document.createElement("div");
    bar.style.cssText = "flex:0 0 auto;display:flex;align-items:center;gap:10px;height:36px;padding:0 10px;background:#15171c;border-bottom:1px solid #2a2d35;font:600 13px 'Segoe UI',system-ui,sans-serif;color:#e8e8ee;";
    const back = document.createElement("button");
    back.type = "button";
    back.textContent = "\u2190 Back to WannaSmile";
    back.style.cssText = "cursor:pointer;border:1px solid #3a3e48;border-radius:999px;background:#20232b;color:#fff;padding:4px 12px;font:inherit;";
    back.addEventListener("click", closeViewer);
    bar.append(back);

    const frame = document.createElement("iframe");
    frame.style.cssText = "flex:1 1 auto;width:100%;border:0;background:#fff;";
    frame.setAttribute("allow", "fullscreen; autoplay; gamepad; clipboard-write");
    frame.setAttribute("allowfullscreen", "");
    if (src) frame.src = src;

    root.append(bar, frame);
    (document.body || document.documentElement).appendChild(root);
    viewer = { root, prevOverflow: document.documentElement.style.overflow };
    document.documentElement.style.overflow = "hidden";

    const win = frame.contentWindow;
    try { win.close = closeViewer; } catch (_) {}   // code that calls tab.close() closes the viewer
    return win;
  }

  // ── The single routing point ──────────────────────────────────────────
  function route(raw) {
    const r = classify(raw);
    switch (r.kind) {
      case "internal": location.assign(r.url); return stub(r.url);
      case "viewer":   return openViewer(r.url);
      case "external": nativeOpen(r.url, "_blank", "noopener,noreferrer"); return stub(r.url);   // native opens the default browser
      default:         return null;
    }
  }

  window.open = function (url /*, target, features */) {
    const raw = url == null ? "" : String(url);
    return route(raw === "" ? "about:blank" : raw);
  };

  // <a target="_blank"> and named targets, including links added later.
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0) return;
    const a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a || a.hasAttribute("download")) return;
    const t = (a.getAttribute("target") || "").toLowerCase();
    if (!t || t === "_self" || t === "_top" || t === "_parent") return;
    const href = a.getAttribute("href") || "";
    if (href === "" || href.charAt(0) === "#") return;     // placeholder links filled in by scripts
    e.preventDefault();
    route(a.href);
  }, true);

  // ── Offline hint (the first-load failure page lives in the native app) ──
  let pill = null;
  function setOffline(off) {
    if (!off) { if (pill) { pill.remove(); pill = null; } return; }
    if (pill) return;
    pill = document.createElement("div");
    pill.textContent = "You're offline. WannaSmile needs an internet connection.";
    pill.style.cssText = "position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:2147483001;padding:8px 16px;border-radius:999px;background:#1b1d23;color:#fff;border:1px solid #f44;font:600 13px 'Segoe UI',system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.5);";
    (document.body || document.documentElement).appendChild(pill);
  }
  window.addEventListener("offline", () => setOffline(true));
  window.addEventListener("online", () => setOffline(false));
  if (navigator.onLine === false) document.addEventListener("DOMContentLoaded", () => setOffline(true), { once: true });
})();
