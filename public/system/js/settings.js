"use strict";

const WS_CLOAKS_URL = new URL("../json/cloaks.json", document.currentScript?.src || location.href);

const WS_SETTINGS_ASSET_BASE = new URL("https://raw.githubusercontent.com/securlydetected/assets/refs/heads/main/cloak-btn/", document.currentScript?.src || location.href);

const _REAL_TITLE   = (function() {

  const stored = localStorage.getItem("_realTitle");
  if (!isCloakOnRaw()) {

    localStorage.setItem("_realTitle", document.title);
    return document.title;
  }
  return stored || document.title;
})();

const _REAL_FAVICON = (function() {
  const stored = localStorage.getItem("_realFavicon");
  if (!isCloakOnRaw()) {
    const href = (document.querySelector("link[rel~='icon']") || {}).href || "";
    localStorage.setItem("_realFavicon", href);
    return href;
  }
  return stored || "";
})();

function isCloakOnRaw() {
  return localStorage.getItem("cloakEnabled") === "true";
}

function isCloakOn() {
  return localStorage.getItem("cloakEnabled") === "true";
}

function applyCloak() {
  if (!isCloakOn()) return;
  const title = localStorage.getItem("cloakTitle");
  const icon  = localStorage.getItem("cloakIcon");
  if (title) document.title = title;
  if (icon && typeof setFavicon === "function") setFavicon(icon);
}

function _removeCloak() {

  document.title = _REAL_TITLE;

  if (typeof setFavicon === "function") setFavicon(_REAL_FAVICON);

  const realFav = _REAL_FAVICON || localStorage.getItem("_realFavicon") || "";
  document.querySelectorAll("link[rel~='icon']").forEach(el => {
    if (realFav) el.href = realFav;
  });

  setTimeout(() => { document.title = _REAL_TITLE; }, 0);
  window.WS_RefreshFallbackFavicon?.();
}

let _cloakCatalog = null;
function loadCloaks() {
  if (!_cloakCatalog) {
    _cloakCatalog = fetch(WS_CLOAKS_URL, { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("cloaks.json " + r.status))))
      .then((rows) => (Array.isArray(rows) ? rows : [])
        .filter((c) => c && c.id && c.title)
        .map((c) => ({ id: String(c.id), title: String(c.title), icon: String(c.icon || ""), metadata: c.metadata || {} })))
      .catch((err) => { console.warn("[cloaks] load failed:", err); return []; });
  }
  return _cloakCatalog;
}

function toggleCloak() {
  const nowOn = !isCloakOn();
  localStorage.setItem("cloakEnabled", String(nowOn));

  if (nowOn) {
    const finish = () => { applyCloak(); showToast("🔒 Cloak ON"); };
    if (!localStorage.getItem("cloakTitle")) {
      loadCloaks().then((list) => {
        const d = list.find((c) => c.id === "google") || list[0];
        if (d && !localStorage.getItem("cloakTitle")) {
          localStorage.setItem("cloakTitle", d.title);
          localStorage.setItem("cloakIcon", d.icon);
        }
        if (isCloakOn()) finish();
      });
    } else finish();
  } else {
    _removeCloak();
    showToast("🔓 Cloak OFF");
  }

  _syncCloakBtn();
}

function _syncCloakBtn() {
  const btn = document.getElementById("cloak-btn");
  if (!btn) return;
  const img = btn.querySelector("img");
  if (img) {
    img.src = new URL(isCloakOn() ? "cloaked.png" : "visable.png", WS_SETTINGS_ASSET_BASE).href;
  }
}

applyCloak();

window.addEventListener("storage", (e) => {
  if (e.key === "cloakEnabled" || e.key === "cloakTitle" || e.key === "cloakIcon") {
    isCloakOn() ? applyCloak() : _removeCloak();
    _syncCloakBtn();
  }
});

document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("cloak-btn");
  if (!btn) return;

  const img = btn.querySelector("img");
  if (img) {
    img.src = new URL(isCloakOn() ? "cloaked.png" : "visable.png", WS_SETTINGS_ASSET_BASE).href;
  }
  btn.title = "Toggle tab cloak";
  btn.addEventListener("click", toggleCloak);
});

