"use strict";

// ── Custom cursors ─────────────────────────────────────────────────────────
// Site-wide cursor packs, picked and switched on from the store page. Off by
// default: nothing here touches the network or the page until
// ws_cursors_enabled is "true".
//
// Packs are DYNAMIC: the CursorsWS sheet (DATA project, ?type=cursors) holds
// just two columns, title (A) and id (B). Every image lives at a predictable
// path on the bucket,
//
//   https://ws.ankomstudios.com/cursors/<id>/<state>.png
//
// and the states a pack can have are
//   normal  plain arrow              point    over links/buttons
//   click   while the mouse is held  grab     draggable things
//   deny    disabled / not-allowed   central  move / all-scroll
//   uphelm  n / ns resize            downhelm s resize
// A pack doesn't need all of them. Each state's url is checked here (it has
// to load as an image); a state that isn't there simply isn't replaced, so
// the browser's own cursor shows for it.
//
// Pages with cursors on never read the sheet: the active id is in
// localStorage and the urls follow from it. Only the store asks the sheet
// for the list (WSCursors.load()), and caches it for the pack names.
//
// Each image is drawn at any size on a transparent canvas: it's trimmed to its
// drawing and scaled down to SIZE px here (browsers ignore cursor images over
// 128px), then cached so the next page paints the cursor instantly. Where a
// cursor "points" (its hotspot) is found from the drawing itself, see HOT.
//
// The site sets its cursors with plain CSS keywords, so instead of guessing
// which elements are clickable, the engine reads the site's own stylesheets
// and re-points every rule's keyword at the matching pack image: anything
// that shows a hand today shows the pack's hand.
//
// Storage:
//   ws_cursors_enabled  "true" when on (set by store.html)
//   ws_active_cursor    the active pack id
//   ws_cursor_size      cursor size in px (16-128, default 32), set on the Settings page
//   ws_cursor_cache     { id, v, size, t, states } baked images for instant paint
//                       (only the states that exist; re-checked after a day)
//   ws_cursor_list      { t, items: [{ id, name }] } the last list the sheet gave
(() => {
  const ENABLED_KEY  = "ws_cursors_enabled";
  const ACTIVE_KEY   = "ws_active_cursor";
  const CACHE_KEY    = "ws_cursor_cache";
  const SIZE_KEY     = "ws_cursor_size";
  const LIST_KEY     = "ws_cursor_list";
  const CACHE_VER    = 3;   // bump when baking changes, so old caches rebuild
  const CACHE_TTL    = 24 * 60 * 60 * 1000;   // re-check a pack's states once a day
  const EMPTY_TTL    = 10 * 60 * 1000;        // ...and a pack with nothing found, every 10 minutes
  const LIST_TTL     = 10 * 60 * 1000;        // the store re-asks the sheet after this long
  const DEFAULT_PACK = "classic";
  const ID_RE        = /^[a-z0-9][a-z0-9_-]{0,39}$/;   // same rule as the sheet (data.gs)
  // Browsers ignore cursor images over 128px, so that's the ceiling.
  const SIZE_MIN = 16, SIZE_MAX = 128, SIZE_DEFAULT = 32;

  const BASE = "https://ws.ankomstudios.com/cursors/";   // R2 bucket; it must send CORS headers (see loadImg)

  const STATES = ["normal", "point", "click", "grab", "deny", "central", "uphelm", "downhelm"];
  const LABELS = {
    normal: "normal", point: "point", click: "click", grab: "grab", deny: "nope",
    central: "central", uphelm: "up helm", downhelm: "down helm",
  };

  // Hotspots (where a cursor "points"). A pack's sheet row only has a title
  // and an id, so the spot is found from the drawing itself:
  //   "tl"     the drawn pixel closest to the top-left corner (an arrow's tip)
  //   "top"    the middle of the topmost row of the drawing (a finger)
  //   "center" the middle of the drawing
  // HOT_BY_ID pins exact spots (in the source image's own pixels) for a pack
  // whose art needs it; anything not listed there uses HOT.
  const HOT = { normal: "tl", point: "top", click: "tl", grab: "center", deny: "center", central: "center", uphelm: "center", downhelm: "center" };
  const HOT_BY_ID = {
    classic: { normal: [106, 91], point: [165, 74], click: [112, 104] },
  };
  const hotFor = (id, state) => HOT_BY_ID[id]?.[state] ?? HOT[state];

  // CSS keyword -> pack state. Keywords not listed (text, wait, the corner
  // resizes, …) have no pack image and keep the native cursor.
  const KEYWORD_STATE = {
    auto: "normal", default: "normal",
    pointer: "point",
    grab: "grab", grabbing: "grab",
    "not-allowed": "deny", "no-drop": "deny",
    move: "central", "all-scroll": "central",
    "n-resize": "uphelm", "ns-resize": "uphelm",
    "s-resize": "downhelm",
  };
  // What shows when a pack has no image for the state.
  const FALLBACK = {
    normal: "default", point: "pointer", click: "pointer", grab: "grab", deny: "not-allowed",
    central: "move", uphelm: "n-resize", downhelm: "s-resize",
  };

  // Adds id-level specificity without matching anything extra, so a rule can
  // beat the site's own #id selectors.
  const BOOST = ":not(#ws-cur-x):not(#ws-cur-y)";
  const TEXT_FIELDS = `textarea, [contenteditable=""], [contenteditable="true"], input:not([type]),
    input:is([type="text"], [type="search"], [type="email"], [type="url"], [type="tel"], [type="password"], [type="number"])`;

  const root = document.documentElement;
  const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const write = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };

  const isEnabled = () => read(ENABLED_KEY) === "true";
  const getActive = () => {
    const id = (read(ACTIVE_KEY) || DEFAULT_PACK).trim().toLowerCase();
    return ID_RE.test(id) ? id : DEFAULT_PACK;
  };
  const clampSize = (n) => {
    n = Math.round(Number(n));
    return Number.isFinite(n) ? Math.max(SIZE_MIN, Math.min(SIZE_MAX, n)) : SIZE_DEFAULT;
  };
  const getSize = () => clampSize(read(SIZE_KEY) ?? SIZE_DEFAULT);
  const rawUrl = (id, state) => new URL(`${encodeURIComponent(id)}/${state}.png`, BASE).href;

  // ── Baking: trim, scale to SIZE, move the hotspot along ─────────────────
  // One attempt per url per page, so a state a pack doesn't have is only asked for once.
  const _imgs = {};
  function loadImg(src) {
    return _imgs[src] || (_imgs[src] = new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";   // bake() reads pixels, so the host must send CORS headers
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`couldn't load ${src}`));
      img.src = src;
    }));
  }

  function bake(img, hot, size) {
    const w = img.naturalWidth, h = img.naturalHeight;
    const c = Object.assign(document.createElement("canvas"), { width: w, height: h });
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, w, h).data;   // throws on a tainted canvas (file://)

    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    let tl = [0, 0], tlSum = Infinity;   // drawn pixel closest to the top-left corner
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (px[(y * w + x) * 4 + 3] > 8) {
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
          if (x + y < tlSum) { tlSum = x + y; tl = [x, y]; }
        }
      }
    }
    if (x1 < 0) throw new Error("empty image");

    // The middle of the drawn pixels on the topmost row.
    let topSum = 0, topN = 0;
    for (let x = x0; x <= x1; x++) if (px[(y0 * w + x) * 4 + 3] > 8) { topSum += x; topN++; }

    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    const k = Math.min(1, size / Math.max(bw, bh));
    const ow = Math.max(1, Math.round(bw * k)), oh = Math.max(1, Math.round(bh * k));
    const out = Object.assign(document.createElement("canvas"), { width: ow, height: oh });
    const octx = out.getContext("2d");
    octx.imageSmoothingQuality = "high";
    octx.drawImage(c, x0, y0, bw, bh, 0, 0, ow, oh);

    const [hx, hy] = Array.isArray(hot) ? hot
      : hot === "tl" ? tl
      : hot === "top" ? [topN ? topSum / topN : x0 + bw / 2, y0]
      : [x0 + bw / 2, y0 + bh / 2];
    const clamp = (v, max) => Math.max(0, Math.min(max - 1, Math.round(v)));
    return { url: out.toDataURL("image/png"), x: clamp((hx - x0) * k, ow), y: clamp((hy - y0) * k, oh) };
  }

  // Baked per pack AND size, so dragging the size slider back and forth
  // doesn't redo work it has already done. Only the states whose image loads
  // are kept; a pack with none at all is an error (nothing to show).
  const _baking = {};
  function bakePack(id, size = getSize()) {
    const slot = `${id}@${size}`;
    if (_baking[slot]) return _baking[slot];
    let loaded = 0;
    _baking[slot] = Promise.all(STATES.map(async (state) => {
      let img;
      try { img = await loadImg(rawUrl(id, state)); } catch { return null; }   // not in this pack
      loaded++;
      try { return [state, bake(img, hotFor(id, state), size)]; } catch { return null; }
    })).then((found) => Object.fromEntries(found.filter(Boolean))).then((states) => {
      if (!Object.keys(states).length) {
        throw new Error(loaded ? "couldn't read the cursor images (is CORS on?)"
          : `no cursor images at ${new URL(`${encodeURIComponent(id)}/`, BASE).href}`);
      }
      return states;
    }).catch((err) => {
      delete _baking[slot];
      throw err;
    });
    return _baking[slot];
  }

  // { states, stale } for this pack and size, or null. A cache older than
  // its TTL still paints right away; it just gets re-checked in the background.
  function cachedEntry(id, size = getSize()) {
    try {
      const c = JSON.parse(read(CACHE_KEY) || "null");
      if (!c || c.id !== id || c.v !== CACHE_VER || c.size !== size || !c.states) return null;
      const ttl = Object.keys(c.states).length ? CACHE_TTL : EMPTY_TTL;
      return { states: c.states, stale: !(Date.now() - (c.t || 0) < ttl) };
    } catch { return null; }
  }
  const cachedStates = (id, size) => cachedEntry(id, size)?.states || null;

  // ── Reading the site's cursor rules ─────────────────────────────────────
  // Split a selector list on its top-level commas (not the ones inside
  // :is(a, b) and friends).
  function splitSelectors(list) {
    const out = [];
    let depth = 0, start = 0;
    for (let i = 0; i < list.length; i++) {
      const ch = list[i];
      if (ch === "(" || ch === "[") depth++;
      else if (ch === ")" || ch === "]") depth--;
      else if (ch === "," && depth === 0) { out.push(list.slice(start, i)); start = i + 1; }
    }
    out.push(list.slice(start));
    return out.map((s) => s.trim()).filter(Boolean);
  }

  // Put a selector under html.ws-cur; one that already starts at html or
  // :root gets the class added there instead.
  function scope(sel) {
    if (/^(html|:root)(?![\w-])/i.test(sel)) return sel.replace(/^(html|:root)/i, "html.ws-cur");
    return `html.ws-cur ${sel}`;
  }

  // [{ wrap: ["@media …"], selector, keyword }] in source order.
  function collectRules() {
    const found = [];
    const walk = (rules, wrap) => {
      for (const rule of rules) {
        if (rule instanceof CSSStyleRule) {
          const val = rule.style.getPropertyValue("cursor").trim().toLowerCase();
          if (val && !val.includes("url(")) found.push({ wrap, selector: rule.selectorText, keyword: val });
        } else if (rule instanceof CSSMediaRule) {
          walk(rule.cssRules, [...wrap, `@media ${rule.conditionText}`]);
        } else if (typeof CSSSupportsRule !== "undefined" && rule instanceof CSSSupportsRule) {
          walk(rule.cssRules, [...wrap, `@supports ${rule.conditionText}`]);
        } else if (rule.cssRules) {
          walk(rule.cssRules, wrap);   // @layer and other grouping rules
        }
      }
    };
    for (const sheet of document.styleSheets) {
      if (sheet.ownerNode?.id === "ws-cursors") continue;
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }   // cross-origin (CDN) sheets
      if (rules) walk(rules, []);
    }
    return found;
  }

  // ── Painting ────────────────────────────────────────────────────────────
  let _states = null;
  let _styleEl = null;

  function styleEl() {
    if (!_styleEl) {
      _styleEl = document.getElementById("ws-cursors") || document.createElement("style");
      _styleEl.id = "ws-cursors";
      if (!_styleEl.isConnected) (document.head || root).appendChild(_styleEl);
    }
    return _styleEl;
  }

  function buildCss(states) {
    // A state the pack doesn't have shows the browser's own cursor.
    const cur = (state) => {
      const s = states[state];
      return s ? `url("${s.url}") ${s.x} ${s.y}, ${FALLBACK[state]}` : FALLBACK[state];
    };
    const valueFor = (keyword) => {
      const state = KEYWORD_STATE[keyword];
      return state ? cur(state) : keyword;
    };
    const decl = (v) => `{ cursor: ${v} !important; }`;

    // The base rules cover the whole page, so they only go out when the pack
    // has something for them; otherwise the page keeps its native cursors.
    const css = [];
    if (states.normal) css.push(`html.ws-cur, html.ws-cur *, html.ws-cur *::before, html.ws-cur *::after ${decl(cur("normal"))}`);
    if (states.normal || states.point) css.push(`html.ws-cur a[href], html.ws-cur summary, html.ws-cur select ${decl(cur("point"))}`);
    if (states.normal || states.deny) css.push(`html.ws-cur :disabled ${decl(cur("deny"))}`);

    // The site's own cursor rules, in source order so ties resolve the way
    // they already do (e.g. .btn:disabled after .btn).
    for (const { wrap, selector, keyword } of collectRules()) {
      const kw = keyword.split(",").pop().trim();
      const scoped = splitSelectors(selector).map(scope).join(", ");
      let block = `${scoped} ${decl(valueFor(kw))}`;
      for (let i = wrap.length - 1; i >= 0; i--) block = `${wrap[i]} { ${block} }`;
      css.push(block);
    }

    // Cursors set inline from JS (style="cursor: grab").
    const keywords = [...new Set([...Object.keys(KEYWORD_STATE), "text", "wait", "move", "se-resize", "sw-resize"])];
    for (const kw of keywords) {
      css.push(`html.ws-cur [style*="cursor: ${kw}"]${BOOST}, html.ws-cur [style*="cursor:${kw}"]${BOOST} ${decl(valueFor(kw))}`);
    }

    css.push(`html.ws-cur :is(${TEXT_FIELDS})${BOOST} ${decl("text")}`);
    // Held down anywhere that isn't a text field, a drag handle or disabled.
    if (states.click) css.push(`html.ws-cur.ws-cur-down, html.ws-cur.ws-cur-down *${BOOST}${BOOST} ${decl(cur("click"))}`);
    return css.join("\n");
  }

  function paint() {
    if (!_states || !Object.keys(_states).length || !isEnabled()) return unpaint();
    styleEl().textContent = buildCss(_states);
    root.classList.add("ws-cur");
  }

  function unpaint() {
    root.classList.remove("ws-cur", "ws-cur-down");
    if (_styleEl) _styleEl.textContent = "";
  }

  // Paint from cache right away, then bake (or re-bake) in the background.
  // A cache past its TTL still paints; it's just checked again, so a state
  // added to the bucket later shows up within a day.
  function refresh() {
    if (!isEnabled()) { _states = null; return unpaint(); }
    const id = getActive(), size = getSize();
    const hit = cachedEntry(id, size);
    _states = hit ? hit.states : null;
    paint();
    if (hit && !hit.stale) return;
    if (hit) {   // past its TTL: forget what this page already tried, so the re-check is real
      delete _baking[`${id}@${size}`];
      STATES.forEach((state) => { delete _imgs[rawUrl(id, state)]; });
    }
    bakePack(id, size).then((states) => {
      write(CACHE_KEY, JSON.stringify({ id, v: CACHE_VER, size, t: Date.now(), states }));
      if (getActive() !== id || getSize() !== size) return;   // changed while baking
      _states = states;
      paint();
    }).catch((err) => {
      console.warn(`[cursors] "${id}" has no usable cursors, keeping native ones:`, err.message);
      if (navigator.onLine === false) return;   // offline isn't "no cursors"; try again next page
      write(CACHE_KEY, JSON.stringify({ id, v: CACHE_VER, size, t: Date.now(), states: {} }));
      if (getActive() === id && getSize() === size) { _states = null; unpaint(); }
    });
  }

  // ── Mouse held: swap to the click cursor ────────────────────────────────
  // Only when the press starts on something showing the normal or point
  // cursor, so drag handles keep grab and disabled things keep deny.
  document.addEventListener("pointerdown", (e) => {
    if (!root.classList.contains("ws-cur") || !_states?.click || e.button !== 0 || !(e.target instanceof Element)) return;
    const fallback = getComputedStyle(e.target).cursor.split(",").pop().trim();
    if (fallback === "default" || fallback === "pointer") root.classList.add("ws-cur-down");
  }, true);
  const release = () => root.classList.remove("ws-cur-down");
  ["pointerup", "pointercancel", "dragend"].forEach((t) => document.addEventListener(t, release, true));
  window.addEventListener("blur", release);

  // ── Keep up with stylesheets added later ────────────────────────────────
  let _rescanQueued = false;
  function rescanSoon() {
    if (_rescanQueued || !root.classList.contains("ws-cur")) return;
    _rescanQueued = true;
    setTimeout(() => { _rescanQueued = false; paint(); }, 50);
  }
  const isSheet = (n) => n.nodeName === "STYLE" ? n.id !== "ws-cursors" : n.nodeName === "LINK" && /stylesheet/i.test(n.rel);
  const watch = (target) => new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (!isSheet(n)) continue;
        if (n.nodeName === "LINK") n.addEventListener("load", rescanSoon, { once: true });
        rescanSoon();
      }
    }
  }).observe(target, { childList: true });
  if (document.head) watch(document.head);
  if (document.body) watch(document.body);
  else document.addEventListener("DOMContentLoaded", () => watch(document.body), { once: true });
  window.addEventListener("load", rescanSoon);

  // Another page or tab (the store) changed the cursor settings.
  window.addEventListener("storage", (e) => {
    if (e.key === ENABLED_KEY || e.key === ACTIVE_KEY || e.key === SIZE_KEY) refresh();
  });

  // Same-tab listeners (the Settings page) can't get a "storage" event for
  // their own writes, so changes announce themselves too.
  const announce = () => document.dispatchEvent(new CustomEvent("ws:cursor-change"));

  // ── The list of packs (the sheet, via the store) ────────────────────────
  // The sheet's title/id rows. Cached so the Settings page and the next store
  // visit can name packs without asking again. If the sheet can't be reached
  // (no ticket yet, offline) the last list is used, or just the default pack.
  const FALLBACK_LIST = [{ id: DEFAULT_PACK, name: "Classic" }];
  const cleanList = (rows) => {
    const seen = new Set();
    const out = [];
    for (const r of Array.isArray(rows) ? rows : []) {
      const id = String(r?.id ?? "").trim().toLowerCase();
      if (!ID_RE.test(id) || seen.has(id)) continue;
      seen.add(id);
      out.push({ id, name: String(r?.title ?? r?.name ?? "").trim() || id });
    }
    return out;
  };
  const readList = () => {
    try {
      const c = JSON.parse(read(LIST_KEY) || "null");
      const items = c && cleanList(c.items);
      return items && items.length ? { t: c.t || 0, items } : null;
    } catch { return null; }
  };

  let _list = null;
  let _loading = null;
  const currentList = () => _list || readList()?.items || FALLBACK_LIST;

  // Resolves with [{ id, name }]; never rejects. Only the store calls this.
  function load(force) {
    const cached = readList();
    if (!force && cached && Date.now() - cached.t < LIST_TTL) return Promise.resolve((_list = cached.items));
    if (_loading) return _loading;
    const wait = typeof ticketReady === "function" ? ticketReady() : Promise.resolve();
    _loading = wait
      .then(() => {
        const base = window.WS_ENDPOINTS && window.WS_ENDPOINTS.data;
        if (!base) throw new Error("no DATA endpoint");
        const url = `${base}?type=cursors`;
        return fetch(typeof bustCache === "function" ? bustCache(url) : url, { cache: "no-store" });
      })
      .then((r) => r.json())
      .then((rows) => {
        if (!Array.isArray(rows)) throw new Error((rows && rows.error) || "the cursor feed didn't return a list");
        const items = cleanList(rows);
        write(LIST_KEY, JSON.stringify({ t: Date.now(), items }));
        return (_list = items);
      })
      .catch((err) => {
        console.warn("[cursors] Couldn't read the cursor list:", err.message);
        return (_list = cached ? cached.items : FALLBACK_LIST);
      })
      .finally(() => { _loading = null; });
    return _loading;
  }

  window.WSCursors = {
    load,
    list: () => currentList().map(({ id, name }) => ({ id, name })),
    states: STATES,
    labels: LABELS,
    isEnabled,
    getActive,
    getName: (id) => currentList().find((p) => p.id === id)?.name || id,
    sizeMin: SIZE_MIN, sizeMax: SIZE_MAX, sizeDefault: SIZE_DEFAULT,
    getSize,
    // Cursor size in px, clamped to 16-128. The default (32) is stored as
    // "nothing", so a reset leaves no trace.
    setSize(px) {
      const size = clampSize(px);
      write(SIZE_KEY, size === SIZE_DEFAULT ? null : String(size));
      refresh();
      announce();
      return size;
    },
    setEnabled(on) {
      write(ENABLED_KEY, on ? "true" : null);
      refresh();
      announce();
    },
    setActive(id) {
      const key = (id || "").trim().toLowerCase();
      if (!ID_RE.test(key)) return false;
      write(ACTIVE_KEY, key);
      refresh();
      announce();
      return true;
    },
    // { state: url } for the states this pack has, as trimmed, cursor-sized
    // images for previews. If baking isn't possible (e.g. opened from
    // file://) the raw files are offered instead and the page drops any that
    // don't load. {} when the pack has nothing.
    preview(id, size = getSize()) {
      size = clampSize(size);
      const urlsOf = (states) => Object.fromEntries(STATES.filter((s) => states[s]).map((s) => [s, states[s].url]));
      const cached = cachedStates(id, size);
      if (cached && Object.keys(cached).length) return Promise.resolve(urlsOf(cached));
      return bakePack(id, size)
        .then(urlsOf)
        .catch((err) => (/no cursor images/.test(err.message) ? {} : Object.fromEntries(STATES.map((s) => [s, rawUrl(id, s)]))));
    },
  };

  refresh();
})();
