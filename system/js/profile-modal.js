// Profile modal. The card is pages/profile-testing/ embedded in an
// iframe (?embed=1). Public profiles can expand from a card preview to a full view.
// The two buttons underneath swap: Edit/Close <-> Disregard/Save.
(() => {
  "use strict";
  const SCRIPT_SRC = document.currentScript?.src || location.href;
  const FRAME_URL = new URL("../pages/profile-testing/index.html", SCRIPT_SRC).href;
  const $ = (id) => document.getElementById(id);
  const modal = $("profileModal");
  if (!modal) return;
  const card = $("profileModalCard");
  const frame = $("profileModalFrame");
  const primary = $("profileModalPrimary");
  const secondary = $("profileModalSecondary");
  const effects = document.createElement("canvas");
  effects.className = "pfm-effects";
  effects.setAttribute("aria-hidden", "true");
  effects.hidden = true;
  modal.prepend(effects);
  const LABELS = {
    view: [["fa-pen", "Edit"], ["fa-xmark", "Close"]],
    edit: [["fa-rotate-left", "Disregard"], ["fa-floppy-disk", "Save"]],
  };
  let stage = "view";
  let saving = null;
  let publicProfile = null;
  let frameHeight = 420;
  let fxType = "none";
  let fxCount = 0;
  let fxParts = [];
  let fxRaf = 0;
  let fxWidth = 0;
  let fxHeight = 0;
  const fxContext = effects.getContext("2d");
  const FX_TYPES = new Set(["snow", "rain", "embers", "stars"]);

  const toast = (m) => { if (typeof window.showToast === "function") window.showToast(m); };
  const post = (message) => { try { frame.contentWindow?.postMessage(message, "*"); } catch (_) {} };
  const isOpen = () => modal.classList.contains("visible");
  function fitFrame() {
    const viewportHeight = window.visualViewport?.height || window.innerHeight;
    const availableHeight = Math.max(160, viewportHeight - 88);
    const requestedHeight = stage === "edit" ? viewportHeight
      : stage === "full" ? Math.min(availableHeight, 740) : frameHeight;
    card.style.setProperty("--pfm-h", `${Math.min(requestedHeight, availableHeight)}px`);
  }
  function resizeEffects() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    fxWidth = width;
    fxHeight = height;
    effects.width = Math.round(width * dpr);
    effects.height = Math.round(height * dpr);
    fxContext?.setTransform(dpr, 0, 0, dpr, 0, 0);
    fxParts.forEach((part) => {
      part.x = Math.min(width, part.x);
      part.y = Math.min(height, part.y);
    });
  }
  function stopEffects() {
    cancelAnimationFrame(fxRaf);
    fxRaf = 0;
    fxType = "none";
    fxCount = 0;
    fxParts = [];
    effects.hidden = true;
    fxContext?.clearRect(0, 0, fxWidth, fxHeight);
  }
  function setEffects(type, count) {
    if (!isOpen() || !FX_TYPES.has(type) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      stopEffects();
      return;
    }
    const nextCount = Math.max(10, Math.min(150, Number(count) || 60));
    if (type === fxType && nextCount === fxCount && fxRaf) return;
    fxType = type;
    fxCount = nextCount;
    effects.hidden = false;
    resizeEffects();
    fxParts = Array.from({ length: fxCount }, () => ({
      x: Math.random() * fxWidth,
      y: Math.random() * fxHeight,
      size: 1 + Math.random() * 2.5,
      speed: 0.4 + Math.random() * 1.2,
      phase: Math.random() * 6,
    }));
    if (!fxRaf) drawEffects();
  }
  function drawEffects() {
    fxContext?.clearRect(0, 0, fxWidth, fxHeight);
    fxParts.forEach((part) => {
      part.phase += 0.03;
      if (fxType === "snow") {
        part.y += part.speed;
        part.x += Math.sin(part.phase) * 0.5;
        fxContext.fillStyle = "rgba(255,255,255,.85)";
        fxContext.beginPath();
        fxContext.arc(part.x, part.y, part.size, 0, Math.PI * 2);
        fxContext.fill();
      } else if (fxType === "rain") {
        part.y += part.speed * 6;
        fxContext.strokeStyle = "rgba(150,190,255,.6)";
        fxContext.beginPath();
        fxContext.moveTo(part.x, part.y);
        fxContext.lineTo(part.x - 2, part.y + 9);
        fxContext.stroke();
      } else if (fxType === "embers") {
        part.y -= part.speed;
        part.x += Math.sin(part.phase);
        fxContext.fillStyle = `rgba(255,${120 + part.size * 40 | 0},40,.85)`;
        fxContext.fillRect(part.x, part.y, part.size, part.size);
      } else {
        fxContext.fillStyle = `rgba(255,255,200,${0.4 + Math.sin(part.phase * 2) * 0.4})`;
        fxContext.fillRect(part.x, part.y, part.size, part.size);
      }
      if (part.y > fxHeight + 10) part.y = -10;
      if (part.y < -10) part.y = fxHeight + 10;
      if (part.x > fxWidth + 10) part.x = -10;
      if (part.x < -10) part.x = fxWidth + 10;
    });
    if (fxType !== "none") fxRaf = requestAnimationFrame(drawEffects);
    else fxRaf = 0;
  }

  function paintButtons() {
    primary.hidden = !!publicProfile;
    if (publicProfile) {
      secondary.dataset.mode = "view";
      secondary.querySelector("i").className = "fa-solid fa-xmark";
      secondary.querySelector("span").textContent = "Close";
      secondary.disabled = false;
      return;
    }
    [primary, secondary].forEach((btn, i) => {
      const [icon, text] = LABELS[stage][i];
      btn.dataset.mode = stage;
      btn.querySelector("i").className = `fa-solid ${icon}`;
      btn.querySelector("span").textContent = text;
      btn.disabled = false;
    });
  }
  function setStage(next) {
    stage = next;
    modal.dataset.stage = next;
    paintButtons();
    post({ type: "ws-profile-modal-stage", stage: next });
    fitFrame();
  }
  function loadFrame() {
    card.dataset.loading = "true";
    const url = new URL(FRAME_URL);
    url.searchParams.set("embed", "1");
    url.searchParams.set("stage", "view");
    if (publicProfile) {
      url.searchParams.set("public", "1");
      url.searchParams.set("username", publicProfile.username);
    }
    frame.src = url.href;
  }
  function open() {
    window.WS_WordFilter?.load?.();
    publicProfile = null;
    stage = "view";
    modal.dataset.stage = "view";
    frameHeight = 420;
    paintButtons();
    fitFrame();
    loadFrame();
    modal.classList.add("visible");
    document.body.classList.add("profile-modal-open");
    modal.setAttribute("aria-hidden", "false");
    primary.focus({ preventScroll: true });
  }
  async function openPublic(username) {
    const name = String(username || "").trim().replace(/^@/, "").toLowerCase();
    if (!/^[a-z0-9][a-z0-9_.-]{2,19}$/.test(name)) {
      toast("That profile could not be opened.");
      return;
    }
    const endpoint = window.WS_ENDPOINTS?.chat;
    if (!endpoint) {
      toast("Public profiles are unavailable right now.");
      return;
    }
    try {
      const url = new URL(endpoint);
      url.search = new URLSearchParams({ type: "publicprofile", username: name }).toString();
      const response = await fetch(url, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok || result?.ok !== true || !result.profile || typeof result.profile !== "object" || Array.isArray(result.profile)) {
        throw new Error(result?.error || `HTTP ${response.status}`);
      }
      publicProfile = {
        username: name,
        profile: result.profile,
        activity: Array.isArray(result.activity) ? result.activity : [],
        friends: Array.isArray(result.friends) ? result.friends : [],
      };
      stage = "view";
      modal.dataset.stage = "view";
      modal.setAttribute("aria-label", `Public profile for @${name}`);
      frameHeight = 420;
      paintButtons();
      fitFrame();
      loadFrame();
      modal.classList.add("visible");
      document.body.classList.add("profile-modal-open");
      modal.setAttribute("aria-hidden", "false");
      secondary.focus({ preventScroll: true });
    } catch (error) {
      console.error("Could not load a public profile.", error);
      toast(error.message || "Could not load that profile.");
    }
  }
  function close() {
    if (!isOpen()) return;
    modal.classList.remove("visible");
    document.body.classList.remove("profile-modal-open");
    modal.setAttribute("aria-hidden", "true");
    stopEffects();
    frame.src = "about:blank";
    stage = "view";
    publicProfile = null;
    modal.setAttribute("aria-label", "Profile");
  }
  function disregard() {
    stage = "view";
    modal.dataset.stage = "view";
    paintButtons();
    loadFrame(); // reload = the editor's unsaved changes are dropped
    primary.focus({ preventScroll: true });
  }
  function save() {
    if (saving) return;
    primary.disabled = secondary.disabled = true;
    post({ type: "ws-profile-modal-action", action: "save" });
    saving = setTimeout(() => { saving = null; if (stage === "edit") paintButtons(); }, 1500);
  }

  primary.addEventListener("click", () => (stage === "view" ? setStage("edit") : disregard()));
  secondary.addEventListener("click", () => (publicProfile || stage !== "edit" ? close() : save()));
  modal.addEventListener("click", (e) => { if (e.target === modal && stage !== "edit") close(); });

  window.addEventListener("message", (e) => {
    if (e.source !== frame.contentWindow || e.origin !== location.origin) return;
    const d = e.data || {};
    if (d.type === "ws-profile-modal-ready") {
      if (publicProfile) post({
        type: "ws-public-profile",
        username: publicProfile.username,
        profile: publicProfile.profile,
        activity: publicProfile.activity,
        friends: publicProfile.friends,
      });
      else card.dataset.loading = "false";
    } else if (d.type === "ws-public-profile-ready" && publicProfile) card.dataset.loading = "false";
    else if (d.type === "ws-profile-modal-full" && publicProfile) setStage(d.open === false ? "view" : "full");
    else if (d.type === "ws-profile-modal-size") {
      if (Number.isFinite(d.height) && d.height > 0) frameHeight = d.height;
      fitFrame();
    } else if (d.type === "ws-profile-modal-effects") {
      setEffects(d.effect, d.count);
    } else if (d.type === "ws-profile-modal-saved") {
      clearTimeout(saving); saving = null;
      setStage("view");
      let profile;
      try { profile = JSON.parse(localStorage.getItem("ws_profile_style_main") || "null"); }
      catch (error) { console.error("Could not read the saved public profile.", error); }
      if (!profile || !window.WS_Msg?.publishPublicProfile) {
        toast("Profile saved locally, but it could not be published to global chat.");
      } else {
        window.WS_Msg.publishPublicProfile(profile).then((result) => {
          toast(result.ok ? "Profile saved and published to global chat." : `Profile saved locally. ${result.error}`);
        }).catch((error) => {
          console.error("Could not publish the saved profile.", error);
          toast("Profile saved locally, but publishing it failed.");
        });
      }
    } else if (d.type === "ws-profile-modal-close") {
      stage === "edit" ? disregard() : close();
    }
  });

  // Esc: drop edits first, then close. Capture phase so it never reaches the
  // panic key handler; other keys stay inside the modal.
  document.addEventListener("keydown", (e) => {
    if (!isOpen()) return;
    if (e.key === "Escape") {
      e.preventDefault(); e.stopImmediatePropagation();
      stage === "edit" ? disregard() : close();
    } else if (modal.contains(e.target) && e.key !== "Tab") {
      e.stopPropagation();
    }
  }, true);

  window.addEventListener("resize", () => { fitFrame(); resizeEffects(); });
  window.visualViewport?.addEventListener("resize", fitFrame);

  window.openProfileOverlay = open;
  window.openPublicProfileOverlay = openPublic;
  window.closeProfileOverlay = close;
})();
