"use strict";

// ── Ticket card ────────────────────────────────────────────────────────
// The flip-card ticket form. Pure UI: it draws the ticket, owns the fields
// and the flip, and reports changes. It never talks to the server, so the
// same card runs the real "Create your ticket" screen (tutorial.js, which
// adds the word filter, username checks and WS_Ticket.request) and the
// fake one on /pages/ticket-preview/.
//
// LOOK: pure CSS (css/ticket.css), styled like the tutorial's modals. Both
// faces share one grid cell, so the card is as tall as the taller face and
// the flip never resizes it. There is no sprite art to load.
//
//   FRONT  username · password (+ eye) · blocker · role
//          — all four are needed before the ticket can be flipped.
//   BACK   ticket id (top left) · role (top right) · profile picture (left,
//          pick one from the tray under the card; it becomes the person's
//          profile picture, so the tutorial doesn't ask for one again) ·
//          username (under the picture) · the chosen blocker + reason (right).
//
// Pass the card a <div> to live in:
//
//   const tk = WS_TicketCard.create(mount, {
//     images: [...profile picture urls],   // the tray; an upload tile is added
//     defaultPic: "…",                     // shown if nothing's chosen (optional)
//     blockers: [...], roles: [...],       // optional overrides of the lists below
//     values: { user, pass, blocker, role, pic, reason },   // optional start values
//     validateFront(v) -> "" | "message",  // optional; default checks are below
//     validateBack(v)  -> "" | "message",
//     onChange(v, side),                   // any edit, or a flip
//     onSubmit(side),                      // Enter on the front / Ctrl+Enter on the back
//   });
//
//   tk.values()          -> { user, pass, blocker, role, pic, reason }
//   tk.side()            -> "front" | "back"
//   tk.flip(side?)       -> flips (or goes to `side`); inert-guards the hidden face
//   tk.setId("#12345678")   shows an id on the back ("#--------" until then)
//   tk.rollId("#12345678")  same, with a short slot-machine reveal
//   tk.problem()         -> the current face's validation message ("" = good)
//   tk.lock(true|false)  disable every field (while a request is in flight)
//   tk.focus()           focus the first field on the visible face
//   tk.fit()             kept for older callers; the layout is fluid, so it does nothing
//   tk.destroy()
//
// WS_TicketCard.randomId() -> "#" + 8 random letters/digits (the preview page uses it).
// WS_TicketCard.ready      -> resolves once ticket.css is loaded (this file adds
//                             the <link> itself if the page didn't).
(() => {
  const SELF    = (document.currentScript && document.currentScript.src) || "";
  const CSS_URL = SELF ? new URL("../css/ticket.css", SELF).href : "";

  // What a "blocker" is: the web filter the person is behind at school.
  const BLOCKERS = ["GoGuardian", "Securly", "Lightspeed", "Linewize", "Blocksi", "iBoss", "ContentKeeper", "Other", "None"];
  const ROLES    = ["normie", "tester", "contributor"];
  const ID_LEN = 8;

  // Usernames: 3-20 of A-Z a-z 0-9 _ . -, starting with a letter or number
  // (same rule as the server and tutorial.js).
  const USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{2,19}$/;

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const reduceMotion = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  // ── stylesheet ───────────────────────────────────────────────────────
  const ready = new Promise((resolve) => {
    if (!CSS_URL) return resolve();
    const have = [...document.querySelectorAll('link[rel="stylesheet"]')].some((l) => /(^|\/)ticket\.css(\?|$)/.test(l.getAttribute("href") || ""));
    if (have) return resolve();
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = CSS_URL;
    link.onload = link.onerror = () => resolve();
    document.head.appendChild(link);
  });

  // Same alphabet and length as the ids the server hands out (data.gs).
  const ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  function randomId(len = ID_LEN) {
    const b = new Uint32Array(len);
    crypto.getRandomValues(b);
    return "#" + Array.from(b, (n) => ID_CHARS[n % ID_CHARS.length]).join("");
  }
  const withHash = (id) => { id = String(id == null ? "" : id).trim(); return id ? (id[0] === "#" ? id : "#" + id) : "#--------"; };
  const cap = (s) => s ? s[0].toUpperCase() + s.slice(1) : s;

  function create(mount, opts = {}) {
    const o = {
      images: [], defaultPic: "", blockers: BLOCKERS, roles: ROLES,
      userMax: 20, passMin: 6, passMax: 64, reasonMax: 800,
      ...opts,
    };
    const v = { user: "", pass: "", blocker: "", role: "", pic: "", reason: "", ...(opts.values || {}) };
    let side = "front";
    let idText = "#--------";
    let rollTimer = 0;

    const el = document.createElement("div");
    el.className = "tk";
    el.dataset.side = "front";
    el.innerHTML = `
      <div class="tk-stage">
        <div class="tk-card">
          <div class="tk-face tk-front">
            <div class="tk-head"><span class="tk-brand">WannaSmile</span><span class="tk-stub">ACCOUNT</span></div>
            <div class="tk-body">
              <label class="tk-field"><span class="tk-lab">Username</span>
                <input class="tk-in" data-f="user" type="text" maxlength="${o.userMax}" placeholder="username" aria-label="Username" autocomplete="off" autocapitalize="off" spellcheck="false" />
              </label>
              <div class="tk-field"><span class="tk-lab">Password</span>
                <div class="tk-pass">
                  <input class="tk-in" data-f="pass" type="password" maxlength="${o.passMax}" placeholder="password" aria-label="Password" autocomplete="new-password" spellcheck="false" />
                  <button type="button" class="tk-eye" aria-label="Show password" aria-pressed="false">show</button>
                </div>
              </div>
              <label class="tk-field"><span class="tk-lab">Blocker <small>(your web filter)</small></span>
                <select class="tk-in tk-sel" data-f="blocker" aria-label="Blocker (the web filter you're behind)">
                  <option value="">pick…</option>${o.blockers.map((b) => `<option value="${esc(b)}">${esc(b)}</option>`).join("")}
                </select>
              </label>
              <label class="tk-field"><span class="tk-lab">Role</span>
                <select class="tk-in tk-sel" data-f="role" aria-label="Role">
                  <option value="">pick…</option>${o.roles.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join("")}
                </select>
              </label>
            </div>
          </div>
          <div class="tk-face tk-back">
            <div class="tk-head"><span class="tk-txt tk-id"></span><span class="tk-txt tk-banner"></span></div>
            <div class="tk-body">
              <div class="tk-who">
                <button type="button" class="tk-photo" aria-label="Choose your profile picture"><img alt="" hidden /><span class="tk-photo-hint"><b aria-hidden="true">＋</b>pick a picture below</span></button>
                <span class="tk-txt tk-name"></span>
              </div>
              <div class="tk-note">
                <span class="tk-txt tk-chip" hidden></span>
                <label class="tk-lab" for="tkReason">Why do you want in? <small>(optional)</small></label>
                <textarea id="tkReason" class="tk-in tk-reason" data-f="reason" maxlength="${o.reasonMax}" placeholder="Who sent you? Tell us a bit." spellcheck="true"></textarea>
              </div>
            </div>
          </div>
        </div>
      </div>
      <p class="tk-tray-note" id="tkTrayNote">Pick your profile picture</p>
      <div class="tk-tray" role="radiogroup" aria-labelledby="tkTrayNote"></div>
      <input class="tk-upload" type="file" accept="image/*" hidden />`;
    mount.appendChild(el);

    const $  = (s) => el.querySelector(s);
    const front = $(".tk-front"), back = $(".tk-back");
    const tray = $(".tk-tray"), upload = $(".tk-upload");
    const photo = $(".tk-photo"), photoImg = photo.querySelector("img");
    const f = {
      user: $('[data-f="user"]'), pass: $('[data-f="pass"]'),
      blocker: $('[data-f="blocker"]'), role: $('[data-f="role"]'),
      reason: $('[data-f="reason"]'),
    };
    const eye = $(".tk-eye");

    f.user.value = v.user; f.pass.value = v.pass; f.blocker.value = v.blocker;
    f.role.value = v.role; f.reason.value = v.reason;

    // The layout is fluid (CSS), so there is nothing to measure.
    const fit = () => {};

    // ── avatar tray
    const tiles = [];
    const addTile = (src, label, isUpload) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tk-av" + (isUpload ? " is-upload" : "");
      b.setAttribute("role", "radio");
      b.setAttribute("aria-label", label);
      if (isUpload) b.innerHTML = `<span aria-hidden="true">＋</span><span class="tk-av-t">Upload</span>`;
      else { const i = new Image(); i.alt = ""; i.src = src; i.loading = "lazy"; b.appendChild(i); b.dataset.src = src; }
      tray.appendChild(b);
      tiles.push(b);
      return b;
    };
    o.images.forEach((src, i) => addTile(src, `Picture ${i + 1}`, false));
    const uploadTile = addTile("", "Upload your own picture", true);

    const markChosen = () => {
      tiles.forEach((t) => {
        const on = t.dataset.src ? t.dataset.src === v.pic : (!!v.pic && !o.images.includes(v.pic));
        t.classList.toggle("is-chosen", on);
        t.setAttribute("aria-checked", String(on));
        t.tabIndex = on || (!v.pic && t === tiles[0]) ? 0 : -1;
      });
      if (v.pic && !o.images.includes(v.pic)) {
        uploadTile.style.backgroundImage = `url("${v.pic}")`;
        uploadTile.classList.add("has-image");
      }
    };

    // ── drawing the back
    const render = () => {
      $(".tk-id").textContent = idText;
      const roleTxt = cap(v.role) || "Role";
      $(".tk-banner").textContent = roleTxt;
      $(".tk-banner").classList.toggle("is-empty", !v.role);
      const chip = $(".tk-chip");
      chip.hidden = !v.blocker;
      chip.textContent = v.blocker;
      const name = v.user || "Username";
      $(".tk-name").textContent = name;
      $(".tk-name").classList.toggle("is-empty", !v.user);
      const src = v.pic || "";
      photoImg.hidden = !src;
      if (src) photoImg.src = src;
      photo.classList.toggle("has-pic", !!src);
      markChosen();
    };

    // ── validation (hosts can replace both)
    const defFront = (x) =>
        !x.user ? "Pick a username."
      : x.user.length < 3 ? "Usernames are at least 3 characters."
      : !USERNAME_RE.test(x.user) ? "Use only letters, numbers, _ . or - (and start with a letter or number)."
      : !x.pass ? "Pick a password."
      : x.pass.length < o.passMin ? `Passwords are at least ${o.passMin} characters.`
      : !x.blocker ? "Pick your blocker."
      : !x.role ? "Pick your role."
      : "";
    const defBack = (x) => !x.pic ? "Pick a profile picture." : "";
    const problem = () => (side === "front"
      ? (o.validateFront || defFront)(api.values())
      : (o.validateBack || defBack)(api.values())) || "";

    const changed = () => { render(); o.onChange?.(api.values(), side); };

    el.addEventListener("input", (e) => {
      const k = e.target.dataset && e.target.dataset.f;
      if (!k) return;
      v[k] = k === "user" ? e.target.value.trim() : e.target.value;
      changed();
    });
    el.addEventListener("change", (e) => {
      const k = e.target.dataset && e.target.dataset.f;
      if (!k) return;
      v[k] = k === "user" ? e.target.value.trim() : e.target.value;
      changed();
    });
    el.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const t = e.target;
      if (t.tagName === "INPUT" && t.type !== "file") { e.preventDefault(); o.onSubmit?.(side); }
      else if (t.tagName === "TEXTAREA" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); o.onSubmit?.(side); }
    });

    eye.addEventListener("click", () => {
      const show = f.pass.type === "password";
      f.pass.type = show ? "text" : "password";
      eye.setAttribute("aria-pressed", String(show));
      eye.setAttribute("aria-label", show ? "Hide password" : "Show password");
      eye.textContent = show ? "hide" : "show";
      f.pass.focus({ preventScroll: true });
    });

    const choose = (src) => { v.pic = src; changed(); };
    tray.addEventListener("click", (e) => {
      const t = e.target.closest(".tk-av");
      if (!t) return;
      if (t === uploadTile) { upload.click(); return; }
      choose(t.dataset.src);
    });
    tray.addEventListener("keydown", (e) => {
      const i = tiles.indexOf(document.activeElement);
      if (i < 0) return;
      const cols = getComputedStyle(tray).gridTemplateColumns.split(" ").length || 1;
      const d = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
      if (!d) return;
      e.preventDefault(); e.stopPropagation();
      tiles[Math.max(0, Math.min(tiles.length - 1, i + d))].focus();
    });
    photo.addEventListener("click", () => {
      const t = tiles.find((x) => x.classList.contains("is-chosen")) || tiles[0];
      t.scrollIntoView({ block: "nearest", behavior: reduceMotion() ? "auto" : "smooth" });
      t.focus({ preventScroll: true });
    });

    // Uploads are centre-cropped to a 300×300 square (same as profile.js).
    upload.addEventListener("change", () => {
      const file = upload.files && upload.files[0];
      upload.value = "";
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const s = Math.min(img.width, img.height);
          const c = document.createElement("canvas");
          c.width = c.height = 300;
          c.getContext("2d").drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 300, 300);
          choose(c.toDataURL("image/png"));
        };
        img.onerror = () => o.onError?.("That file couldn't be read as an image. Try a PNG, JPG or GIF.");
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });

    // ── the flip
    const setSide = (to) => {
      side = to;
      el.dataset.side = to;
      el.classList.toggle("is-back", to === "back");
      front.inert = to === "back";
      back.inert  = to === "front";
      tray.inert  = to === "front";
    };
    setSide("front");

    const api = {
      el,
      values: () => ({ ...v }),
      side: () => side,
      problem,
      flip(to) {
        to = to || (side === "front" ? "back" : "front");
        if (to === side) return;
        setSide(to);
        render();
        o.onChange?.(api.values(), side);
        const wait = reduceMotion() ? 0 : 420;   // land the focus when the card is half-way round
        setTimeout(() => api.focus(), wait);
      },
      focus() {
        if (side === "front") (v.user ? (v.pass ? f.blocker : f.pass) : f.user).focus({ preventScroll: true });
        else (v.pic ? f.reason : photo).focus({ preventScroll: true });
      },
      setId(text) { clearInterval(rollTimer); idText = withHash(text); render(); },
      rollId(text) {
        clearInterval(rollTimer);
        const target = withHash(text);
        if (reduceMotion()) { idText = target; render(); return; }
        const digits = target.slice(1);
        let lock = 0;
        rollTimer = setInterval(() => {
          lock += 0.5;                               // one more character settles every other tick
          idText = "#" + [...digits].map((ch, i) => (i < lock ? ch : ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)])).join("");
          render();
          if (lock >= digits.length) { clearInterval(rollTimer); idText = target; render(); }
        }, 60);
      },
      lock(on) {
        el.classList.toggle("is-locked", !!on);
        el.querySelectorAll("input, select, textarea, button").forEach((n) => { n.disabled = !!on; });
      },
      fit,
      destroy() { clearInterval(rollTimer); el.remove(); },
    };

    render();
    return api;
  }

  window.WS_TicketCard = { create, randomId, ready, BLOCKERS, ROLES, USERNAME_RE };
})();
