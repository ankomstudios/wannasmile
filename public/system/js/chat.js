"use strict";

// ── WannaChat ──────────────────────────────────────────────────────────
// Friends + direct messages for signed-in WannaSmile accounts.
//
//  • The page uses the account session (ws_ticket_id / key / status /
//    ws_username). The Worker resolves the username from the session.
//  • The Worker handles GET ?type=chat and POST { type:"chat" } actions.
//    No websocket; the page polls, and an idle poll is a tiny cached
//    answer ("unchanged").
//  • Friend requests: send → they Accept (or Decline) → then you can chat.
//    The newest 60 messages per friendship are kept; older ones are deleted
//    by the server as new ones arrive.
//  • GLOBAL CHAT: a room pinned at the top of the list that every account
//    can read and post in, no friend request needed.
//  • TESTER CHAT: a private room available only to accounts with the tester
//    badge (GET &room=tester, POST send {room:"tester"}).
//  • BUG REPORTS: a read-only report queue visible only to testers and admins.
//    people meet: click anyone's name or picture to view their profile, add
//    them as a friend, then talk privately. It's the pseudo-conversation GLOBAL
//    ("#global") in state.active; a real username can never start with "#".
//  • msgcore.js (WS_Msg) is shared with the rest of the site. This page hands
//    it every poll answer; in return it supplies profile pictures and display
//    names, the real "is typing" state (and local JSON typing quotes),
//    unread/seen bookkeeping and the notification cards. #with=<username> in
//    the address opens that conversation (that's where a notification click
//    lands).
(() => {
  const $ = (id) => document.getElementById(id);
  const API = window.WS_ENDPOINTS && window.WS_ENDPOINTS.chat;
  const M = window.WS_Msg || null;        // optional: the page still works as plain chat without it

  const K = { id: "ws_ticket_id", key: "ws_ticket_key", status: "ws_ticket_status", user: "ws_username", seen: "ws_chat_seen" };
  const read = (k) => { try { return localStorage.getItem(k) || ""; } catch (_) { return ""; } };
  const NAME_RE  = /^[a-z0-9][a-z0-9_.\-]{2,19}$/;
  const MAX_TEXT = 500;
  const MAX_GIF_URL = 2048;
  const MAX_MENTIONS = 10;
  const POLL_MS  = 4000;      // tab in front (short, so "typing" shows up while it's happening)
  const SLOW_MS  = 30000;     // tab hidden
  const MAX_BACKOFF = 60000;
  const TYPING_PING_MS = 3000;   // how often "I'm typing" is sent while a draft is being written
  const GROUP_GAP_MS = 5 * 60000; // messages from one person closer than this share one avatar/name
  const GLOBAL = "#global";       // the global room, in place of a friend's username in state.active
  const TESTER = "#tester";       // tester-only room; never accepted as a real username
  const BUG_REPORTS = "#bug-reports";
  const MENTIONS = "#mentions";

  const state = {
    me: "", friends: [], active: "", messages: [], bugReports: [], bugReportError: "", rev: "", grev: "", trev: "", brev: "", profileRev: "", max: 60, globalOff: false,
    loading: false, again: false, fails: 0, timer: 0, dead: false, sending: false, mentions: [], mentionUnread: 0,
    wanted: "", jumpToId: 0, highlightId: 0, dmUnread: 0, replyTo: null, composerMedia: null, editingId: 0, messageBusy: new Set(), rolesByName: Object.create(null), // #with=<name> still waiting for the friend list
    lastPing: 0,
  };
  const renderedMessages = new Map();
  const renderedDays = new Map();

  const toast = (m) => (window.showToast ? window.showToast(m, 3200) : console.log(m));
  const cleanName = (v) => String(v || "").trim().replace(/^@/, "").toLowerCase();
  const visibleNow = () => document.visibilityState === "visible" && document.hasFocus();
  const inGlobal = () => state.active === GLOBAL;
  const inTester = () => state.active === TESTER;
  const inBugReports = () => state.active === BUG_REPORTS;
  const inMentions = () => state.active === MENTIONS;
  const inSharedRoom = () => inGlobal() || inTester() || inBugReports() || inMentions();
  const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const hasMentionToken = (text, name) => new RegExp(`(?:^|\\s)@${escapeRegExp(name)}(?=$|[\\s.,!?;:)])`, "i").test(String(text || ""));
  const mentionNamesIn = (text) => state.friends
    .filter((friend) => isMentionAllowed(friend.name) && hasMentionToken(text, friend.name))
    .map((friend) => friend.name)
    .slice(0, MAX_MENTIONS);
  function openPublicProfile(name) {
    if (typeof window.openPublicProfileOverlay === "function") window.openPublicProfileOverlay(name);
    else toast("Public profiles are unavailable right now.");
  }
  function renderReplyComposer() {
    const bar = $("replyComposer");
    const target = state.replyTo;
    if (!bar) return;
    bar.hidden = !target;
    if (!target) return;
    $("replyComposerName").textContent = target.unavailable ? "Original message unavailable" : shown(target.from);
    $("replyComposerText").textContent = target.unavailable ? "" : target.text || mediaLabel(target.media, target.gifUrl);
  }
  function setReplyTarget(message) {
    state.replyTo = message && Number.isSafeInteger(Number(message.id)) && Number(message.id) > 0
      ? { id: Number(message.id), from: message.from, text: message.text, gifUrl: message.gifUrl || "", media: message.media || null, unavailable: !!message.unavailable }
      : null;
    renderReplyComposer();
    $("msg").focus({ preventScroll: true });
  }

  function normalizeGifUrl(value) {
    const raw = String(value || "").trim();
    if (!raw || raw.length > MAX_GIF_URL) return "";
    let url;
    try { url = new URL(raw); } catch (_) { return ""; }
    if (url.protocol !== "https:" || url.username || url.password || url.port) return "";
    const host = url.hostname.toLowerCase();
    if (host === "giphy.com" || host === "www.giphy.com") {
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] !== "gifs" || parts.length !== 2) return "";
      const id = parts[1].split("-").pop();
      if (!/^[a-z0-9]{6,20}$/i.test(id)) return "";
      return `https://media.giphy.com/media/${id}/giphy.gif`;
    }
    if (!/\.(?:gif|webp|png|jpe?g)$/i.test(url.pathname)) return "";
    url.hash = "";
    return url.href.length <= MAX_GIF_URL ? url.href : "";
  }

  function mediaLabel(media, legacyGifUrl) {
    if (media) return media.title || ({ image: "Image or GIF", video: "Video", audio: "Audio", youtube: "YouTube video", spotify: "Spotify", link: "Web link" }[media.kind] || "Media");
    return legacyGifUrl ? "GIF" : "";
  }

  function normalizeMedia(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const raw = String(value.url || "").trim();
    if (!raw || raw.length > MAX_GIF_URL) return null;
    let url;
    try { url = new URL(raw); } catch (_) { return null; }
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const kind = String(value.kind || "");
    if (kind === "youtube") {
      if (!["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "youtube-nocookie.com", "www.youtube-nocookie.com"].includes(url.hostname.toLowerCase())) return null;
      const id = url.hostname.toLowerCase() === "youtu.be" ? url.pathname.split("/").filter(Boolean)[0]
        : url.pathname === "/watch" ? url.searchParams.get("v") : url.pathname.split("/").filter(Boolean).pop();
      if (!/^[\w-]{11}$/.test(id || "")) return null;
      return { kind, url: `https://www.youtube-nocookie.com/embed/${id}`, title: String(value.title || "").slice(0, 120) };
    }
    if (kind === "spotify") {
      if (!["open.spotify.com", "spotify.com", "www.spotify.com"].includes(url.hostname.toLowerCase())) return null;
      const path = url.pathname.split("/").filter(Boolean);
      if (/^intl-[a-z]{2}(?:-[a-z]{2})?$/i.test(path[0] || "")) path.shift();
      if (path[0] === "embed") path.shift();
      const [type, id] = path;
      if (!["track", "album", "playlist", "episode", "show"].includes(type) || !/^[A-Za-z0-9]{10,64}$/.test(id || "")) return null;
      return { kind, url: `https://open.spotify.com/embed/${type}/${id}`, title: String(value.title || "").slice(0, 120) };
    }
    if (kind === "image" || kind === "video" || kind === "audio") {
      const ext = url.pathname.split(".").pop().toLowerCase();
      const valid = kind === "image" ? /^(?:gif|webp|png|jpe?g|avif)$/ : kind === "video" ? /^(?:mp4|webm)$/ : /^(?:mp3|m4a|ogg|wav|aac)$/;
      if (!valid.test(ext)) return null;
      url.hash = "";
      return { kind, url: url.href, title: String(value.title || "").slice(0, 120) };
    }
    if (kind === "link") {
      url.hash = "";
      return { kind, url: url.href, title: String(value.title || url.hostname).slice(0, 120) };
    }
    return null;
  }

  function mediaFromInput(value) {
    const raw = String(value || "").trim();
    if (!raw || raw.length > MAX_GIF_URL) return null;
    return normalizeMedia({ kind: "spotify", url: raw });
  }

  function spotifyMediaFromText(text) {
    const links = String(text || "").match(/https?:\/\/(?:open\.|www\.)?spotify\.com\/[^\s<>]+/gi) || [];
    for (const link of links) {
      const cleaned = link.replace(/[)\]},.!?;:]+$/, "");
      const media = mediaFromInput(cleaned);
      if (media) return media;
    }
    return null;
  }

  function closeMediaPicker(restoreFocus) {
    $("mediaPicker").hidden = true;
    document.documentElement.classList.remove("media-picker-open");
    $("mediaBtn").setAttribute("aria-expanded", "false");
    if (restoreFocus) $("mediaBtn").focus({ preventScroll: true });
  }

  function openMediaPicker() {
    $("mediaPicker").hidden = false;
    document.documentElement.classList.add("media-picker-open");
    $("mediaBtn").setAttribute("aria-expanded", "true");
    $("spotifyLinkInput").focus({ preventScroll: true });
    renderMediaPane();
  }

  function renderMediaPane(message, className) {
    const results = $("mediaResults");
    results.textContent = "";
    const media = mediaFromInput($("spotifyLinkInput").value);
    if (media) {
      results.append(el("div", { class: "media-state", role: "status", text: "Spotify link ready. It will appear as a playable player in chat." }));
    } else if (message) {
      results.append(el("div", { class: "media-state" + (className ? ` ${className}` : ""), role: "status", text: message }));
    } else {
      results.append(el("div", { class: "media-state", text: "Share a Spotify track, album, playlist, episode, or show. Links pasted in a message are embedded automatically too." }));
    }
  }

  function mediaPreview(media) {
    if (!media) return null;
    return el("span", { class: "media-attachment-icon", text: media.kind === "spotify" ? "Spotify" : media.kind === "youtube" ? "YouTube" : media.kind.toUpperCase() });
  }

  function paintMediaAttachment() {
    const bar = $("mediaAttachment");
    const preview = $("mediaAttachmentPreview");
    bar.hidden = !state.composerMedia;
    preview.textContent = "";
    if (state.composerMedia) {
      const content = mediaPreview(state.composerMedia);
      if (content) preview.append(content);
      bar.querySelector(".media-attachment-label").textContent = mediaLabel(state.composerMedia);
    }
  }

  // Same small DOM helper everywhere; all user text goes in through
  // textContent, never innerHTML.
  function el(tag, props, ...kids) {
    const n = document.createElement(tag);
    for (const k in props || {}) {
      if (k === "class") n.className = props[k];
      else if (k === "text") n.textContent = props[k];
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), props[k]);
      else if (props[k] !== false && props[k] != null) n.setAttribute(k, props[k] === true ? "" : props[k]);
    }
    for (const c of kids) if (c != null) n.append(c.nodeType ? c : document.createTextNode(String(c)));
    return n;
  }
  const icon = (cls) => el("i", { class: cls, "aria-hidden": "true" });

  // ── names and pictures (WS_Msg when present) ──────────────────────────
  const shown = (name) => (M ? M.displayName(name) : name);
  const isBotAccount = (name) => cleanName(name) === "wannasmilebot";
  const accountRoles = (name) => state.rolesByName[cleanName(name)] || [];
  const isRoleAccount = (name, role) => accountRoles(name).includes(role);
  const canViewBugReports = () => isRoleAccount(state.me, "tester") || isRoleAccount(state.me, "admin");
  const ROLE_LABELS = { admin: "Administrator", contributor: "Contributor", tester: "Tester" };
  const roleMapSignature = (roles) => JSON.stringify(Object.keys(roles).sort()
    .map((name) => [name, [...roles[name]].sort()]));
  function avatar(name, cls) {
    if (M) return M.avatar(name, cls);
    return el("span", { class: "ws-av" + (cls ? " " + cls : "") }, String(name || "?").charAt(0).toUpperCase());
  }
  // A name that follows later profile updates: refreshNames() rewrites it in place.
  function nameTag(tag, user, cls, displayOverride) {
    const hasDisplayOverride = typeof displayOverride === "string";
    const display = hasDisplayOverride ? displayOverride.trim().slice(0, 30) || cleanName(user) : shown(user);
    const attrs = cls ? { class: cls, "data-ws-name": user } : { "data-ws-name": user };
    if (hasDisplayOverride) attrs["data-ws-display"] = display;
    const node = el(tag, attrs);
    node.append(el("span", { class: "ws-name-text", text: display }));
    if (isBotAccount(user)) node.append(el("span", { class: "ws-bot-shield", title: "WannaSmile demo bot", "aria-label": "Bot account" }, "bot"));
    accountRoles(user).forEach((role) => node.append(el("span", {
      class: `ws-role-shield ws-${role}-shield`,
      title: `WannaSmile ${ROLE_LABELS[role]}`,
      "aria-label": `${ROLE_LABELS[role]} account`,
    }, role)));
    return node;
  }
  function refreshNames() {
    document.querySelectorAll("[data-ws-name]").forEach((n) => {
      const t = n.dataset.wsDisplay || shown(n.dataset.wsName);
      const label = n.querySelector(".ws-name-text");
      if (label && label.textContent !== t) label.textContent = t;
      n.querySelectorAll(".ws-role-shield").forEach((badge) => badge.remove());
      accountRoles(n.dataset.wsName).forEach((role) => n.append(el("span", {
        class: `ws-role-shield ws-${role}-shield`,
        title: `WannaSmile ${ROLE_LABELS[role]}`,
        "aria-label": `${ROLE_LABELS[role]} account`,
      }, role)));
    });
  }

  // ── seen-markers (unread dots), per browser ───────────────────────────
  const seen = () => { try { const v = JSON.parse(read(K.seen) || "{}"); return v && typeof v === "object" ? v : {}; } catch (_) { return {}; } };
  const markSeenLocal = (name, ts) => {
    const s = seen();
    if ((s[name] || 0) >= ts) return;
    s[name] = ts;
    try { localStorage.setItem(K.seen, JSON.stringify(s)); } catch (_) {}
  };
  // Only counts as read while the conversation is really in front of the person;
  // a message that lands in a hidden tab stays unread (and notifies).
  function markActiveSeen() {
    if (!state.active || inSharedRoom() || !visibleNow()) return;
    const last = state.messages[state.messages.length - 1];
    if (!last || last.pending) return;
    if (M) M.markSeen(state.active, last.ts); else markSeenLocal(state.active, last.ts);
  }

  // ── network ───────────────────────────────────────────────────────────
  const creds = () => ({ ticket: read(K.id), key: read(K.key) });

  async function get(extra) {
    const qs = new URLSearchParams({ type: "chat", ...creds(), ...extra, _: Date.now() });
    const res = await fetch(`${API}?${qs}`, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || "HTTP " + res.status);
    return data;
  }

  async function post(action, extra) {
    // Send JSON without custom headers; the Worker accepts this simple request.
    const res = await fetch(API, {
      method: "POST", cache: "no-store",
      body: JSON.stringify({ type: "chat", action, ...creds(), ...extra }),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  // ── status / gate ─────────────────────────────────────────────────────
  function net(kind, text) {
    const s = $("net");
    s.className = "status " + kind;
    s.textContent = text;
  }

  function gate(title, text, linkText) {
    state.dead = true;
    clearTimeout(state.timer);
    $("app").hidden = true;
    $("gate").hidden = false;
    $("gateTitle").textContent = title;
    $("gateText").textContent = text;
    if (linkText) $("gateBtn").lastChild.textContent = " " + linkText;
    net("off", "Unavailable");
  }

  // ── polling ───────────────────────────────────────────────────────────
  function schedule() {
    clearTimeout(state.timer);
    if (state.dead) return;
    const base = document.hidden ? SLOW_MS : POLL_MS;
    const wait = Math.min(MAX_BACKOFF, base * Math.pow(2, Math.min(state.fails, 4)));
    state.timer = setTimeout(() => refresh(false), wait);
  }

  async function refresh(force) {
    if (state.dead) return;
    if (state.loading) { if (force) state.again = true; return; }
    state.loading = true;
    const asked = state.active;     // the conversation this answer is for
    try {
      const data = await get(asked === GLOBAL
        ? { room: "global", rev: force ? "" : state.rev, grev: force ? "" : state.grev }
        : asked === TESTER
          ? { room: "tester", rev: force ? "" : state.rev, trev: force ? "" : state.trev }
          : asked === BUG_REPORTS
            ? { room: "bug-reports", rev: force ? "" : state.rev, brev: force ? "" : state.brev }
          : { with: asked, rev: force ? "" : state.rev });
      state.fails = 0;

      if (!data || data.ok !== true) {
        if (data && (data.code === "account" || data.error === "Ticket required.")) {
          return gate("Sign in to chat", "Create an account or sign in on the WannaSmile homepage, then return here.", "Go to WannaSmile");
        }
        if (asked === TESTER && data && data.code === "tester_role") {
          state.active = "";
          state.messages = [];
          state.rev = "";
          state.trev = "";
          if (M) M.setViewing("");
          toast("The tester channel is only available to tester accounts.");
          renderFriends();
          renderConversation();
          return;
        }
        if (asked === BUG_REPORTS && data && data.code === "bug_reports_role") {
          state.active = "";
          state.bugReports = [];
          state.rev = "";
          state.brev = "";
          if (M) M.setViewing("");
          toast("Bug reports are only available to tester and admin accounts.");
          renderFriends();
          renderConversation();
          return;
        }
        throw new Error((data && data.error) || "Unexpected reply");
      }

      state.me = data.me || state.me;
      paintMe();
      state.rev = data.rev || state.rev;
      state.grev = data.grev || state.grev;
      state.trev = data.trev || state.trev;
      state.brev = data.brev || state.brev;
      if (data.profileRev != null && String(data.profileRev) !== state.profileRev) {
        state.profileRev = String(data.profileRev);
        if (M) Promise.resolve(M.refreshProfiles(true)).catch((error) => console.error("[chat] Could not refresh linked profile names.", error));
      }
      net("live", "Live");
      const previousRoles = roleMapSignature(state.rolesByName);
      if (data.roleNames && typeof data.roleNames === "object" && !Array.isArray(data.roleNames)) {
        const roleNames = Object.create(null);
        Object.entries(data.roleNames).forEach(([rawName, rawRoles]) => {
          const name = cleanName(rawName);
          if (!NAME_RE.test(name) || !Array.isArray(rawRoles)) return;
          const roles = [...new Set(rawRoles.filter((role) => ["admin", "contributor", "tester"].includes(role)))];
          if (roles.length) roleNames[name] = roles;
        });
        state.rolesByName = roleNames;
      } else if (Array.isArray(data.adminNames)) {
        state.rolesByName = Object.create(null);
        data.adminNames.map(cleanName).filter((name) => NAME_RE.test(name))
          .forEach((name) => { state.rolesByName[name] = ["admin"]; });
      }
      if (previousRoles !== roleMapSignature(state.rolesByName)) {
        paintMe();
        refreshNames();
        renderFriends();
        if (inBugReports()) {
          if (!canViewBugReports()) {
            state.active = "";
            state.bugReports = [];
            state.rev = "";
            state.brev = "";
            if (M) M.setViewing("");
            toast("Bug reports are only available to tester and admin accounts.");
            renderConversation();
          } else renderConversation();
        } else if (inTester()) renderConversation();
        else if (inSharedRoom()) renderThread(false);
      }
      // Typing flags ride on every answer, even "unchanged" ones.
      if (M) M.ingest(data, { viewing: inSharedRoom() ? "" : state.active });
      if (data.unchanged) return;
      if (asked !== state.active) return;

      state.max = data.max || 60;
      state.friends = Array.isArray(data.friends) ? data.friends : [];
      state.mentions = Array.isArray(data.mentions) ? data.mentions : state.mentions;
      state.mentionUnread = Number(data.mentionUnread) || 0;
      paintUnreadBadge();
      if (inMentions()) {
        state.messages = [];
      } else if (inSharedRoom()) {
        // An answer meant for another conversation (the person switched while it
        // was in flight) is skipped; the refresh queued by open() follows it.
        if (asked === BUG_REPORTS) {
          state.bugReports = Array.isArray(data.bugReports) ? data.bugReports : [];
          state.bugReportError = "";
          state.messages = [];
        } else if (asked === GLOBAL || asked === TESTER) {
          const roomData = asked === GLOBAL ? data.global : data.tester;
          if (asked === GLOBAL) state.globalOff = !roomData;
          if (roomData) {
            state.max = roomData.max || 120;
            // Oldest first; equal timestamps keep the order the server listed them (stable sort).
            const listed = (roomData.messages || []).map((m, i) => ({ m, i })).sort((a, b) => ((a.m.ts || 0) - (b.m.ts || 0)) || (a.i - b.i)).map((x) => x.m);
            if (asked === GLOBAL && M) {
              listed.forEach((message) => {
                if (!NAME_RE.test(cleanName(message.from))) return;
                M.setPublicDisplayName(message.from, message.profileName);
              });
              (Array.isArray(roomData.profileAvatars) ? roomData.profileAvatars : []).forEach((profile) => {
                if (NAME_RE.test(cleanName(profile.name)) && typeof profile.avatar === "string" && profile.avatar) {
                  M.setPublicAvatar(profile.name, profile.avatar);
                }
              });
            }
            const pending = state.sending ? state.messages.filter((m) => m.pending) : [];
            state.messages = listed.concat(pending.filter((p) => !listed.some((m) =>
              m.from === p.from && m.text === p.text && (m.media?.url || m.gifUrl || "") === (p.media?.url || p.gifUrl || "") && m.ts >= p.ts - 60000)));
            if (state.messages.length > state.max) state.messages = state.messages.slice(-state.max);
          } else if (asked === TESTER) {
            throw new Error("The tester channel could not be loaded.");
          }
        }
      } else if (state.active && !state.friends.some((f) => f.name === state.active && f.status === "friend")) {
        state.active = "";        // removed (by either of you) or never accepted
        state.messages = [];
        if (M) M.setViewing("");
      } else if (state.active && data.with === state.active) {
        // A message still being sent stays on screen until the server lists it
        // (the 60 s allowance covers a clock that is a little off).
        const listed = data.messages || [];
        const pending = state.sending ? state.messages.filter((m) => m.pending) : [];
        state.messages = listed.concat(pending.filter((p) => !listed.some((m) =>
          m.from === p.from && m.text === p.text && (m.media?.url || m.gifUrl || "") === (p.media?.url || p.gifUrl || "") && m.ts >= p.ts - 60000)));
        markActiveSeen();
      }
      openWanted();
      renderFriends();
      renderConversation();
      resolveJumpTarget();
    } catch (err) {
      state.fails++;
      net("off", "Offline");
      if (asked === BUG_REPORTS) {
        state.bugReportError = "Bug reports could not be loaded. Check your connection and try again.";
        renderThread(false);
      }
    } finally {
      state.loading = false;
      if (state.again) { state.again = false; refresh(true); }
      else schedule();
    }
  }

  // ── actions ───────────────────────────────────────────────────────────
  async function act(action, extra, okMsg) {
    try {
      const r = await post(action, extra);
      if (!r || r.ok !== true) throw new Error((r && r.error) || "That didn't work.");
      if (okMsg) toast(typeof okMsg === "function" ? okMsg(r) : okMsg);
    } catch (err) {
      toast(err.message || "That didn't work.");
    }
    refresh(true);
  }

  // Friend request to `name`; true when it went through.
  async function sendRequest(name) {
    try {
      const r = await post("request", { to: name });
      if (!r || r.ok !== true) throw new Error((r && r.error) || "Couldn't send that request.");
      toast(r.state === "friend" ? `You and @${name} are friends now` : r.state === "outgoing" ? `Request sent to @${name}` : "Done");
      return true;
    } catch (err) {
      toast(err.message || "Couldn't send that request.");
      return false;
    } finally {
      refresh(true);
    }
  }

  $("addForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $("addName");
    const name = cleanName(input.value);
    if (!NAME_RE.test(name)) return toast("Usernames are 3-20 letters, numbers, _ . or -");
    if (name === state.me) return toast("That's you!");
    $("addBtn").disabled = true;
    try {
      if (await sendRequest(name)) input.value = "";
    } finally {
      $("addBtn").disabled = false;
    }
  });

  function open(name, jumpToId) {
    if (state.active !== name && state.composerMedia) {
      state.composerMedia = null;
      paintMediaAttachment();
    }
    state.active = name;
    state.messages = [];
    state.editingId = 0;
    state.jumpToId = Number.isSafeInteger(Number(jumpToId)) && Number(jumpToId) > 0 ? Number(jumpToId) : 0;
    state.highlightId = state.jumpToId;
    closeMentionPicker();
    state.replyTo = null;
    renderReplyComposer();
    state.rev = "";
    state.grev = "";
    state.trev = "";
    state.brev = "";
    state.lastPing = 0;
    closeUserMenu();
    paintDockPlate();
    $("chat").classList.add("open");
    if (M) M.setViewing(name === GLOBAL || name === TESTER || name === BUG_REPORTS ? "" : name);
    renderFriends();
    renderConversation();
    refresh(true);
    if (!inBugReports()) $("msg").focus({ preventScroll: true });
  }

  function closeConversation() {
    closeUserMenu();
    closeMentionPicker();
    state.active = "";
    state.replyTo = null;
    state.editingId = 0;
    renderReplyComposer();
    state.rev = "";
    state.grev = "";
    state.trev = "";
    state.brev = "";
    state.jumpToId = 0;
    state.highlightId = 0;
    paintDockPlate();
    if (M) M.setViewing("");
    $("chat").classList.remove("open");
    renderFriends();
    renderConversation();
  }

  $("backBtn").addEventListener("click", closeConversation);
  $("peerProfileButton").addEventListener("click", () => {
    if (state.active && !inGlobal()) openPublicProfile(state.active);
  });

  $("removeBtn").addEventListener("click", () => {
    const name = state.active;
    if (!name) return;
    if (!window.confirm(`Remove ${shown(name)} (@${name})? This also deletes your chat with them.`)) return;
    state.active = "";
    state.replyTo = null;
    state.editingId = 0;
    renderReplyComposer();
    if (M) M.setViewing("");
    $("chat").classList.remove("open");
    act("remove", { name }, `Removed @${name}`);
  });

  // #with=<username> (notification click, or a link): open that conversation as
  // soon as the friend list is known.
  function wantFromHash() {
    if (/(?:^#|&)global(?:&|$)/.test(location.hash || "")) {
      try { history.replaceState(null, "", location.pathname + location.search); } catch (_) {}
      if (!inGlobal()) open(GLOBAL);
      return true;
    }
    const m = /(?:^#|&)with=([^&]+)/.exec(location.hash || "");
    if (!m) return false;
    let n = "";
    try { n = cleanName(decodeURIComponent(m[1])); } catch (_) { return false; }
    if (!NAME_RE.test(n)) return false;
    state.wanted = n;
    openWanted();
    try { history.replaceState(null, "", location.pathname + location.search); } catch (_) {}
    return true;
  }
  function openWanted() {
    if (!state.wanted || !state.friends.length) return;
    const n = state.wanted;
    state.wanted = "";
    if (state.friends.some((f) => f.name === n && f.status === "friend")) { if (state.active !== n) open(n); }
    else toast(`@${n} isn't one of your friends yet.`);
  }

  function sendMedia(value) {
    const media = normalizeMedia(value);
    if (!media) return toast("That media link is not supported.");
    if (inBugReports()) return toast("Bug reports are read-only.");
    if (inTester() && !canPostTester()) return toast("Admins can review the tester channel but only tester accounts can post there.");
    state.composerMedia = media;
    paintMediaAttachment();
    closeMediaPicker(false);
    if (!state.active) return toast("Open a conversation before sending media.");
    send();
  }

  async function send() {
    if (inBugReports()) return toast("Bug reports are read-only.");
    const box = $("msg");
    const text = box.value.trim();
    const media = state.composerMedia || spotifyMediaFromText(text);
    const gifUrl = media && media.kind === "image" ? normalizeGifUrl(media.url) : "";
    if ((!text && !media) || !state.active || state.sending) return;
    if (inTester() && !accountRoles(state.me).includes("tester")) return toast("Admins can review the tester channel but only tester accounts can post there.");
    const mentions = mentionNamesIn(text).filter(isMentionAllowed);
    // Global chat is public, so it gets the same word filter as nicknames and
    // ticket reasons (wordfilter.js; checked here, in the browser).
    if (inGlobal() && text && window.WS_WordFilter && window.WS_WordFilter.find(text)) {
      return toast("Something in that message isn't allowed in global chat. Try rewording it.");
    }
    state.sending = true;
    const to = state.active;
    const replyTo = state.replyTo;
    box.value = "";
    state.composerMedia = null;
    paintMediaAttachment();
    state.lastPing = 0;
    updateCount();
    autosize();
    const tmp = {
      from: state.me, text, gifUrl, media, mentions, ts: Date.now(), pending: true, clientKey: `pending-${Date.now()}-${Math.random()}`,
      replyTo: replyTo ? { id: replyTo.id, from: replyTo.from, text: replyTo.text, gifUrl: replyTo.gifUrl, media: replyTo.media || null, unavailable: replyTo.unavailable } : null,
    };
    state.replyTo = null;
    renderReplyComposer();
    state.messages.push(tmp);
    renderThread(true);
    try {
      const payload = inGlobal() ? { room: "global", text, media, gifUrl }
        : inTester() ? { room: "tester", text, media, gifUrl }
          : { to, text, media, gifUrl };
      if (mentions.length) payload.mentions = mentions;
      if (replyTo) payload.replyTo = replyTo.id;
      const r = await post("send", payload);
      if (!r || r.ok !== true) throw new Error((r && r.error) || "Couldn't send that.");
    } catch (err) {
      state.messages = state.messages.filter((m) => m !== tmp);
      if (!box.value) box.value = text;
      if (!state.composerMedia) state.composerMedia = media;
      paintMediaAttachment();
      if (replyTo && state.active === to && !state.replyTo) state.replyTo = replyTo;
      renderReplyComposer();
      updateCount();
      renderThread(false);
      toast(err.message || "Couldn't send that.");
    } finally {
      state.sending = false;
      refresh(true);
    }
  }

  function messageActionPayload(id) {
    return inGlobal() ? { id, room: "global" }
      : inTester() ? { id, room: "tester" }
        : { id, to: state.active };
  }
  function canPostTester() {
    return !inTester() || accountRoles(state.me).includes("tester");
  }
  function canEditMessage(message) {
    return !!message.id && message.from === state.me && !message.pending;
  }
  function canDeleteMessage(message) {
    if (!message.id || message.pending) return false;
    if (message.from === state.me) return true;
    return (inGlobal() || inTester()) && accountRoles(state.me).includes("admin");
  }
  async function saveMessageEdit(id, textarea) {
    const text = textarea.value.trim();
    if (text.length > MAX_TEXT) return toast(`Messages can be up to ${MAX_TEXT} characters.`);
    const busyKey = `edit:${id}`;
    if (state.messageBusy.has(busyKey)) return;
    state.messageBusy.add(busyKey);
    textarea.disabled = true;
    try {
      const result = await post("edit", { ...messageActionPayload(id), text });
      if (!result || result.ok !== true) throw new Error(result?.error || "That message could not be edited.");
      state.editingId = 0;
      toast("Message updated.");
      refresh(true);
    } catch (error) {
      console.error("[chat] Could not edit message:", error);
      toast(error.message || "That message could not be edited.");
      textarea.disabled = false;
      textarea.focus();
    } finally {
      state.messageBusy.delete(busyKey);
      renderThread(false);
    }
  }
  async function deleteMessage(id) {
    if (!window.confirm("Delete this message? This can't be undone.")) return;
    const busyKey = `delete:${id}`;
    if (state.messageBusy.has(busyKey)) return;
    state.messageBusy.add(busyKey);
    try {
      const result = await post("delete", messageActionPayload(id));
      if (!result || result.ok !== true) throw new Error(result?.error || "That message could not be deleted.");
      state.messages = state.messages.filter((message) => Number(message.id) !== id);
      state.editingId = 0;
      renderThread(false);
      toast("Message deleted.");
      refresh(true);
    } catch (error) {
      console.error("[chat] Could not delete message:", error);
      toast(error.message || "That message could not be deleted.");
    } finally {
      state.messageBusy.delete(busyKey);
      renderThread(false);
    }
  }

  $("composer").addEventListener("submit", (e) => { e.preventDefault(); send(); });
  $("mediaBtn").addEventListener("click", openMediaPicker);
  $("mediaClose").addEventListener("click", () => closeMediaPicker(true));
  $("mediaPicker").addEventListener("click", (event) => {
    if (event.target === $("mediaPicker")) closeMediaPicker(true);
  });
  $("spotifyLinkInput").addEventListener("input", () => {
    renderMediaPane();
  });
  $("spotifyLinkInput").addEventListener("keydown", (event) => {
    if (event.key === "Escape") { closeMediaPicker(true); return; }
    if (event.key === "Enter") {
      event.preventDefault();
      shareSpotifyLink();
    }
  });
  $("shareSpotifyLink").addEventListener("click", shareSpotifyLink);
  $("clearSpotifyLink").addEventListener("click", () => {
    $("spotifyLinkInput").value = "";
    renderMediaPane();
    $("spotifyLinkInput").focus({ preventScroll: true });
  });
  function shareSpotifyLink() {
    const media = mediaFromInput($("spotifyLinkInput").value);
    if (media) sendMedia(media);
    else renderMediaPane("That is not a supported Spotify link. Paste a track, album, playlist, episode, or show URL.", "media-picker-error");
  }
  $("removeMedia").addEventListener("click", () => {
    state.composerMedia = null;
    paintMediaAttachment();
  });
  $("cancelReply").addEventListener("click", () => setReplyTarget(null));
  $("mentionPicker").addEventListener("mousedown", (event) => {
    if (event.target.closest("button")) event.preventDefault();
  });
  $("mentionPicker").addEventListener("click", (event) => {
    const option = event.target.closest("[data-mention-name]");
    if (option) insertMention(option.dataset.mentionName);
  });
  $("msg").addEventListener("keydown", (e) => {
    if (!$("mentionPicker").hidden) {
      if (e.key === "Escape") { e.preventDefault(); closeMentionPicker(); return; }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const options = $("mentionPicker").querySelectorAll("[data-mention-name]");
        if (options.length) {
          e.preventDefault();
          const current = [...options].findIndex((option) => option.getAttribute("aria-selected") === "true");
          const next = current < 0
            ? e.key === "ArrowDown" ? 0 : options.length - 1
            : e.key === "ArrowDown"
              ? (current + 1) % options.length
              : (current - 1 + options.length) % options.length;
          options.forEach((option, index) => option.setAttribute("aria-selected", String(index === next)));
          $("msg").setAttribute("aria-activedescendant", options[next].id);
          options[next].scrollIntoView({ block: "nearest" });
        }
        return;
      }
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        const option = $("mentionPicker").querySelector('[aria-selected="true"][data-mention-name]') ||
          $("mentionPicker").querySelector("[data-mention-name]");
        if (option) { e.preventDefault(); insertMention(option.dataset.mentionName); return; }
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  });
  $("msg").addEventListener("input", () => {
    updateCount(); autosize();
    renderMentionPicker();
    // Real typing: tell the friend while there's an unsent draft, at most every few seconds.
    if (!$("msg").value.trim()) { state.lastPing = 0; return; }
    const now = Date.now();
    if (M && state.active && !inSharedRoom() && now - state.lastPing >= TYPING_PING_MS) {
      state.lastPing = now;
      M.sendTyping(state.active);
    }
  });

  function isMentionAllowed(name) {
    const friend = state.friends.find((entry) => entry.name === name && entry.status === "friend");
    if (!friend || name === state.me || inTester() || inMentions()) return false;
    return inGlobal() || name === state.active;
  }

  function closeMentionPicker() {
    const picker = $("mentionPicker");
    picker.hidden = true;
    picker.textContent = "";
    $("msg").setAttribute("aria-expanded", "false");
    $("msg").removeAttribute("aria-activedescendant");
  }

  function renderMentionPicker() {
    const picker = $("mentionPicker");
    const input = $("msg");
    if (!state.active || inTester() || inMentions() || $("mediaPicker") && !$("mediaPicker").hidden) {
      closeMentionPicker();
      return;
    }
    const caret = input.selectionStart;
    const before = input.value.slice(0, caret);
    const match = /(?:^|\s)@([a-z0-9_.-]{0,20})$/i.exec(before);
    if (!match) { closeMentionPicker(); return; }
    const query = cleanName(match[1]);
    const candidates = state.friends
      .filter((friend) => friend.status === "friend" && isMentionAllowed(friend.name) && friend.name.startsWith(query))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 8);
    picker.textContent = "";
    picker.hidden = false;
    $("msg").setAttribute("aria-expanded", "true");
    if (!candidates.length) {
      picker.append(el("div", { class: "mention-picker-empty", role: "status", text: "No linked friends match." }));
      $("msg").removeAttribute("aria-activedescendant");
      return;
    }
    candidates.forEach((friend, index) => {
      picker.append(el("button", {
        id: `mention-option-${index}`,
        class: "mention-option",
        type: "button",
        role: "option",
        "aria-selected": index === 0 ? "true" : "false",
        "data-mention-name": friend.name,
      }, avatar(friend.name, "sm"), el("span", { class: "mention-option-copy" },
        el("b", { text: shown(friend.name) }), el("small", { text: "@" + friend.name }))));
    });
    $("msg").setAttribute("aria-activedescendant", "mention-option-0");
  }

  function insertMention(name) {
    const normalized = cleanName(name);
    if (!NAME_RE.test(normalized) || !isMentionAllowed(normalized)) return;
    const input = $("msg");
    const caret = input.selectionStart;
    const before = input.value.slice(0, caret);
    const match = /(?:^|\s)@([a-z0-9_.-]{0,20})$/i.exec(before);
    if (!match) return closeMentionPicker();
    const start = caret - match[1].length - 1;
    input.value = input.value.slice(0, start) + `@${normalized} ` + input.value.slice(caret);
    const nextCaret = start + normalized.length + 2;
    input.setSelectionRange(nextCaret, nextCaret);
    closeMentionPicker();
    input.focus({ preventScroll: true });
    updateCount();
    autosize();
  }

  function updateCount() { $("left").textContent = String(MAX_TEXT - $("msg").value.length); }
  function autosize() {
    const t = $("msg");
    t.style.height = "auto";
    t.style.height = Math.min(120, t.scrollHeight) + "px";
  }

  // ── nameplates ────────────────────────────────────────────────────────
  // A nameplate is a profile style (npKind / npId / npImg / npFit / npOpacity /
  // npDim) drawn behind a name. It decorates the signed-in user's dock and
  // every sender name in GLOBAL chat; never the profile card.
  // Other people's plates come from their published public profile
  // (GET ?type=publicprofile&username=), fetched lazily and cached.
  const PLATE_PRESETS = {
    ember: "linear-gradient(100deg,#5a1209,#d6401f 40%,#ffb347 65%,#5a1209)",
    aurora: "linear-gradient(100deg,#0f2027,#2c7a7b 28%,#6b5bd6 55%,#d65bb0 80%,#0f2027)",
    candy: "linear-gradient(100deg,#ff6ec7,#ffd36e 50%,#6ee7ff)",
    ocean: "repeating-linear-gradient(115deg,#082a4d 0 14px,#0b3d6e 14px 28px)",
    scan: "repeating-linear-gradient(0deg,rgba(255,255,255,.07) 0 1px,transparent 1px 3px),linear-gradient(100deg,#101820,#2b3a4a)",
    halftone: "radial-gradient(circle,rgba(255,255,255,.24) 1.5px,transparent 2px) 0 0/10px 10px,linear-gradient(100deg,#3a1c71,#d76d77)",
  };
  const PLATE_DEFAULT = "linear-gradient(115deg,rgba(255,255,255,.04),rgba(255,255,255,.1))";
  const PLATE_TTL = 5 * 60000;       // fallback refresh interval when a profile version isn't available
  const PLATE_RETRY = 3 * 60000;     // wait before asking again after a failed/missing profile
  const PLATE_PARALLEL = 3;          // public-profile requests in flight at once
  const plates = Object.create(null); // name -> { plate, updated, at, ok, busy }
  const plateQueue = [];
  let plateActive = 0;

  function readOwnProfile() {
    try {
      const savedProfile = window.WS_ProfileStorage
        ? window.WS_ProfileStorage.get("ws_profile_style_main")
        : read("ws_profile_style_main");
      const saved = JSON.parse(savedProfile || "{}");
      if (saved && typeof saved === "object" && !Array.isArray(saved)) return saved;
    } catch (error) {
      console.error("Could not read the saved nameplate profile.", error);
    }
    return {};
  }
  function safePlateImage(value) {
    const image = String(value || "").trim();
    if (/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/i.test(image)) return image;
    try {
      const parsed = new URL(image);
      if (parsed.protocol === "https:") return parsed.href;
    } catch (_) {}
    return "";
  }
  // Only the np* fields are read, and each is checked: profiles are other people's data.
  function sanitizePlate(profile) {
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) return null;
    if (String(profile.npKind || "none") === "none") return null;
    const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
    return {
      image: safePlateImage(profile.npImg),
      preset: Object.prototype.hasOwnProperty.call(PLATE_PRESETS, profile.npId) ? profile.npId : "ember",
      fit: ["cover", "stretch", "tile"].includes(profile.npFit) ? profile.npFit : "cover",
      opacity: num(profile.npOpacity, 10, 100, 100) / 100,
      dim: num(profile.npDim, 0, 80, 30) / 100,
    };
  }
  function plateLook(plate) {
    if (!plate) return { background: PLATE_DEFAULT, size: "cover", repeat: "no-repeat", opacity: "1" };
    const base = plate.image ? `url("${plate.image}")` : PLATE_PRESETS[plate.preset];
    return {
      background: `linear-gradient(90deg,rgba(0,0,0,${plate.dim}),rgba(0,0,0,${plate.dim * 0.45})),${base}`,
      size: plate.image ? (plate.fit === "stretch" ? "100% 100%" : plate.fit === "tile" ? "auto 100%" : "cover") : "cover",
      repeat: plate.image && plate.fit === "tile" ? "repeat-x" : "no-repeat",
      opacity: String(plate.opacity),
    };
  }
  function plateFor(name) {
    const n = cleanName(name);
    if (n && n === state.me) return sanitizePlate(readOwnProfile());
    return plates[n] ? plates[n].plate : null;
  }
  function setPlate(node, plate) {
    const by = node.closest(".by");
    const vars = ["--plate", "--plate-size", "--plate-repeat", "--plate-opacity"];
    if (!plate) {
      node.classList.remove("ws-plated");
      vars.forEach((v) => node.style.removeProperty(v));
      if (by) by.classList.remove("has-plate");
      return;
    }
    const look = plateLook(plate);
    node.classList.add("ws-plated");
    node.style.setProperty("--plate", look.background);
    node.style.setProperty("--plate-size", look.size);
    node.style.setProperty("--plate-repeat", look.repeat);
    node.style.setProperty("--plate-opacity", look.opacity);
    if (by) by.classList.add("has-plate");
  }
  // Global chat only: DMs and every other view show plain names.
  function paintPlates() {
    const global = inGlobal();
    document.querySelectorAll("#thread .grp .by [data-ws-name]").forEach((node) => {
      setPlate(node, global ? plateFor(node.dataset.wsName) : null);
    });
  }
  function wantPlate(name, profileUpdated) {
    const n = cleanName(name);
    if (!API || !NAME_RE.test(n) || n === state.me) return;
    const e = plates[n];
    const expected = Number(profileUpdated) || 0;
    if (e && (e.busy || (e.ok && e.updated >= expected && Date.now() - e.at < PLATE_TTL) ||
        (!e.ok && e.updated >= expected && Date.now() - e.at < PLATE_RETRY))) return;
    plates[n] = { plate: e ? e.plate : null, updated: e ? e.updated : 0, at: e ? e.at : 0, ok: e ? e.ok : true, busy: true, expected };
    if (!plateQueue.includes(n)) plateQueue.push(n);
    pumpPlates();
  }
  function pumpPlates() {
    while (plateActive < PLATE_PARALLEL && plateQueue.length) {
      const n = plateQueue.shift();
      plateActive++;
      loadPlate(n).finally(() => { plateActive--; pumpPlates(); });
    }
  }
  async function loadPlate(n) {
    const prev = plates[n] || {};
    const expected = Number(prev.expected) || 0;
    try {
      const url = new URL(API);
      url.search = new URLSearchParams({ type: "publicprofile", username: n }).toString();
      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data || data.ok !== true || !data.profile || typeof data.profile !== "object" || Array.isArray(data.profile)) throw new Error("no public profile");
      const updated = Number(data.profileUpdated) || 0;
      if (updated < expected) throw new Error("The public profile response is older than its message version.");
      M?.setPublicAvatar?.(n, data.avatar);
      plates[n] = { plate: sanitizePlate(data.profile), updated, at: Date.now(), ok: true, busy: false, expected: 0 };
    } catch (_) {
      // Not published (or the Worker is busy): keep any older plate, retry later.
      plates[n] = { plate: prev.plate || null, updated: prev.updated || 0, at: Date.now(), ok: false, busy: false, expected };
    }
    paintPlates();
  }

  // ── rendering ─────────────────────────────────────────────────────────
  function paintMe() {
    if (!state.me) return;
    const holder = $("meAvatar");
    if (holder.dataset.for !== state.me) {
      holder.dataset.for = state.me;
      holder.textContent = "";
      holder.append(avatar(state.me));
    }
    const profile = readOwnProfile();
    const name = $("meName");
    name.textContent = (typeof profile.nm === "string" ? profile.nm : "").trim() || shown(state.me);
    const fonts = new Set([
      "ui-monospace,Menlo,Consolas,monospace", "Georgia,serif", "'Comic Sans MS','Comic Neue',cursive",
      "Impact,Haettenschweiler,sans-serif", "'Brush Script MT',cursive", "system-ui,sans-serif",
    ]);
    name.style.fontFamily = fonts.has(profile.nf) ? profile.nf : "system-ui,sans-serif";
    name.style.color = /^#[0-9a-f]{3,8}$/i.test(String(profile.nc || "")) ? profile.nc : "#f2f3f5";
    name.style.fontWeight = profile.nb === false ? "400" : "700";
    name.style.fontStyle = profile.ni === true ? "italic" : "normal";
    const stroke = Math.max(0, Math.min(2, Number(profile.no) || 0));
    name.style.webkitTextStroke = `${stroke}px #000`;
    name.style.paintOrder = "stroke fill";
    const dock = $("userNameplate");
    const shield = $("meBotShield");
    if (shield) shield.hidden = !isBotAccount(state.me);
    ["admin", "contributor", "tester"].forEach((role) => {
      const shield = $(`me${role[0].toUpperCase()}${role.slice(1)}Shield`);
      if (shield) shield.hidden = !isRoleAccount(state.me, role);
    });
    if (dock) {
      const look = plateLook(sanitizePlate(profile));
      dock.style.setProperty("--dock-plate", look.background);
      dock.style.setProperty("--dock-plate-size", look.size);
      dock.style.setProperty("--dock-plate-repeat", look.repeat);
      dock.style.setProperty("--dock-opacity", look.opacity);
    }
    paintDockPlate();
    paintPlates();
    $("meUser").textContent = "@" + state.me;
  }
  // The nameplate only decorates the user's own display while Global chat is open.
  function paintDockPlate() {
    const dock = $("userNameplate");
    if (dock) dock.dataset.plate = inGlobal() ? "on" : "off";
  }

  const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const dayKey = (ts) => new Date(ts).toDateString();
  function fmtDay(ts) {
    const d = new Date(ts), now = new Date();
    if (d.toDateString() === now.toDateString()) return "Today";
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return "Yesterday";
    return d.toLocaleDateString([], { month: "short", day: "numeric", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
  }
  // Short stamp for the list: time today, otherwise the date.
  function fmtShort(ts) {
    const d = new Date(ts);
    return d.toDateString() === new Date().toDateString() ? fmtTime(ts) : d.toLocaleDateString([], { month: "short", day: "numeric" });
  }

  const isTyping = (name) => !!M && M.isTyping(name);
  const typingLine = (name) => (M ? M.typingText(name) : "");

  function renderFriends() {
    const list = $("list");
    const keep = list.scrollTop;
    list.textContent = "";
    const incoming = state.friends.filter((f) => f.status === "incoming");
    const friends  = state.friends.filter((f) => f.status === "friend");
    const outgoing = state.friends.filter((f) => f.status === "outgoing");
    const s = seen();

    // Global chat is always first: open to everyone, no friend needed.
    list.append(el("button", { class: "conv-row global" + (inGlobal() ? " on" : ""), type: "button", onclick: () => open(GLOBAL) },
      el("span", { class: "ws-av global-av", "aria-hidden": "true" }, icon("fa-solid fa-earth-americas")),
      el("span", { class: "tx" }, el("span", { class: "nm", text: "Global chat" }), el("span", { class: "pv", text: "Everyone with an account · no friend request needed" }))
    ));
    if (canViewBugReports()) {
      list.append(el("button", { class: "conv-row tester" + (inTester() ? " on" : ""), type: "button", onclick: () => open(TESTER) },
        el("span", { class: "ws-av tester-av", "aria-hidden": "true" }, icon("fa-solid fa-user-shield")),
        el("span", { class: "tx" }, el("span", { class: "nm", text: "Tester channel" }), el("span", { class: "pv", text: isRoleAccount(state.me, "tester") ? "Private tester room" : "Admin moderation access" }))
      ));
      list.append(el("button", { class: "conv-row bug-reports" + (inBugReports() ? " on" : ""), type: "button", onclick: () => open(BUG_REPORTS) },
        el("span", { class: "ws-av bug-reports-av", "aria-hidden": "true" }, icon("fa-solid fa-flag")),
        el("span", { class: "tx" }, el("span", { class: "nm", text: "Bug reports" }), el("span", { class: "pv", text: "Private · testers and admins" }))
      ));
    }
    list.append(el("button", { class: "conv-row mention-row" + (inMentions() ? " on" : "") + (state.mentionUnread ? " unread" : ""), type: "button", onclick: () => open(MENTIONS) },
      el("span", { class: "ws-av mention-av", "aria-hidden": "true" }, icon("fa-solid fa-at")),
      el("span", { class: "tx" }, el("span", { class: "nm", text: "Mentions" }), el("span", { class: "pv", text: state.mentionUnread ? `${state.mentionUnread} unread mention${state.mentionUnread === 1 ? "" : "s"}` : "Messages that mention you" })),
      state.mentionUnread ? el("span", { class: "mention-count", text: String(Math.min(state.mentionUnread, 99)), "aria-label": `${state.mentionUnread} unread mentions` }) : null
    ));

    if (incoming.length) {
      list.append(el("div", { class: "group", text: `Requests (${incoming.length})` }));
      for (const f of incoming) {
        list.append(el("div", { class: "conv-row" },
          avatar(f.name),
          el("span", { class: "tx" }, nameTag("span", f.name, "nm"), el("span", { class: "pv", text: "@" + f.name + " wants to be friends" })),
          el("button", { class: "btn sm", type: "button", title: "Accept", "aria-label": "Accept " + f.name, onclick: () => act("accept", { from: f.name }, `You and @${f.name} are friends now`) }, icon("fa-solid fa-check")),
          el("button", { class: "btn ghost sm", type: "button", title: "Decline", "aria-label": "Decline " + f.name, onclick: () => act("decline", { from: f.name }) }, icon("fa-solid fa-xmark"))
        ));
      }
    }

    list.append(el("div", { class: "group", text: "Conversations" }));
    if (!friends.length) {
      list.append(el("div", { class: "empty", text: incoming.length ? "Accept a request to start chatting." : "No friends yet. Add someone by their username above, or click a name in Global chat." }));
    }
    for (const f of friends) {
      const unread = !!f.last && f.last.from !== state.me && f.last.ts > (s[f.name] || 0) && !(f.name === state.active && visibleNow());
      const typing = isTyping(f.name);
      const lastText = f.last && (f.last.media || f.last.gifUrl
        ? f.last.text ? `${mediaLabel(f.last.media, f.last.gifUrl)}: ${f.last.text}` : mediaLabel(f.last.media, f.last.gifUrl)
        : f.last.text);
      const preview = typing ? typingLine(f.name) : f.last ? (f.last.from === state.me ? "You: " : "") + lastText : "No messages yet";
      list.append(el("button", { class: "conv-row" + (f.name === state.active ? " on" : "") + (unread ? " unread" : ""), type: "button", onclick: () => open(f.name) },
        avatar(f.name),
        el("span", { class: "tx" }, nameTag("span", f.name, "nm"), el("span", { class: "pv" + (typing ? " typing" : ""), text: preview })),
        el("span", { class: "meta" }, f.last ? el("span", { text: fmtShort(f.last.ts) }) : null, unread ? el("span", { class: "dot", title: "New message" }) : null)
      ));
    }

    if (outgoing.length) {
      list.append(el("div", { class: "group", text: "Sent requests" }));
      for (const f of outgoing) {
        list.append(el("div", { class: "conv-row" },
          avatar(f.name),
          el("span", { class: "tx" }, nameTag("span", f.name, "nm"), el("span", { class: "pv", text: "waiting for an answer" })),
          el("button", { class: "btn ghost sm", type: "button", title: "Cancel request", "aria-label": "Cancel request to " + f.name, onclick: () => act("cancel", { to: f.name }, "Request cancelled") }, icon("fa-solid fa-xmark"))
        ));
      }
    }
    list.scrollTop = keep;
  }

  const peerTitle = () => inGlobal() ? "Global chat" : inTester() ? "Tester channel" : inBugReports() ? "Bug reports" : inMentions() ? "Mentions" : shown(state.active);

  function paintUnreadBadge() {
    const count = state.dmUnread + state.mentionUnread;
    $("unreadBadge").hidden = !count;
    $("unreadBadge").textContent = String(count);
    document.title = (count ? `(${count}) ` : "") + "WannaSmile | Messages";
  }

  function renderConversation() {
    const on = !!state.active;
    $("idle").hidden = on;
    $("convBody").hidden = !on;
    if (!on) { $("chat").classList.remove("open"); paintTyping(); return; }
    const holder = $("peerAvatar");
    if (holder.dataset.for !== state.active) {
      holder.dataset.for = state.active;
      holder.textContent = "";
      holder.append(inGlobal()
        ? el("span", { class: "ws-av global-av" }, icon("fa-solid fa-earth-americas"))
        : inTester()
          ? el("span", { class: "ws-av tester-av" }, icon("fa-solid fa-user-shield"))
          : inBugReports()
            ? el("span", { class: "ws-av bug-reports-av" }, icon("fa-solid fa-flag"))
          : inMentions()
            ? el("span", { class: "ws-av mention-av" }, icon("fa-solid fa-at"))
            : avatar(state.active));
    }
    $("peer").textContent = peerTitle();
    const peerProfileButton = $("peerProfileButton");
    peerProfileButton.disabled = inSharedRoom();
    peerProfileButton.setAttribute("aria-label", inSharedRoom() ? peerTitle() : `View @${state.active}'s profile`);
    peerProfileButton.title = inSharedRoom() ? "" : `View @${state.active}'s profile`;
    $("removeBtn").hidden = inSharedRoom();
    $("composerWrap").hidden = inMentions() || inBugReports();
    $("typingRow").hidden = inMentions() || inBugReports();
    const testerReadOnly = inTester() && !canPostTester();
    $("msg").disabled = testerReadOnly;
    $("mediaBtn").disabled = testerReadOnly;
    $("sendBtn").disabled = testerReadOnly;
    $("msg").placeholder = testerReadOnly ? "Tester channel is read-only for admins"
      : inGlobal() ? "Message everyone… (Enter to send)" : inTester() ? "Message testers… (Enter to send)" : "Message… (Enter to send)";
    $("keepNote").textContent = inGlobal()
      ? `global chat is open to everyone with an account · only the latest ${state.max} messages are kept`
      : inTester()
        ? testerReadOnly ? "Admins can review and moderate this private room; tester-role accounts can post"
          : `Only tester-role accounts can post here · latest ${state.max} messages are kept`
        : inBugReports()
          ? "Private report queue · visible to tester and admin accounts"
        : inMentions()
          ? "Recent messages where linked friends mentioned you"
      : `only the latest ${state.max} messages are kept`;
    paintTyping();
    renderThread(false);
  }

  // "<name> is typing..." under the thread and in the header; real flags only.
  function paintTyping() {
    const row = $("typingRow");
    const sub = $("peerSub");
    const on = !!state.active && !inSharedRoom() && isTyping(state.active);
    const line = on ? typingLine(state.active) : "";
    if (sub) {
      sub.className = on ? "typing" : "";
      sub.textContent = on ? line : inGlobal() ? "Everyone with an account can read and post here"
        : inTester() ? "Private tester channel"
          : inBugReports() ? "Community reports for library assets"
          : inMentions() ? "Recent messages where linked friends mentioned you"
            : state.active ? "@" + state.active : "";
    }
    if (!row) return;
    if (!on) { if (row.firstChild) row.textContent = ""; return; }
    if (row.dataset.line === line && row.firstChild) return;
    row.dataset.line = line;
    row.textContent = "";
    const dots = el("span", { class: "ws-dots", "aria-hidden": "true" }, el("i"), el("i"), el("i"));
    row.append(dots, el("span", { text: line }));
    const t = $("thread");
    if (t.scrollHeight - t.scrollTop - t.clientHeight < 120) t.scrollTop = t.scrollHeight;
  }

  function renderThread(forceBottom) {
    const box = $("thread");
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    if (inBugReports()) {
      box.textContent = "";
      renderedMessages.clear();
      renderedDays.clear();
      $("cap").textContent = state.bugReports.length
        ? `${state.bugReports.length}${state.bugReports.length === 100 ? "+" : ""} reports`
        : "";
      renderBugReports(box);
      if (forceBottom || nearBottom) box.scrollTop = box.scrollHeight;
      return;
    }
    if (inMentions()) {
      box.textContent = "";
      renderedMessages.clear();
      renderedDays.clear();
      $("cap").textContent = state.mentionUnread ? `${state.mentionUnread} unread` : `${state.mentions.length} recent`;
      renderMentionInbox(box);
      return;
    }
    const n = state.messages.length;
    $("cap").textContent = n ? `${Math.min(n, state.max)}/${state.max}` : "";
    if (!n) {
      box.textContent = "";
      renderedMessages.clear();
      renderedDays.clear();
      box.append(el("div", { class: "empty", text: state.globalOff && inGlobal()
        ? "Global chat is unavailable right now. Try again in a moment."
        : inGlobal() ? "Nobody has said anything yet. Say hi to everyone!"
          : inTester() ? "No tester messages yet. Start the conversation."
            : `Say hi to ${shown(state.active)}!` }));
      return;
    }
    const desired = [];
    if (n >= state.max) desired.push(el("div", { class: "note", text: "Older messages are deleted automatically to keep the latest " + state.max + "." }));
    const liveKeys = new Set();
    const liveDays = new Set();
    let lastDay = "", prev = null;
    for (let index = 0; index < state.messages.length; index++) {
      const message = state.messages[index];
      const key = Number.isSafeInteger(Number(message.id)) && Number(message.id) > 0
        ? `message-${message.id}` : message.clientKey || `pending-${message.ts}-${index}`;
      const currentDay = dayKey(message.ts);
      if (currentDay !== lastDay) {
        let dayNode = renderedDays.get(currentDay);
        if (!dayNode) {
          dayNode = el("div", { class: "day", text: fmtDay(message.ts), "data-day": currentDay });
          renderedDays.set(currentDay, dayNode);
        }
        desired.push(dayNode);
        liveDays.add(currentDay);
        lastDay = currentDay;
      }
      const continuation = !!prev && prev.from === message.from && dayKey(prev.ts) === currentDay && message.ts - prev.ts <= GROUP_GAP_MS;
      const entry = ensureMessageEntry(message, key);
      entry.row.classList.toggle("continuation", continuation);
      updateMessageEntry(entry, message);
      desired.push(entry.row);
      liveKeys.add(key);
      prev = message;
    }
    renderedDays.forEach((node, day) => {
      if (!liveDays.has(day)) {
        node.remove();
        renderedDays.delete(day);
      }
    });
    renderedMessages.forEach((entry, key) => {
      if (!liveKeys.has(key)) {
        entry.row.remove();
        renderedMessages.delete(key);
      }
    });
    const desiredSet = new Set(desired);
    [...box.children].forEach((child) => { if (!desiredSet.has(child)) child.remove(); });
    desired.forEach((node, index) => {
      const current = box.children[index] || null;
      if (current !== node) box.insertBefore(node, current);
    });
    if (inGlobal()) {
      const versions = new Map(state.messages.map((m) => [m.from, Math.max(Number(m.profileUpdated) || 0, 0)]));
      versions.forEach((updated, name) => wantPlate(name, updated));
    }
    paintPlates();
    if (forceBottom || nearBottom) box.scrollTop = box.scrollHeight;
    resolveJumpTarget();
  }

  function reportUrl(value) {
    try {
      const url = new URL(String(value || ""), location.href);
      return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
    } catch (_) {
      return "";
    }
  }

  function renderBugReports(box) {
    if (state.bugReportError) {
      box.append(el("div", { class: "empty bug-report-empty", role: "status" }, icon("fa-solid fa-triangle-exclamation"), state.bugReportError));
      return;
    }
    if (!state.bugReports.length) {
      box.append(el("div", { class: "empty bug-report-empty" }, icon("fa-regular fa-flag"), "No bug reports yet. New asset reports will appear here."));
      return;
    }

    for (const report of state.bugReports) {
      const reporter = cleanName(report.reporter);
      if (M && NAME_RE.test(reporter)) {
        M.setPublicDisplayName(reporter, report.reporterDisplayName || "");
        if (report.reporterAvatar) M.setPublicAvatar(reporter, report.reporterAvatar);
      }
      const createdAt = Number(report.createdAt);
      const timestamp = Number.isFinite(createdAt) && createdAt > 0
        ? new Date(createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
        : "Time unavailable";
      const displayName = report.reporterDisplayName || shown(reporter);
      const profile = reporter && NAME_RE.test(reporter)
        ? avatar(reporter, "sm")
        : el("span", { class: "ws-av sm", "aria-hidden": "true" }, "?");
      const name = reporter && NAME_RE.test(reporter)
        ? nameTag("span", reporter, "bug-report-name", displayName)
        : el("span", { class: "bug-report-name", text: displayName || "Unknown user" });
      const byline = el("div", { class: "bug-report-byline" },
        profile,
        el("span", { class: "bug-report-reporter" },
          el("span", { class: "bug-report-reporter-name" }, name),
          el("span", { class: "bug-report-reporter-meta", text: `@${reporter || "unknown"} · reported an asset` })
        ),
        el("time", {
          class: "bug-report-time",
          dateTime: Number.isFinite(createdAt) && createdAt > 0 ? new Date(createdAt).toISOString() : "",
          text: timestamp,
        })
      );

      const iconBox = el("span", { class: "bug-report-icon" }, icon("fa-regular fa-image"));
      const imageUrl = reportUrl(report.assetImage);
      if (imageUrl) {
        const image = el("img", { alt: "", loading: "lazy", referrerpolicy: "no-referrer" });
        image.addEventListener("error", () => {
          image.remove();
          iconBox.append(icon("fa-regular fa-image"));
        }, { once: true });
        image.src = imageUrl;
        iconBox.textContent = "";
        iconBox.append(image);
      }
      const assetTitle = String(report.assetTitle || "Untitled asset");
      const link = reportUrl(report.assetLink);
      const title = link
        ? el("a", { class: "bug-report-asset-title", href: link, target: "_blank", rel: "noopener noreferrer" }, assetTitle)
        : el("strong", { class: "bug-report-asset-title", text: assetTitle });
      const author = String(report.assetAuthor || "").trim();
      const page = Math.max(1, Number.parseInt(report.page, 10) || 1);
      const details = el("div", { class: "bug-report-asset-details" },
        el("span", { class: "bug-report-label", text: "Reported asset" }),
        title,
        el("span", { class: "bug-report-author", text: author ? `by ${author}` : "by unknown author" }),
        el("span", { class: "bug-report-reason", text: `Reason: ${String(report.reason || "Unspecified")}` }),
        el("span", { class: "bug-report-page", text: `Page ${page}` })
      );
      box.append(el("article", {
        class: "bug-report-card",
        "aria-label": `${displayName || reporter || "Unknown user"} reported ${assetTitle}`,
      }, byline, el("div", { class: "bug-report-preview" }, iconBox, details)));
    }
  }

  function ensureMessageEntry(message, key) {
    let entry = renderedMessages.get(key);
    if (entry) return entry;
    const mine = message.from === state.me;
    const person = (node) => {
      if (mine) return node;
      if (inGlobal()) return el("button", {
        class: "who-btn", type: "button", title: "@" + message.from, "aria-label": "Options for " + shown(message.from),
        onclick: (event) => showUserMenu(message.from, event.currentTarget),
      }, node);
      return el("button", {
        class: "who-btn", type: "button", title: `View @${message.from}'s profile`, "aria-label": `View ${shown(message.from)}'s profile`,
        onclick: () => openPublicProfile(message.from),
      }, node);
    };
    const identity = person(nameTag("b", message.from, "", inGlobal() ? message.profileName : undefined));
    const edited = el("small", { class: "message-edited", text: "edited", hidden: true });
    const header = el("div", { class: "by" }, identity, " · ", el("span", { class: "message-time" }), " ", edited);
    const avatarButton = person(avatar(message.from, "sm"));
    avatarButton.classList.add("message-avatar");
    const body = el("div", { class: "message-body" });
    const textSlot = el("div", { class: "message-text-slot" });
    body.append(textSlot);
    const line = el("div", { class: "message-line", "data-message-id": Number(message.id) || null }, body);
    const replyButton = el("button", {
      class: "message-action message-reply", type: "button", title: "Reply to this message",
      "aria-label": `Reply to ${shown(message.from)}'s message`,
      onclick: () => setReplyTarget(state.messages.find((candidate) => Number(candidate.id) === Number(message.id))),
    }, icon("fa-solid fa-reply"));
    const editButton = el("button", {
      class: "message-action", type: "button", title: "Edit message", "aria-label": "Edit message",
      onclick: () => { state.editingId = Number(message.id); renderThread(false); },
    }, icon("fa-solid fa-pen"));
    const deleteButton = el("button", {
      class: "message-action", type: "button", title: "Delete message", "aria-label": "Delete message",
      onclick: () => deleteMessage(Number(message.id)),
    }, icon("fa-solid fa-trash"));
    const actions = el("div", { class: "message-actions" }, replyButton, editButton, deleteButton);
    line.append(actions);
    const stack = el("div", { class: "stack" }, header, line);
    const row = el("div", { class: "grp " + (mine ? "me" : "them"), "data-message-key": key }, avatarButton, stack);
    entry = {
      key, row, line, header, identity, edited, time: header.querySelector(".message-time"),
      avatarButton, body, textSlot, replyButton, editButton, deleteButton,
      replyNode: null, replyKey: "", mediaNode: null, mediaKey: "", bubble: null, bubbleKey: "",
      editor: null, editorKey: "",
    };
    renderedMessages.set(key, entry);
    return entry;
  }

  function updateMessageEntry(entry, message) {
    const id = Number(message.id) || 0;
    entry.line.dataset.messageId = id || "";
    entry.line.classList.toggle("mention-target", id > 0 && id === state.highlightId);
    const display = inGlobal() && typeof message.profileName === "string"
      ? message.profileName.trim().slice(0, 30) || cleanName(message.from) : shown(message.from);
    entry.identity.dataset.wsDisplay = display;
    const identityText = entry.identity.querySelector(".ws-name-text");
    if (identityText) identityText.textContent = display;
    entry.time.textContent = message.pending ? "sending…" : fmtTime(message.ts);
    entry.edited.hidden = !message.editedAt;
    const editAllowed = canEditMessage(message);
    const deleteAllowed = canDeleteMessage(message);
    entry.replyButton.hidden = !id || message.pending || (inTester() && !canPostTester());
    entry.editButton.hidden = !editAllowed;
    entry.deleteButton.hidden = !deleteAllowed;
    for (const button of [entry.replyButton, entry.editButton, entry.deleteButton]) {
      button.disabled = state.messageBusy.has(`${button === entry.editButton ? "edit" : button === entry.deleteButton ? "delete" : "reply"}:${id}`);
    }

    const reply = message.replyTo || null;
    const replyKey = reply ? JSON.stringify([reply.id, reply.from, reply.text, reply.media, reply.gifUrl, reply.unavailable]) : "";
    if (replyKey !== entry.replyKey) {
      entry.replyNode?.remove();
      entry.replyNode = reply ? (reply.unavailable
        ? el("div", { class: "reply-quote" }, el("b", { text: "Original message" }), el("span", { text: "This message is no longer available" }))
        : el("div", { class: "reply-quote" }, el("b", { text: shown(reply.from) }), el("span", { text: reply.text || mediaLabel(reply.media, reply.gifUrl) }))) : null;
      entry.replyKey = replyKey;
      if (entry.replyNode) entry.body.insertBefore(entry.replyNode, entry.body.firstChild);
    }

    const media = normalizeMedia(message.media) || (normalizeGifUrl(message.gifUrl) ? { kind: "image", url: normalizeGifUrl(message.gifUrl) } : null);
    const mediaKey = media ? JSON.stringify(media) : "";
    if (mediaKey !== entry.mediaKey) {
      entry.mediaNode?.remove();
      entry.mediaNode = media ? renderMessageMedia(media) : null;
      entry.mediaKey = mediaKey;
      if (entry.mediaNode) entry.body.insertBefore(entry.mediaNode, entry.textSlot);
    }
    const textKey = JSON.stringify([message.text || "", message.mentions || [], message.pending ? 1 : 0]);
    if (textKey !== entry.bubbleKey) {
      entry.bubble = message.text ? renderMessageText(message) : null;
      if (entry.bubble) entry.bubble.title = message.pending ? "" : fmtTime(message.ts);
      entry.bubbleKey = textKey;
      if (entry.editor && state.editingId === id) {
        entry.editor.textarea.value = message.text || "";
      } else {
        entry.textSlot.replaceChildren(...(entry.bubble ? [entry.bubble] : []));
      }
    }
    const editing = id > 0 && state.editingId === id;
    if (editing && !entry.editor) {
      const textarea = el("textarea", { class: "message-edit-input", maxlength: MAX_TEXT, "aria-label": "Edit message" });
      textarea.value = message.text || "";
      const save = el("button", {
        class: "btn sm", type: "button", text: "Save",
        onclick: () => saveMessageEdit(id, textarea),
      });
      const cancel = el("button", {
        class: "btn ghost sm", type: "button", text: "Cancel",
        onclick: () => { state.editingId = 0; renderThread(false); },
      });
      const controls = el("div", { class: "message-edit-controls" }, save, cancel);
      entry.editor = { textarea, node: el("div", { class: "message-editor" }, textarea, controls) };
      textarea.addEventListener("keydown", (event) => {
        if (event.key === "Escape") { state.editingId = 0; renderThread(false); }
        else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); saveMessageEdit(id, textarea); }
      });
      entry.textSlot.replaceChildren(entry.editor.node);
      textarea.focus({ preventScroll: true });
    } else if (!editing && entry.editor) {
      entry.editor.node.remove();
      entry.editor = null;
      entry.textSlot.replaceChildren(...(entry.bubble ? [entry.bubble] : []));
    }
  }

  function renderMessageMedia(media) {
    const frame = el("div", { class: `shared-media shared-media-${media.kind}` });
    const fallback = () => {
      frame.textContent = "";
      frame.append(el("span", { class: "gif-failed", text: "Media unavailable" }));
    };
    if (media.kind === "image") {
      const image = el("img", {
        class: "chat-gif", src: media.url, alt: media.title || "Shared image or GIF",
        loading: "lazy", decoding: "async", referrerpolicy: "no-referrer",
      });
      image.addEventListener("error", fallback, { once: true });
      frame.append(image);
    } else if (media.kind === "video") {
      const video = el("video", { controls: true, preload: "metadata", playsinline: true, referrerpolicy: "no-referrer" });
      video.src = media.url;
      video.addEventListener("error", fallback, { once: true });
      frame.append(video);
    } else if (media.kind === "audio") {
      const audio = el("audio", { controls: true, preload: "metadata" });
      audio.src = media.url;
      audio.addEventListener("error", fallback, { once: true });
      frame.append(audio);
    } else if (media.kind === "youtube" || media.kind === "spotify") {
      const iframe = el("iframe", {
        src: media.url, title: media.title || (media.kind === "youtube" ? "YouTube video" : "Spotify player"),
        loading: "lazy", referrerpolicy: "strict-origin-when-cross-origin",
        sandbox: "allow-scripts allow-same-origin allow-presentation",
        allow: "autoplay; encrypted-media; fullscreen; picture-in-picture",
      });
      frame.append(iframe);
    } else {
      let url;
      try { url = new URL(media.url); } catch (_) { return frame; }
      const anchor = el("a", {
        href: url.href, target: "_blank", rel: "noopener noreferrer nofollow",
        class: "shared-link",
      }, icon("fa-solid fa-arrow-up-right-from-square"), el("span", {},
        el("b", { text: media.title || url.hostname }),
        el("small", { text: url.hostname })));
      frame.append(anchor);
    }
    return frame;
  }

  function renderMessageText(message) {
    const text = String(message.text || "");
    const bubble = el("div", { class: "bubble" + (message.pending ? " pending" : ""), title: message.pending ? "" : fmtTime(message.ts) });
    const mentioned = [...new Set((Array.isArray(message.mentions) ? message.mentions : []).map(cleanName))]
      .filter((name) => NAME_RE.test(name))
      .sort((a, b) => b.length - a.length);
    if (!mentioned.length) {
      bubble.textContent = text;
      return bubble;
    }
    const pattern = new RegExp(`(^|\\s)@(${mentioned.map(escapeRegExp).join("|")})(?=$|[\\s.,!?;:)])`, "gi");
    let cursor = 0, match;
    while ((match = pattern.exec(text))) {
      const start = match.index + match[1].length;
      bubble.append(document.createTextNode(text.slice(cursor, start)));
      bubble.append(el("span", { class: "message-mention", text: match[0].slice(match[1].length) }));
      cursor = start + match[2].length + 1;
    }
    bubble.append(document.createTextNode(text.slice(cursor)));
    return bubble;
  }

  function renderMentionInbox(box) {
    if (!state.mentions.length) {
      box.append(el("div", { class: "empty mention-empty", text: "No mentions yet. When a linked friend mentions you in Global chat or your conversation, it will appear here." }));
      return;
    }
    for (const item of state.mentions) {
      const message = item.message || {};
      const preview = message.text || mediaLabel(message.media, message.gifUrl) || "Mentioned you";
      const context = item.room === "global" ? "Global chat" : `Conversation with @${item.with}`;
      box.append(el("button", {
        class: "mention-item" + (item.readAt == null ? " unread" : ""),
        type: "button",
        onclick: () => openMention(item),
        "aria-label": `${item.readAt == null ? "Unread mention" : "Mention"} from ${shown(message.from)} in ${context}`,
      },
        avatar(message.from, "sm"),
        el("span", { class: "mention-copy" },
          el("span", { class: "mention-heading" }, nameTag("b", message.from), el("small", { text: context })),
          el("span", { class: "mention-preview", text: preview })),
        el("span", { class: "mention-time", text: fmtShort(message.ts) }),
        item.readAt == null ? el("span", { class: "dot", title: "Unread mention" }) : null
      ));
    }
  }

  async function openMention(item) {
    const message = item.message || {};
    if (item.readAt == null) {
      try {
        const result = await post("mention_seen", { id: item.mentionId });
        if (!result || result.ok !== true) throw new Error(result?.error || "That mention could not be marked as read.");
        item.readAt = Date.now();
        state.mentionUnread = Math.max(0, state.mentionUnread - 1);
        paintUnreadBadge();
        renderFriends();
      } catch (error) {
        toast(error.message || "That mention could not be marked as read.");
        refresh(true);
      }
    }
    state.highlightId = Number(message.id) || 0;
    open(item.room === "global" ? GLOBAL : cleanName(item.with), state.highlightId);
  }

  function resolveJumpTarget() {
    if (!state.jumpToId || !state.messages.length) return;
    const target = [...$("thread").querySelectorAll("[data-message-id]")].find((node) => Number(node.dataset.messageId) === state.jumpToId);
    if (!target) return;
    const id = state.jumpToId;
    state.highlightId = id;
    target.classList.add("mention-target");
    target.tabIndex = -1;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.focus({ preventScroll: true });
    state.jumpToId = 0;
    window.setTimeout(() => {
      if (state.highlightId === id) state.highlightId = 0;
      target.classList.remove("mention-target");
    }, 2800);
  }

  // Everything WS_Msg can change under us: typing flags, profiles (names/pictures), unread.
  function onMsgChange(detail) {
    paintTyping();
    renderFriends();
    refreshNames();
    if (state.active) $("peer").textContent = peerTitle();
    paintMe();
    state.dmUnread = detail && detail.unread ? detail.unread.length : 0;
    paintUnreadBadge();
  }

  // ── the little menu on a name in global chat ──────────────────────────
  function closeUserMenu() {
    const m = $("userMenu");
    if (m) { m.hidden = true; m.dataset.for = ""; }
  }

  function showUserMenu(name, anchor) {
    const menu = $("userMenu");
    if (!menu) return;
    if (!menu.hidden && menu.dataset.for === name) return closeUserMenu();   // same name again = toggle
    const f = state.friends.find((x) => x.name === name);
    const go = (fn) => () => { closeUserMenu(); fn(); };
    let action;
    if (f && f.status === "friend") {
      action = el("button", { class: "btn sm", type: "button", onclick: go(() => open(name)) }, icon("fa-solid fa-comment"), " Message");
    } else if (f && f.status === "incoming") {
      action = el("button", { class: "btn sm", type: "button", onclick: go(() => act("accept", { from: name }, `You and @${name} are friends now`)) }, icon("fa-solid fa-check"), " Accept request");
    } else if (f && f.status === "outgoing") {
      action = el("button", { class: "btn ghost sm", type: "button", disabled: true }, icon("fa-solid fa-hourglass-half"), " Request sent");
    } else {
      action = el("button", { class: "btn sm", type: "button", onclick: go(() => sendRequest(name)) }, icon("fa-solid fa-user-plus"), " Add friend");
    }
    menu.textContent = "";
    menu.append(
      el("div", { class: "um-head" }, avatar(name, "sm"), el("span", { class: "um-who" }, nameTag("b", name), el("small", { text: "@" + name }))),
      el("button", { class: "btn ghost sm", type: "button", onclick: go(() => openPublicProfile(name)) }, icon("fa-solid fa-id-card"), " View profile"),
      action
    );
    menu.dataset.for = name;
    menu.hidden = false;
    // Under the name that was clicked, kept inside the window.
    const r = anchor.getBoundingClientRect();
    const w = menu.offsetWidth, h = menu.offsetHeight;
    const left = Math.max(8, Math.min(r.left, innerWidth - w - 8));
    const top = r.bottom + 6 + h > innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6;
    menu.style.left = left + "px";
    menu.style.top = top + "px";
    (menu.querySelector("button:not([disabled])") || menu).focus({ preventScroll: true });
  }

  document.addEventListener("click", (e) => {
    const m = $("userMenu");
    if (m && !m.hidden && !m.contains(e.target) && !(e.target.closest && e.target.closest(".who-btn"))) closeUserMenu();
  });
  document.addEventListener("keydown", (e) => {
    if ($("mediaPicker").hidden) {
      if (e.key === "Escape") closeUserMenu();
      return;
    }
    if (e.key === "Escape") {
      closeMediaPicker(true);
      e.stopPropagation();
      return;
    }
    if (e.key !== "Tab") return;
    const focusable = [...$("mediaPicker").querySelectorAll('button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')]
      .filter((node) => !node.hidden);
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && (document.activeElement === first || !$("mediaPicker").contains(document.activeElement))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (document.activeElement === last || !$("mediaPicker").contains(document.activeElement))) {
      e.preventDefault();
      first.focus();
    }
  });
  window.addEventListener("resize", closeUserMenu);
  $("thread").addEventListener("scroll", closeUserMenu, { passive: true });

  // ── start ─────────────────────────────────────────────────────────────
  function start() {
    if (!API) return gate("Chat can't start", "The site's data address (endpoints.js) is missing.", "Back to WannaSmile");

    const approved = read(K.status) === "approved" && !!read(K.id) && !!read(K.key);
    if (!approved) return gate("Sign in to chat", "Guest mode can browse WannaSmile, but Global Chat requires a verified account. Sign in on the homepage, then return here.", "Go to WannaSmile");

    if (typeof window.WS_ProfileApply !== "function") {
      window.WS_ProfileApply = (profile) => {
        if (!profile || typeof profile !== "object" || Array.isArray(profile)) return false;
        try {
          window.WS_ProfileStorage
            ? window.WS_ProfileStorage.set("ws_profile_style_main", JSON.stringify(profile))
            : localStorage.setItem("ws_profile_style_main", JSON.stringify(profile));
          paintMe();
          return true;
        } catch (error) {
          console.error("Could not save the profile nameplate.", error);
          return false;
        }
      };
    }
    // The username is on hand straight away from the signed-in account; the
    // server's answer (state.me) replaces it once the first poll lands.
    state.me = read(K.user).toLowerCase();
    $("app").hidden = false;
    paintMe();
    renderFriends();
    updateCount();
    $("userNameplate").addEventListener("click", () => {
      if (typeof window.openProfileOverlay === "function") window.openProfileOverlay();
      else toast("Your profile editor is unavailable right now.");
    });
    $("logoutAccount")?.addEventListener("click", async (event) => {
      event.preventDefault();
      const button = event.currentTarget;
      button.disabled = true;
      try {
        if (!window.WS_Ticket?.logout) throw new Error("The account service could not sign out.");
        await window.WS_Ticket.logout();
        gate("You are signed out", "You have been logged out on this device. Sign in on the WannaSmile homepage to chat again.", "Go to WannaSmile");
      } catch (error) {
        console.error("[chat] couldn't log out:", error);
        gate("Signed out on this device", error.message || "The server could not revoke this session.", "Go to WannaSmile");
      } finally {
        button.disabled = false;
      }
    });

    if (M) {
      // A notification (or the DM button) asking for a conversation while this page is open.
      M.setOpenHandler((name) => {
        if (state.friends.some((f) => f.name === name && f.status === "friend")) open(name);
        else { state.wanted = name; openWanted(); }
        window.focus();
      });
      M.on(onMsgChange);
    }
    // The word filter list (global chat is public) loads in the background.
    try { window.WS_WordFilter && window.WS_WordFilter.load(); } catch (_) {}
    // A link to a conversation wins; otherwise a wide window opens Global chat,
    // so there's something to read straight away (on a phone the list comes first).
    const linked = wantFromHash();
    window.addEventListener("hashchange", () => { wantFromHash(); });
    if (!linked && !state.wanted && window.matchMedia("(min-width: 761px)").matches) open(GLOBAL);
    else if (!inGlobal()) refresh(true);

    document.addEventListener("visibilitychange", () => { if (!document.hidden) { refresh(false); markActiveSeen(); renderFriends(); } });
    window.addEventListener("focus", () => { refresh(false); markActiveSeen(); renderFriends(); });
    window.addEventListener("online", () => { state.fails = 0; refresh(true); });
    // Signing out (or an expired session) in another tab ends this chat.
    window.addEventListener("storage", (e) => {
      if (e.key === K.status && e.newValue !== "approved") gate("Sign in to chat", "Your account session ended. Sign in on the WannaSmile homepage, then return here.", "Go to WannaSmile");
      else if (e.key === K.seen) renderFriends();
      else if (e.key === window.WS_ProfileStorage?.key("ws_profile_style_main")) paintMe();
      else if ([window.WS_ProfileStorage?.key("profilePic"), window.WS_ProfileStorage?.key("nickname"), window.WS_ProfileStorage?.key("pfpPixelated")].includes(e.key)) paintMe();
    });
  }

  start();
})();