document.addEventListener("keydown", (e) => {
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;

  if (e.key === "Escape") {
    const url = localStorage.getItem("panicURL");
    if (url) window.location.replace(url);
  }
});

document.addEventListener("DOMContentLoaded", () => {
  if (!document.querySelector(".settings-page")) return;

  const webnameInput   = document.getElementById("webname");
  const webiconInput   = document.getElementById("webicon");
  const presetCloakSel = document.getElementById("presetCloaks");
  const panicInput     = document.getElementById("panicURL");
  const panicPresetSel = document.getElementById("presetPanic");
  const passInput      = document.getElementById("pass");

  if (webnameInput) webnameInput.value = localStorage.getItem("cloakTitle") || "";
  if (webiconInput) webiconInput.value = localStorage.getItem("cloakIcon")  || "";
  if (panicInput)   panicInput.value   = localStorage.getItem("panicURL")   || "";

  let CLOAK_PRESETS = {};
  loadCloaks().then((list) => {
    CLOAK_PRESETS = Object.fromEntries(list.map((c) => [c.id, c]));
    if (!presetCloakSel) return;
    const have = new Set([...presetCloakSel.options].map((o) => o.value));
    list.forEach((c) => {
      if (have.has(c.id)) return;
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.title;
      presetCloakSel.append(opt);
    });
  });

  presetCloakSel?.addEventListener("change", () => {
    const p = CLOAK_PRESETS[presetCloakSel.value];
    if (!p) return;
    if (webnameInput) webnameInput.value = p.title;
    if (webiconInput) webiconInput.value = p.icon;
  });

  const PANIC_PRESETS = {
    google:    "https://www.google.com",
    drive:     "https://drive.google.com",
    classroom: "https://classroom.google.com",
    docs:      "https://docs.google.com",
    canvas:    "https://canvas.instructure.com",
    schoology: "https://app.schoology.com",
    outlook:   "https://outlook.office.com",
    bing:      "https://www.bing.com",
    wikipedia: "https://www.wikipedia.org",
  };

  panicPresetSel?.addEventListener("change", () => {
    const url = PANIC_PRESETS[panicPresetSel.value];
    if (url && panicInput) panicInput.value = url;
  });

  window.setCloakCookie = function (e) {
    e?.preventDefault();
    const title = webnameInput?.value.trim() || "";
    const icon  = webiconInput?.value.trim() || "";
    if (!title && !icon) return showToast("Enter a title or icon URL first.");
    if (title) localStorage.setItem("cloakTitle", title);
    if (icon)  localStorage.setItem("cloakIcon",  icon);
    localStorage.setItem("cloakEnabled", "true");
    applyCloak();
    _syncCloakBtn();
    showToast("Cloak set and enabled!");
  };

  window.clearCloak = function () {
    localStorage.removeItem("cloakTitle");
    localStorage.removeItem("cloakIcon");
    localStorage.setItem("cloakEnabled", "false");
    _removeCloak();
    if (webnameInput)   webnameInput.value   = "";
    if (webiconInput)   webiconInput.value   = "";
    if (presetCloakSel) presetCloakSel.value = "";
    _syncCloakBtn();
    showToast("Cloak cleared.");
  };

  window.setPanicMode = function (e) {
    e?.preventDefault();
    const url = panicInput?.value.trim();
    if (!url) return showToast("Enter a panic URL first.");
    try { new URL(url); } catch { return showToast("Invalid URL — include https://"); }
    localStorage.setItem("panicURL", url);
    showToast("Panic URL saved! Press ESC to trigger.");
  };

  window.clearPanicMode = function () {
    localStorage.removeItem("panicURL");
    if (panicInput)     panicInput.value     = "";
    if (panicPresetSel) panicPresetSel.value = "";
    showToast("Panic URL cleared.");
  };

  window.setPassword = function (e) {
    e?.preventDefault();
    const pw = passInput?.value.trim();
    if (!pw) return showToast("Enter a password first.");
    localStorage.setItem("accessPassword", pw);
    showToast("Access password set!");
  };

  window.delPassword = function () {
    localStorage.removeItem("accessPassword");
    if (passInput) passInput.value = "";
    showToast("Password cleared.");
  };
});