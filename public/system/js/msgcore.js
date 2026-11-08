"use strict";

// ── WS_Msg: site-wide messaging ────────────────────────────────────────
// Loaded on index.html and on the chat page. It is the one place that knows
// about unread messages, "someone is typing", message notifications and the
// profile pictures/names shown in chat, so every page agrees.
//
//  • Chat activity and profiles come from the global-chat Worker
//    (window.WS_ENDPOINTS.chat):
//      GET  ?type=chat          friends, last message per friend, and
//                               typing: [friends typing to you] + typingLeft
//                               (real activity, posted by their chat page)
//      GET  ?type=chatprofiles  display name + 50px avatar of you and friends
//      POST type "chat"/"profile" to send typing and to share your avatar.
//    Typing-status quote templates come from system/json/quotes.json.
//    On the chat page chat.js already polls, so it hands every answer to
//    WS_Msg.ingest(); anywhere else this file polls (a small cached answer
//    when nothing changed) and shares what it finds with the other open tabs
//    through localStorage.
//  • Unread = a friend's latest message is not yours and newer than the
//    "seen" marker kept per browser (ws_chat_seen, written by markSeen()).
//    Opening the conversation (chat page, tab visible and focused) clears it
//    in every tab; notification cards for that friend go away with it.
//  • The DM button (#openDm) swaps to https://raw.githubusercontent.com/securlydetected/assets/refs/heads/main/header-icons/dmed.png while
//    anything is unread. If that file isn't there it keeps the normal icon and
//    shows a badge with the count instead.
//  • Notifications are cards in the corner. Clicking one opens that
//    conversation on the chat page in its own tab (named "wannachat", so it
//    is reused) and leaves the library you were browsing alone.
(() => {
  if (window.WS_Msg) return;

  const API = window.WS_ENDPOINTS && window.WS_ENDPOINTS.chat;
  const SCRIPT_SRC = (document.currentScript && document.currentScript.src) || location.href;
  const ROOT = new URL("../../", SCRIPT_SRC).href;
  const CHAT_URL = ROOT + "system/pages/chat/index.html";
  const UNREAD_ICON = "https://raw.githubusercontent.com/securlydetected/assets/refs/heads/main/header-icons/dmed.png";   // unread state; dm.png is the normal state
  const DEFAULT_PIC = "https://raw.githubusercontent.com/bguhm/bguhm.github.io/main/system/images/profile.png";
  const IS_CHAT_PAGE = /\/pages\/chat\//.test(location.pathname);

  const K = {
    id: "ws_ticket_id", key: "ws_ticket_key", status: "ws_ticket_status", user: "ws_username",
    seen: "ws_chat_seen", notified: "ws_msg_notified", state: "ws_msg_state", pollAt: "ws_msg_poll",
    profiles: "ws_chat_profiles", sig: "ws_msg_profile_sig", publicSig: "ws_public_profile_sig",
  };
  const NAME_RE = /^[a-z0-9][a-z0-9_.\-]{2,19}$/;

  const POLL_FAST = 4000;       // something is happening (typing / new message)
  const POLL_IDLE = 8000;       // tab in front (shorter than a typing flag lives, so a burst is never missed)
  const POLL_HIDDEN = 60000;    // tab hidden
  const POLL_MAX = 120000;
  const TYPING_HOLD = 6000;     // used only if the server doesn't say how long a flag has left
  const NOTIFY_WINDOW = 10 * 60000;   // only announce messages this fresh
  const PROFILES_TTL = 5 * 60000;
  const MAX_CARDS = 3;

  const read = (k) => { try { return localStorage.getItem(k) || ""; } catch (_) { return ""; } };
  const write = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };
  const profileRead = (k) => {
    try { return window.WS_ProfileStorage ? window.WS_ProfileStorage.get(k) || "" : read(k); }
    catch (_) { return ""; }
  };
  const profileHas = (k) => {
    try { return window.WS_ProfileStorage ? window.WS_ProfileStorage.has(k) : !!read(k); }
    catch (_) { return false; }
  };
  const json = (k, fallback) => {
    try { const v = JSON.parse(read(k) || "null"); return v && typeof v === "object" ? v : fallback; } catch (_) { return fallback; }
  };
  const lc = (v) => String(v == null ? "" : v).trim().replace(/^@/, "").toLowerCase();
  const visible = () => document.visibilityState === "visible";

  const S = {
    me: "", friends: [], incoming: 0, rev: "",
    typing: new Map(),                 // name -> { until, text }
    profiles: json(K.profiles, {}),    // name -> { d: display name, u: updated, a: avatar data URL }
    quotes: null,                      // typing quotes (array) once loaded
    viewing: "",                       // conversation open on the chat page
    loading: false, fails: 0, timer: 0, fastUntil: 0, dead: false,
    profilesAt: 0, profilesBusy: false, typingTimer: 0,
    listeners: new Set(), cards: new Map(), unreadAsset: null, onOpen: null,
  };

  const active = () => !!API && read(K.status) === "approved" && !!read(K.id) && !!read(K.key);
  const creds = () => ({ ticket: read(K.id), key: read(K.key) });
  const seen = () => json(K.seen, {});

  // ── network ───────────────────────────────────────────────────────────
  async function get(type, extra) {
    const qs = new URLSearchParams({ type, ...creds(), ...extra, _: Date.now() });
    const res = await fetch(`${API}?${qs}`, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }
  async function post(type, body) {
    // Send JSON without custom headers; the Worker accepts this simple request.
    const res = await fetch(API, { method: "POST", cache: "no-store", body: JSON.stringify({ type, ...creds(), ...body }) });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  // ── unread ────────────────────────────────────────────────────────────
  function unreadFriends() {
    const s = seen();
    return S.friends.filter((f) => f.status === "friend" && f.last && f.last.from !== S.me && f.last.ts > (s[f.name] || 0));
  }

  function markSeen(name, ts) {
    if (!name || !ts) return;
    const s = seen();
    if ((s[name] || 0) >= ts) return;
    s[name] = ts;
    write(K.seen, JSON.stringify(s));
    dropCards(name);
    render();
  }

  // ── names and pictures ────────────────────────────────────────────────
  const myName = () => S.me || lc(read(K.user));
  const ownNick = () => {
    const n = profileRead("nickname").trim();
    return (n && n.toLowerCase() !== myName() ? n : "") || S.profiles[myName()]?.d || "";
  };

  function displayName(name) {
    const n = lc(name);
    if (n === myName()) return ownNick() || n;
    const p = S.profiles[n];
    return (p && p.d) || n;
  }

  // Pixelated copy of a picture (same look as the profile card), cached per source.
  const pixelCache = new Map();
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      if (!/^data:/.test(src)) img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }
  async function square(src, size, blocks) {
    const img = await loadImage(src);
    const s = Math.min(img.naturalWidth, img.naturalHeight) || size;
    const sx = (img.naturalWidth - s) / 2, sy = (img.naturalHeight - s) / 2;
    const out = document.createElement("canvas");
    out.width = out.height = size;
    const ctx = out.getContext("2d");
    if (blocks) {
      const small = document.createElement("canvas");
      small.width = small.height = blocks;
      small.getContext("2d").drawImage(img, sx, sy, s, s, 0, 0, blocks, blocks);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(small, 0, 0, blocks, blocks, 0, 0, size, size);
    } else {
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, sx, sy, s, s, 0, 0, size, size);
    }
    return out;
  }

  // The signed-in person's own picture, exactly as the profile card saved it.
  // Same value the profile card shows. Saved picks can be data URLs, full URLs,
  // old mediabase/site paths (endpoints.js maps those) or a path relative to the
  // site root; the chat page lives three folders down, so make it absolute.
  function absolutePic(src) {
    let v = String(src || "").trim();
    if (!v) return "";
    if (typeof window.toMediabase === "function") v = window.toMediabase(v);
    if (/^(data:|https?:|blob:|\/\/)/i.test(v)) return v;
    try { return new URL(v.replace(/^site:/i, ""), ROOT).href; } catch (_) { return ""; }
  }
  const ownPic = () => absolutePic(profileRead("profilePic")) || absolutePic(S.profiles[myName()]?.a) || DEFAULT_PIC;
  const ownPixelated = () => profileRead("pfpPixelated") === "true";

  function fillAvatar(box, name) {
    const n = lc(name);
    box.textContent = "";
    const initial = () => { box.textContent = (displayName(n) || "?").charAt(0).toUpperCase(); box.classList.add("ws-av-initial"); };
    box.classList.remove("ws-av-initial");
    let src = "";
    let pixel = false;
    if (n === myName()) { src = ownPic(); pixel = ownPixelated(); }
    else { const p = S.profiles[n]; src = (p && p.a) || ""; }
    if (!src) return initial();
    const img = document.createElement("img");
    img.alt = "";
    img.draggable = false;
    img.addEventListener("error", () => { if (img.isConnected) initial(); });
    img.src = src;
    box.append(img);
    if (pixel) {
      const hit = pixelCache.get(src);
      if (hit) img.src = hit;
      else square(src, 96, 32).then((c) => { const d = c.toDataURL("image/png"); pixelCache.set(src, d); img.src = d; }).catch(() => {});
    }
  }

  // <span class="ws-av"> with the picture (or the first letter) inside.
  function avatar(name, extraClass) {
    const box = document.createElement("span");
    box.className = "ws-av" + (extraClass ? " " + extraClass : "");
    box.dataset.wsAvatar = lc(name);
    fillAvatar(box, name);
    return box;
  }
  function refreshAvatars(root) {
    (root || document).querySelectorAll("[data-ws-avatar]").forEach((box) => fillAvatar(box, box.dataset.wsAvatar));
  }
  function setPublicAvatar(name, value) {
    const n = lc(name);
    if (!NAME_RE.test(n)) return;
    const image = String(value || "").trim();
    const safeImage = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/i.test(image)
      ? image
      : (() => {
          try { const url = new URL(image); return url.protocol === "https:" ? url.href : ""; }
          catch (_) { return ""; }
        })();
    const previous = S.profiles[n] || {};
    if (previous.a === safeImage) return;
    S.profiles[n] = { ...previous, a: safeImage };
    write(K.profiles, JSON.stringify(S.profiles));
    refreshAvatars();
  }

  // ── profiles of friends (display name + avatar) ───────────────────────
  async function loadProfiles(force) {
    if (!active() || S.profilesBusy) return;
    const names = S.friends.filter((f) => f.status === "friend").map((f) => f.name);
    if (!names.length && !S.me) return;
    const missing = names.some((n) => !S.profiles[lc(n)]);
    if (!force && !missing && Date.now() - S.profilesAt < PROFILES_TTL) return;
    S.profilesBusy = true;
    try {
      const known = Object.keys(S.profiles).map((n) => n + "~" + (S.profiles[n].u || "")).join("|");
      const data = await get("chatprofiles", { known });
      if (!data || data.ok !== true || !Array.isArray(data.profiles)) return;
      S.profilesAt = Date.now();
      for (const p of data.profiles) {
        const n = lc(p.name);
        if (!n) continue;
        const prev = S.profiles[n] || {};
        S.profiles[n] = { d: p.displayName || prev.d || "", u: p.updated || "", a: p.same ? (prev.a || "") : (p.avatar || "") };
      }
      write(K.profiles, JSON.stringify(S.profiles));
      refreshAvatars();
      emit();
    } catch (_) {
      /* names and letters are fine until the next try */
    } finally {
      S.profilesBusy = false;
    }
  }

  // Share this browser's picture + nickname with friends. The picture is cut to
  // 50x50 WebP here; the server re-checks type, size and the real pixel size.
  let syncing = false;
  const hash = (str) => { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0; return h.toString(36); };

  async function publishPublicProfile(profile) {
    if (!active()) return { ok: false, error: "Sign in to publish your profile to global chat." };
    let encoded;
    try { encoded = JSON.stringify(profile); }
    catch (error) {
      console.error("[WS_Msg] Could not serialize the public profile:", error);
      return { ok: false, error: "The profile could not be published." };
    }
    if (!profile || typeof profile !== "object" || Array.isArray(profile) || typeof encoded !== "string" || encoded.length > 60000) {
      return { ok: false, error: "The profile is invalid or too large to publish." };
    }
    const result = await post("profile", { action: "public_save", profile });
    if (!result || result.ok !== true) return { ok: false, error: result?.error || "The profile could not be published." };
    write(K.publicSig, hash(myName() + "\n" + encoded));
    return { ok: true };
  }

  async function recordPublicActivity(rawUrl) {
    let url;
    try { url = new URL(String(rawUrl || "").trim()); }
    catch { return { ok: false, error: "Invalid activity link." }; }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !url.hostname) {
      return { ok: false, error: "Invalid activity link." };
    }

    const activityUrl = url.href;
    const current = json("ws_recent_opens", []);
    const recent = (Array.isArray(current) ? current : [])
      .filter((entry) => entry && typeof entry.url === "string" && Number.isFinite(entry.t) && entry.url !== activityUrl);
    recent.unshift({ url: activityUrl, t: Date.now() });
    write("ws_recent_opens", JSON.stringify(recent.slice(0, 6)));

    if (!active()) return { ok: false, error: "Sign in to sync public activity." };
    let profile = {};
    try { profile = JSON.parse(profileRead("ws_profile_style_main") || "{}"); }
    catch (error) {
      console.error("[WS_Msg] Saved profile data is invalid; public activity was not synced:", error);
      return { ok: false, error: "The saved profile is invalid." };
    }
    if (profile?.actShow === false) return { ok: false, error: "Activity sharing is disabled." };
    try {
      const result = await post("profile", { action: "activity_save", url: activityUrl });
      if (!result || result.ok !== true) {
        console.error("[WS_Msg] Public activity sync failed:", result?.error || "Unexpected response.");
        return { ok: false, error: result?.error || "The activity could not be synced." };
      }
      return { ok: true };
    } catch (error) {
      console.error("[WS_Msg] Public activity sync failed:", error);
      return { ok: false, error: "The activity could not be synced." };
    }
  }

  async function clearPublicActivity() {
    if (!active()) return { ok: false, error: "Sign in to clear public activity." };
    try {
      const result = await post("profile", { action: "activity_clear" });
      if (!result || result.ok !== true) {
        console.error("[WS_Msg] Public activity clear failed:", result?.error || "Unexpected response.");
        return { ok: false, error: result?.error || "Public activity could not be cleared." };
      }
      return { ok: true };
    } catch (error) {
      console.error("[WS_Msg] Public activity clear failed:", error);
      return { ok: false, error: "Public activity could not be cleared." };
    }
  }

  async function syncSavedPublicProfile() {
    const raw = profileRead("ws_profile_style_main");
    if (!raw) return;
    let profile;
    try { profile = JSON.parse(raw); }
    catch (error) {
      console.error("[WS_Msg] Saved profile data is invalid and was not published:", error);
      return;
    }
    if (read(K.publicSig) === hash(myName() + "\n" + JSON.stringify(profile))) return;
    const result = await publishPublicProfile(profile);
    if (!result.ok) console.error("[WS_Msg] Public profile sync failed:", result.error);
  }

  async function syncProfile() {
    if (!active() || syncing) return;
    const pic = profileRead("profilePic");
    const pixel = ownPixelated();
    const nick = ownNick();
    const user = myName();
    const sig = hash([user, pic, pixel, nick].join("\n"));
    if (profileStoreIsScoped() && !["profilePic", "nickname", "pfpPixelated"].some(profileHas)) return true;
    if (read(K.sig) === sig) return true;
    syncing = true;
    try {
      // Cut the picture first. A picture that can't be cut (another site won't
      // share it, or this browser can't write WebP) just means friends see the
      // first letter of your name; the nickname is still shared.
      let url = "";
      if (pic) {
        try {
          const canvas = await square(pic, 50, pixel ? 32 : 0);
          for (const q of [0.85, 0.7, 0.5, 0.3]) {
            url = canvas.toDataURL("image/webp", q);
            if (url.length <= 44000) break;
          }
          if (!/^data:image\/webp;base64,/.test(url) || url.length > 44000) url = "";
        } catch (_) { url = ""; }
      }
      let r = await post("profile", { action: "save", displayName: nick });
      if (!r || r.ok !== true) throw new Error("save");
      if (!pic || !url) r = await post("profile", { action: "avatar_remove", variant: "50" });
      else r = await post("profile", { action: "avatar", variant: "50", dataUrl: url });
      if (!r || r.ok !== true) throw new Error("avatar");
      write(K.sig, sig);
      S.profiles[user] = { ...(S.profiles[user] || {}), d: nick, a: url, u: String(Date.now()) };
      write(K.profiles, JSON.stringify(S.profiles));
      refreshAvatars();
      S.profilesAt = 0;
      return true;
    } catch (_) {
      console.error("[WS_Msg] Could not sync the signed-in profile picture.");
      return false;
    } finally {
      syncing = false;
    }
  }
  function profileStoreIsScoped() {
    return !!window.WS_ProfileStorage?.isAccountScoped();
  }

  // ── typing quotes ─────────────────────────────────────────────────────
  // Templates, one per entry in system/json/quotes.json:
  //   (someone) (is-typing)...      -> "<display name> is typing..."
  //   (is-typing)...                -> "<display name> is typing..."
  //   ankom studios (is-typing)...  -> a personal line, used only when
  //                                    "ankom studios" (a display name or
  //                                    username) is the one typing
  //   (someone) is cooking...       -> any friend; (is-typing) is optional
  // (someone) = display name, (is-typing) = "is typing". A line that fits
  // none of those (text about somebody else) is skipped. No usable line, or
  // an empty column: "<name> is typing...".
  const TYPING_WORD = "is typing";
  const TOKEN_SOMEONE = /\(someone\)/gi;
  const TOKEN_TYPING = /\(is-typing\)/gi;

  function startsWithName(line, ...names) {
    const l = line.toLowerCase();
    return names.some((n) => {
      n = String(n || "").toLowerCase();
      return n && l.startsWith(n) && !/[a-z0-9]/.test(l.charAt(n.length) || " ");
    });
  }

  function composeTyping(name) {
    const user = lc(name);
    const shown = displayName(user);
    const generic = [], personal = [];
    for (const raw of S.quotes || []) {
      const t = String(raw == null ? "" : raw).replace(/\s+/g, " ").trim().slice(0, 140);
      if (!t) continue;
      if (/\(someone\)/i.test(t)) generic.push(t);
      else if (/^\(is-typing\)/i.test(t)) generic.push("(someone) " + t);
      else if (startsWithName(t, shown, user)) personal.push(t);
    }
    const pool = personal.concat(generic);
    const line = pool.length ? pool[Math.floor(Math.random() * pool.length)] : "(someone) (is-typing)...";
    return line.replace(TOKEN_SOMEONE, () => shown).replace(TOKEN_TYPING, TYPING_WORD);
  }

  async function loadQuotes() {
    if (S.quotes !== null) return;
    try {
      const response = await fetch(new URL("system/json/quotes.json", ROOT), { cache: "no-cache" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data?.typingQuotes)) {
        throw new Error("quotes.json must contain a typingQuotes array.");
      }
      S.quotes = data.typingQuotes.filter((line) => typeof line === "string" && line.trim());
    } catch (error) {
      console.error("[WS_Msg] Failed to load local typing quotes:", error);
      S.quotes = [];
    }
  }

  // Text shown for someone who is typing right now; picked once per typing spell.
  function typingText(name) {
    const e = S.typing.get(lc(name));
    if (!e) return "";
    if (e.text == null) e.text = composeTyping(name);
    return e.text;
  }
  const typingNames = () => Array.from(S.typing.keys());
  const isTyping = (name) => S.typing.has(lc(name));

  function summaryTyping() {
    const names = typingNames();
    if (!names.length) return "";
    if (names.length === 1) return typingText(names[0]);
    if (names.length === 2) return `${displayName(names[0])} and ${displayName(names[1])} are typing...`;
    return "Several people are typing...";
  }

  function applyTyping(list, left) {
    if (!Array.isArray(list)) return;
    const now = Date.now();
    const keep = new Set(list.map(lc).filter((n) => NAME_RE.test(n)));
    for (const n of Array.from(S.typing.keys())) if (!keep.has(n)) S.typing.delete(n);
    keep.forEach((n) => {
      // The server says how long each flag has left; trust that over a guess.
      const ms = left && Number(left[n]) > 0 ? Math.min(Number(left[n]) + 300, 12000) : TYPING_HOLD;
      const cur = S.typing.get(n);
      if (cur) cur.until = now + ms;
      else S.typing.set(n, { until: now + ms, text: null });
    });
    if (keep.size) S.fastUntil = now + 30000;
    clearTimeout(S.typingTimer);
    if (S.typing.size) {
      const next = Math.min(...Array.from(S.typing.values()).map((e) => e.until)) - now;
      S.typingTimer = setTimeout(expireTyping, Math.max(250, next + 50));
    }
  }

  function expireTyping() {
    const now = Date.now();
    let changed = false;
    for (const [n, e] of Array.from(S.typing.entries())) if (e.until <= now) { S.typing.delete(n); changed = true; }
    if (S.typing.size) {
      const next = Math.min(...Array.from(S.typing.values()).map((e) => e.until)) - now;
      S.typingTimer = setTimeout(expireTyping, Math.max(250, next + 50));
    }
    if (changed) render();
  }

  // Tell friends you are typing: throttled by the caller, fire and forget.
  function sendTyping(to) {
    const n = lc(to);
    if (!active() || !NAME_RE.test(n)) return;
    post("chat", { action: "typing", to: n }).catch(() => {});
  }

  // ── taking in what the server says ────────────────────────────────────
  function ingest(data, opts) {
    if (!data || data.ok !== true) return;
    if (opts && opts.viewing !== undefined) S.viewing = lc(opts.viewing);
    if (data.me) S.me = data.me;
    if (data.rev) S.rev = data.rev;
    applyTyping(data.typing, data.typingLeft);
    if (!data.unchanged && Array.isArray(data.friends)) {
      S.friends = data.friends;
      S.incoming = data.friends.filter((f) => f.status === "incoming").length;
      write(K.state, JSON.stringify({ me: S.me, at: Date.now(), friends: data.friends.map((f) => ({ name: f.name, status: f.status, last: f.last ? { from: f.last.from, text: String(f.last.text || "").slice(0, 80), ts: f.last.ts } : null })) }));
      loadProfiles(false);
    }
    settle();
  }

  // Another tab polled: take its friends list instead of asking again.
  function loadShared() {
    const sh = json(K.state, null);
    if (!sh || !Array.isArray(sh.friends)) return false;
    if (S.me && sh.me && sh.me !== S.me) return false;
    S.me = S.me || sh.me || "";
    S.friends = sh.friends;
    S.incoming = sh.friends.filter((f) => f.status === "incoming").length;
    return true;
  }

  function settle() {
    // Reading it right now = read.
    if (S.viewing && visible() && document.hasFocus()) {
      const f = S.friends.find((x) => x.name === S.viewing);
      if (f && f.last) markSeen(f.name, f.last.ts);
    }
    notifyNew();
    render();
  }

  // ── notifications ─────────────────────────────────────────────────────
  // Shown by the visible tab only, once per message (ws_msg_notified is shared by every tab).
  function notifyNew() {
    if (!visible() || !S.me) return;
    const first = read(K.notified) === "";
    const done = json(K.notified, {});
    const s = seen();
    const now = Date.now();
    let dirty = first;
    const fresh = [];

    for (const f of S.friends) {
      if (f.status === "friend" && f.last && f.last.from !== S.me) {
        const ts = f.last.ts;
        if (ts > (done[f.name] || 0)) {
          done[f.name] = ts; dirty = true;
          const readAlready = ts <= (s[f.name] || 0) || (f.name === S.viewing && document.hasFocus());
          if (!first && !readAlready && now - ts < NOTIFY_WINDOW) fresh.push({ key: "m:" + f.name, name: f.name, kind: "message", text: f.last.text });
        }
      } else if (f.status === "incoming" && !done["req:" + f.name]) {
        done["req:" + f.name] = 1; dirty = true;
        if (!first) fresh.push({ key: "r:" + f.name, name: f.name, kind: "request", text: "sent you a friend request" });
      }
    }
    if (dirty) write(K.notified, JSON.stringify(done));
    fresh.slice(0, MAX_CARDS).forEach(showCard);
  }

  function cardBox() {
    let box = document.getElementById("wsMsgCards");
    if (!box) {
      box = document.createElement("div");
      box.id = "wsMsgCards";
      box.setAttribute("role", "region");
      box.setAttribute("aria-label", "Message notifications");
      document.body.append(box);
    }
    return box;
  }

  function showCard(c) {
    ensureStyles();
    dropCard(c.key);
    const card = document.createElement("div");
    card.className = "ws-card";
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.dataset.wsFrom = c.name;
    const body = document.createElement("div");
    body.className = "ws-card-body";
    const who = document.createElement("b");
    who.textContent = displayName(c.name);
    const text = document.createElement("span");
    text.textContent = c.text || "";
    body.append(who, text);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "ws-card-x";
    close.setAttribute("aria-label", "Dismiss");
    close.textContent = "×";
    card.append(avatar(c.name), body, close);
    card.setAttribute("aria-label", `${displayName(c.name)}: ${c.text || ""}. Open chat`);

    const open = () => { dropCard(c.key); openChat(c.name); };
    card.addEventListener("click", (e) => { if (e.target === close) { e.stopPropagation(); dropCard(c.key); } else open(); });
    card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } else if (e.key === "Escape") dropCard(c.key); });
    let timer = setTimeout(() => dropCard(c.key), 9000);
    card.addEventListener("mouseenter", () => clearTimeout(timer));
    card.addEventListener("mouseleave", () => { clearTimeout(timer); timer = setTimeout(() => dropCard(c.key), 4000); });
    card._timer = () => clearTimeout(timer);

    S.cards.set(c.key, card);
    cardBox().append(card);
    const keys = Array.from(S.cards.keys());          // oldest first
    while (keys.length > MAX_CARDS) dropCard(keys.shift());
    requestAnimationFrame(() => card.classList.add("in"));
  }

  function dropCard(key) {
    const card = S.cards.get(key);
    if (!card) return;
    S.cards.delete(key);
    if (card._timer) card._timer();
    card.classList.remove("in");
    setTimeout(() => card.remove(), 200);
  }
  function dropCards(name) {
    for (const key of Array.from(S.cards.keys())) if (S.cards.get(key).dataset.wsFrom === name && key.startsWith("m:")) dropCard(key);
  }

  // Open a conversation. The chat page switches in place; everywhere else it
  // opens (or reuses) the chat tab, so browsing carries on in this one.
  function openChat(name) {
    const n = lc(name);
    if (S.onOpen) { S.onOpen(n); return; }
    const url = CHAT_URL + (n ? "#with=" + encodeURIComponent(n) : "");
    const w = window.open(url, "wannachat");
    if (!w && window.showToast) window.showToast("Pop-up blocked: allow pop-ups to open chat.", 3200);
  }

  // The DM button: the newest unread conversation if there is exactly one, else the inbox.
  function openFromButton() {
    const un = unreadFriends();
    openChat(un.length === 1 ? un[0].name : "");
  }

  // ── DM button + typing pill (index) ───────────────────────────────────
  function paintDm() {
    const btn = document.getElementById("openDm");
    if (!btn) return;
    const img = btn.querySelector("img");
    const count = unreadFriends().length;     // unread messages (a pending request is announced by a card)
    const on = count > 0;
    if (img && !img.dataset.normal) img.dataset.normal = img.getAttribute("src") || "";
    const swap = on && S.unreadAsset === true;
    if (img && img.dataset.normal) {
      const want = swap ? UNREAD_ICON : img.dataset.normal;
      if (img.getAttribute("src") !== want) img.setAttribute("src", want);
      // If dmed.png ever fails to load, fall back to dm.png + the count badge.
      if (!img.dataset.wsErr) {
        img.dataset.wsErr = "1";
        img.addEventListener("error", () => {
          if (img.getAttribute("src") === UNREAD_ICON) { S.unreadAsset = false; paintDm(); }
        });
      }
    }
    btn.classList.toggle("ws-has-unread", on);
    btn.classList.toggle("ws-unread-img", swap);
    btn.classList.toggle("ws-typing", S.typing.size > 0);
    if (on) btn.dataset.wsCount = count > 9 ? "9+" : String(count); else delete btn.dataset.wsCount;
    btn.setAttribute("aria-label", on ? `Open WannaChat (${count} new)` : "Open WannaChat");
    btn.title = S.typing.size ? summaryTyping() : on ? `Chat (${count} new)` : "Chat (DMs)";
  }

  function paintPill() {
    const btn = document.getElementById("openDm");
    let pill = document.getElementById("wsDmTyping");
    const text = btn ? summaryTyping() : "";
    if (!text) { if (pill) pill.hidden = true; return; }
    ensureStyles();
    if (!pill) {
      pill = document.createElement("div");
      pill.id = "wsDmTyping";
      pill.setAttribute("role", "status");
      pill.setAttribute("aria-live", "polite");
      const dots = document.createElement("span");
      dots.className = "ws-dots";
      dots.setAttribute("aria-hidden", "true");
      dots.innerHTML = "<i></i><i></i><i></i>";
      pill.append(dots, document.createElement("span"));
      document.body.append(pill);
    }
    pill.lastChild.textContent = text;
    pill.hidden = false;
    const r = btn.getBoundingClientRect();
    const w = pill.offsetWidth;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
    pill.style.left = left + "px";
    pill.style.top = Math.round(r.bottom + 8) + "px";
  }

  function render() {
    paintDm();
    paintPill();
    emit();
  }

  function emit() {
    const detail = { unread: unreadFriends().map((f) => f.name), incoming: S.incoming, typing: typingNames() };
    S.listeners.forEach((fn) => { try { fn(detail); } catch (_) {} });
    try { document.dispatchEvent(new CustomEvent("ws:msg", { detail })); } catch (_) {}
  }

  // ── polling (pages other than the chat page) ──────────────────────────
  function delay() {
    const now = Date.now();
    const base = document.hidden ? POLL_HIDDEN : now < S.fastUntil ? POLL_FAST : POLL_IDLE;
    return { base, wait: Math.min(POLL_MAX, base * Math.pow(2, Math.min(S.fails, 4))) };
  }

  function schedule() {
    clearTimeout(S.timer);
    if (S.dead || IS_CHAT_PAGE || !active()) return;
    S.timer = setTimeout(() => poll(false), delay().wait);
  }

  async function poll(force) {
    if (S.dead || IS_CHAT_PAGE || !active()) return;
    if (S.loading) return;
    // Another tab polled a moment ago: use what it found.
    if (!force && Date.now() - (Number(read(K.pollAt)) || 0) < delay().base * 0.6 && loadShared()) { settle(); return schedule(); }
    S.loading = true;
    write(K.pollAt, String(Date.now()));
    try {
      const data = await get("chat", { rev: S.rev });
      S.fails = 0;
      if (data && data.ok === true) ingest(data);
      else if (data && (data.code === "ticket" || data.error === "Ticket required.")) S.dead = true;
      else if (data && !data.error && !data.code) S.dead = true;
    } catch (_) {
      S.fails++;
    } finally {
      S.loading = false;
      schedule();
    }
  }

  // ── styles (shared by every page that has the module) ─────────────────
  let styled = false;
  function ensureStyles() {
    if (styled) return;
    styled = true;
    const css = `
#openDm { position: relative; }
#openDm.ws-has-unread:not(.ws-unread-img)::after {
  content: attr(data-ws-count); position: absolute; top: -4px; right: -6px; min-width: 16px; height: 16px; padding: 0 4px;
  border-radius: 999px; background: var(--accent-color, #f44); color: #fff; font: bold 10px/16px monospace; text-align: center;
  box-shadow: 0 0 0 2px rgba(0,0,0,0.55); pointer-events: none;
}
#openDm.ws-typing img { animation: ws-nudge 1.1s ease-in-out infinite; }
@keyframes ws-nudge { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-2px); } }
#wsDmTyping {
  position: fixed; z-index: 10040; display: flex; align-items: center; gap: 8px; max-width: min(320px, calc(100vw - 16px));
  padding: 6px 12px; border-radius: 999px; background: var(--aside-bg, rgba(0,0,0,0.92)); color: var(--url-color, #fff);
  border: 2px solid var(--accent-color, #f44); font: bold 12px monospace; pointer-events: none;
}
#wsDmTyping[hidden] { display: none; }
#wsDmTyping span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ws-dots { display: inline-flex; gap: 3px; align-items: center; }
.ws-dots i { width: 6px; height: 6px; border-radius: 50%; background: var(--accent-color, #f44); animation: ws-dot 1.2s infinite ease-in-out; }
.ws-dots i:nth-child(2) { animation-delay: 0.15s; }
.ws-dots i:nth-child(3) { animation-delay: 0.3s; }
@keyframes ws-dot { 0%, 60%, 100% { transform: translateY(0); opacity: 0.45; } 30% { transform: translateY(-4px); opacity: 1; } }
#wsMsgCards { position: fixed; right: 16px; bottom: 16px; z-index: 10050; display: flex; flex-direction: column; gap: 8px; width: min(340px, calc(100vw - 32px)); pointer-events: none; }
.ws-card {
  pointer-events: auto; display: flex; align-items: center; gap: 10px; padding: 10px 12px; cursor: pointer;
  border-radius: 14px; border: 2px solid var(--accent-color, #f44); background: var(--aside-bg, rgba(0,0,0,0.94)); color: var(--url-color, #fff);
  font: 13px/1.35 monospace; box-shadow: 0 6px 18px rgba(0,0,0,0.45);
  opacity: 0; transform: translateY(10px); transition: opacity 0.2s ease, transform 0.2s ease;
}
.ws-card.in { opacity: 1; transform: none; }
.ws-card:focus-visible { outline: 3px solid var(--url-color, #fff); outline-offset: 2px; }
.ws-card-body { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.ws-card-body b, .ws-card-body span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ws-card-body span { opacity: 0.8; font-size: 12px; }
.ws-card-x { flex: none; width: 24px; height: 24px; border-radius: 50%; border: 0; background: rgba(255,255,255,0.12); color: inherit; font: 16px/1 monospace; cursor: pointer; }
.ws-card-x:hover { background: var(--accent-color, #f44); color: #fff; }
.ws-av { flex: none; width: 36px; height: 36px; border-radius: 50%; overflow: hidden; display: inline-grid; place-items: center;
  background: rgba(255,255,255,0.12); border: 2px solid var(--accent-color, #f44); font: bold 15px monospace; color: inherit; }
.ws-av img { width: 100%; height: 100%; object-fit: cover; display: block; }
@media (prefers-reduced-motion: reduce) {
  #openDm.ws-typing img, .ws-dots i { animation: none; }
  .ws-card { transition: none; }
}`;
    const style = document.createElement("style");
    style.id = "wsMsgStyles";
    style.textContent = css;
    document.head.append(style);
  }

  // ── start ─────────────────────────────────────────────────────────────
  function probeUnreadIcon() {
    const probe = new Image();
    probe.onload = () => { S.unreadAsset = true; paintDm(); };
    probe.onerror = () => { S.unreadAsset = false; paintDm(); };
    probe.src = UNREAD_ICON;
  }

  function start() {
    ensureStyles();
    if (!active()) return;
    S.me = lc(read(K.user));
    probeUnreadIcon();
    loadQuotes();
    if (loadShared()) render();
    if (!IS_CHAT_PAGE) poll(true);
    setTimeout(syncProfile, 3500);     // only posts when the picture/nickname changed (signature in ws_msg_profile_sig)
    setTimeout(syncSavedPublicProfile, 3500);

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) { if (!IS_CHAT_PAGE) poll(false); settle(); }
      else schedule();
    });
    window.addEventListener("focus", () => { if (!IS_CHAT_PAGE) poll(false); settle(); });
    window.addEventListener("online", () => { S.fails = 0; if (!IS_CHAT_PAGE) poll(true); });
    window.addEventListener("resize", paintPill);
    // Another tab read a conversation, polled, or changed the profile.
    window.addEventListener("storage", (e) => {
      if (e.key === K.state) { if (loadShared()) render(); }
      else if (e.key === window.WS_ProfileStorage?.key("ws_profile_style_main")) syncSavedPublicProfile();
      else if ([window.WS_ProfileStorage?.key("profilePic"), window.WS_ProfileStorage?.key("nickname"), window.WS_ProfileStorage?.key("pfpPixelated")].includes(e.key)) syncProfile();
      else if (e.key === K.seen) { S.cards.forEach((el, key) => { const n = el.dataset.wsFrom; const f = S.friends.find((x) => x.name === n); if (key.startsWith("m:") && f && f.last && f.last.ts <= (seen()[n] || 0)) dropCard(key); }); render(); }
      else if (e.key === K.profiles) { S.profiles = json(K.profiles, S.profiles); refreshAvatars(); emit(); }
      else if (e.key === K.status && e.newValue !== "approved") { S.dead = true; S.friends = []; S.typing.clear(); render(); }
    });

  }

  window.WS_Msg = {
    ingest, markSeen, avatar, refreshAvatars, setPublicAvatar, displayName, sendTyping, syncProfile, publishPublicProfile, recordPublicActivity, clearPublicActivity,
    isTyping, typingText, summaryTyping,
    unread: () => unreadFriends().map((f) => f.name),
    me: () => myName(),
    refreshProfiles: () => loadProfiles(true),
    open: openChat,
    openFromButton,
    // The chat page says which conversation is open ("" = none) so reading it clears unread.
    setViewing: (name) => { S.viewing = lc(name); settle(); },
    setOpenHandler: (fn) => { S.onOpen = typeof fn === "function" ? fn : null; },
    on: (fn) => { S.listeners.add(fn); return () => S.listeners.delete(fn); },
    chatUrl: CHAT_URL,
    _test: { composeTyping, setQuotes: (q) => { S.quotes = q; }, setProfile: (n, p) => { S.profiles[n] = p; } },
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
