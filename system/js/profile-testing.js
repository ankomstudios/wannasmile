(() => {

"use strict";
const EMBEDDED_PROFILE = new URLSearchParams(location.search).get("embed") === "1";
if (EMBEDDED_PROFILE) {
  document.getElementById("profilePanelIntro").textContent = "Pick a section to edit it. Save Profile applies your changes to the live profile.";
}
const KEY = EMBEDDED_PROFILE ? "ws_profile_style_modal_draft" : "ws_profile_style_test";
const MAIN_PROFILE_KEY = "ws_profile_style_main";
const HOST_ORIGIN = location.origin === "null" ? "*" : location.origin;
const PROFILE_IMAGE_DIR = "https://raw.githubusercontent.com/securlydetected/assets/refs/heads/main/";
const PROFILE_PLACEHOLDER = `${PROFILE_IMAGE_DIR}placeholders/profile.png`;
const LOCAL_FRAME_MEDIA = [
  { label: "Bloody", url: `${PROFILE_IMAGE_DIR}frames/bloody.png`, scale: 120 },
  { label: "Flowers", url: `${PROFILE_IMAGE_DIR}frames/flowers.png`, scale: 120 }
];
const PRESET_MEDIA = {
  avatar: [
    { label: "Default", value: "https://raw.githubusercontent.com/bguhm/bguhm.github.io/main/system/images/profile.png" },
    { label: "Smile", value: "https://cdn.jsdelivr.net/gh/mcmattyobriore/yogurtyooo.github.io@main/system/images/profile/smile.png" },
    { label: "Glitched", value: "https://cdn.jsdelivr.net/gh/mcmattyobriore/yogurtyooo.github.io@main/system/images/profile/glitched.jpeg" },
    { label: "Dream", value: "https://cdn.jsdelivr.net/gh/mcmattyobriore/yogurtyooo.github.io@main/system/images/profile/dream.jpeg" },
    { label: "Starwalk", value: "https://cdn.jsdelivr.net/gh/mcmattyobriore/yogurtyooo.github.io@main/system/images/profile/starwalk.jpeg" }
  ],
  frame: [
    { label: "Golden", value: "https://raw.githubusercontent.com/wannasmile4evr/mediabaseWS/refs/heads/main/frames/golden/splash.png" },
    { label: "Eyepatch", value: "https://raw.githubusercontent.com/wannasmile4evr/mediabaseWS/refs/heads/main/frames/eyepatch/splash.png" },
    ...LOCAL_FRAME_MEDIA.map(({ label, url }) => ({ label, value: url }))
  ],
  wrapper: [
    { label: "Afterlife", value: "https://raw.githubusercontent.com/wannasmile4evr/mediabaseWS/refs/heads/main/wrappers/afterlife/splash.jpg" },
    { label: "Antidote", value: "https://raw.githubusercontent.com/wannasmile4evr/mediabaseWS/refs/heads/main/wrappers/antidote/splash.jpg" },
    { label: "Falling Cards", value: "https://raw.githubusercontent.com/wannasmile4evr/mediabaseWS/refs/heads/main/wrappers/falling-cards/splash.gif" }
  ],
  banner: [
    { label: "Mars", value: "https://raw.githubusercontent.com/wannasmile4evr/mediabaseWS/refs/heads/main/banners/a-distant-mars/splash.jpg" },
    { label: "Angel", value: "https://raw.githubusercontent.com/wannasmile4evr/mediabaseWS/refs/heads/main/banners/autumns-ghostface/splash.jpg" },
    { label: "Ghostface", value: "https://raw.githubusercontent.com/wannasmile4evr/mediabaseWS/refs/heads/main/banners/autumns-ghostface/splash.jpg" },
    { label: "Punk Future", value: "https://raw.githubusercontent.com/wannasmile4evr/mediabaseWS/refs/heads/main/banners/a-punk-future/splash.gif" }
  ]
};
const DEF = {layoutVersion:2,divStyle:"none",divFill:"color",divColor:"#ff4444",divSize:4,bw:1,bc1:"#383a40",bc2:"#383a40",ba:135,bh:210,r:12,bimg:"",roles:["Community Member","Creative"],bioText:"",
  ach:[],achDemo:false,qText:"your status here",qSize:16,qColor:"#ffffff",qx:20,qy:19,qPositioned:false,qPositionVersion:1,
  fx_t:"none",fx_n:60,nm:"",nf:"system-ui,sans-serif",ns:24,nc:"#f2f3f5",no:0,nb:true,ni:false,statusMode:"green",
  pimg:"",pimgRemoved:false,pframe:"",pframeScale:120,pframeX:0,pframeY:0,pwrapper:"",pwrapperMode:"image",pwrapperColor:"#383a40",pwrapperOpacity:100,pfpRadius:50,pfpSize:116,pfpAlign:"center",pfpBorderSize:4,pfpBorderMode:"default",pfpBorderColor:"#383a40",bimgMedia:"",bannerTint:"#ff4444",pixelate:0,
  npKind:"none",npId:"ember",npImg:"",npFit:"cover",npOpacity:100,npDim:30,npAnim:"none",npDur:8,
  cbType:"gradient",cbImg:"",cbAnim:"none",cbDur:6,cbSlice:30,cbRepeat:"stretch",actShow:true};
const FALLBACK_ACH = {
  wannatutorialize:{"metadata-title":"WannaTutorialize","image-url":"https://placehold.co/64x64/ff4444/ffffff.png?text=WT"},
  criticalReviewer:{"metadata-title":"Critical Reviewer","image-url":"https://placehold.co/64x64/ff8a00/111111.png?text=CR"},
  adventurist:{"metadata-title":"Adventurist","image-url":"https://placehold.co/64x64/8a80ff/111111.png?text=A"}
};
const $ = (id) => document.getElementById(id);
const DIVIDER_ASSETS = {
  drip: "https://raw.githubusercontent.com/securlydetected/assets/refs/heads/main/dividers/dripping-paint.png",
  xmaslights: "https://raw.githubusercontent.com/securlydetected/assets/refs/heads/main/dividers/xmaslights.png"
};
const bannerImageSizes = new Map();
const ls = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const matchMeta = (v) => v && typeof v === "object" ? (v["metadata-title"] || v.title || v.name || "") : "";
const matchImage = (v) => v && typeof v === "object" ? (v["image-url"] || v.image || v.src || "") : "";
const toAchievementList = (obj) => Object.entries(obj || {}).map(([id, meta]) => ({
  id, title: matchMeta(meta) || id, image: matchImage(meta) || ""
})).filter((item) => item.title && item.id);
const isAnimatedMedia = (src) => /(?:\.gif(?:[?#]|$)|data:image\/gif)/i.test(String(src || ""));
const escapeCssUrl = (src) => String(src || "").replace(/"/g, "%22");
function pixelateImageData(srcUrl, blocks = 32, outSize = 300) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!String(srcUrl).startsWith("data:")) img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const sourceWidth = img.naturalWidth || img.width;
        const sourceHeight = img.naturalHeight || img.height;
        const sourceMax = Math.max(sourceWidth, sourceHeight) || 1;
        const smallScale = Math.max(1, blocks) / sourceMax;
        const outputScale = outSize / sourceMax;
        const smallWidth = Math.max(1, Math.round(sourceWidth * smallScale));
        const smallHeight = Math.max(1, Math.round(sourceHeight * smallScale));
        const outputWidth = Math.max(1, Math.round(sourceWidth * outputScale));
        const outputHeight = Math.max(1, Math.round(sourceHeight * outputScale));
        const small = document.createElement("canvas");
        small.width = smallWidth; small.height = smallHeight;
        const sctx = small.getContext("2d");
        sctx.imageSmoothingEnabled = true;
        sctx.drawImage(img, 0, 0, smallWidth, smallHeight);
        const big = document.createElement("canvas");
        big.width = outputWidth; big.height = outputHeight;
        const bctx = big.getContext("2d");
        bctx.imageSmoothingEnabled = false;
        bctx.drawImage(small, 0, 0, smallWidth, smallHeight, 0, 0, outputWidth, outputHeight);
        resolve(big.toDataURL("image/png"));
      } catch (err) { reject(err); }
    };
    img.onerror = () => reject(new Error("image load failed"));
    img.src = srcUrl;
  });
}
let ACH = toAchievementList(FALLBACK_ACH);
let S, storedState = {};
function readEmbeddedProfileState() {
  const raw = ls(MAIN_PROFILE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const profile = { ...DEF };
        Object.keys(DEF).forEach((key) => {
          if (key in parsed && typeof parsed[key] === typeof DEF[key]) profile[key] = parsed[key];
        });
        return profile;
      }
      throw new Error("The saved profile data is invalid.");
    } catch (error) {
      console.error("Could not read the saved profile editor state.", error);
    }
  }
  const numberSetting = (key, fallback) => {
    const value = Number(ls(key));
    return Number.isFinite(value) && ls(key) !== null ? value : fallback;
  };
  const banner = ls("profileBanner") || "";
  const shape = ls("pfpShape") || "circle";
  return {
    ...DEF,
    nm: ls("nickname") || "",
    pimg: ls("profilePic") || "",
    bimg: banner,
    bimgMedia: banner,
    pixelate: ls("pfpPixelated") === "true" ? 32 : 0,
    pfpAlign: ["left", "center", "right"].includes(ls("pfpAlign")) ? ls("pfpAlign") : "center",
    pframe: ls("pfpFrame") || "",
    pframeScale: Math.round(numberSetting("pfpFrameScale", DEF.pframeScale / 100) * 100),
    pframeX: numberSetting("pfpFrameX", 0),
    pframeY: numberSetting("pfpFrameY", 0),
    pfpSize: numberSetting("pfpAvatarSize", DEF.pfpSize),
    pfpRadius: shape === "circle" ? 50 : shape === "rounded" ? 22 : 0,
    pwrapper: ls("pfpWrapper") || "",
    pwrapperOpacity: numberSetting("pfpWrapperOpacity", 100),
  };
}
if (EMBEDDED_PROFILE) {
  S = readEmbeddedProfileState();
  storedState = { ...S };
} else {
  try {
    const parsed = JSON.parse(ls(KEY) || "{}");
    storedState = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    S = { ...DEF, ...storedState };
  } catch (_) { S = { ...DEF }; }
}
const legacyLayout = storedState.layoutVersion !== 2 && Object.keys(storedState).length > 0;
const legacyMaskStyle = S.divStyle === "mask";
if (legacyMaskStyle) S.divStyle = "wave";
if (!["left", "center", "right"].includes(S.pfpAlign)) S.pfpAlign = DEF.pfpAlign;
if (!["green", "red", "yellow", "moon", "grey"].includes(S.statusMode)) S.statusMode = DEF.statusMode;
if (typeof S.bioText !== "string") S.bioText = DEF.bioText;
if (!Array.isArray(S.roles)) S.roles = [...DEF.roles];
S.roles = S.roles.filter((role) => typeof role === "string" && role.trim()).slice(0, 12);
const save = () => {
  if (EMBEDDED_PROFILE) return true;
  try { localStorage.setItem(KEY, JSON.stringify(S)); return true; }
  catch (_) { return false; }
};
function notifyProfile(message, variant = "primary") {
  if (!message) return;
  const icons = { primary: "info-circle", success: "check-circle", warning: "exclamation-triangle", danger: "exclamation-octagon" };
  const fallback = () => {
    const toast = document.createElement("div");
    toast.className = "profile-alert-fallback";
    toast.setAttribute("role", variant === "danger" ? "alert" : "status");
    toast.textContent = message;
    document.body.append(toast);
    window.setTimeout(() => toast.remove(), 5000);
  };
  const alert = document.createElement("sl-alert");
  alert.className = "profile-alert";
  alert.setAttribute("variant", variant);
  alert.setAttribute("closable", "");
  alert.setAttribute("duration", "5000");
  const icon = document.createElement("sl-icon");
  icon.slot = "icon";
  icon.name = icons[variant] || icons.primary;
  const text = document.createElement("span");
  text.textContent = message;
  alert.append(icon, text);
  document.body.append(alert);
  void Promise.race([
    customElements.whenDefined("sl-alert").then(() => true),
    new Promise((resolve) => window.setTimeout(() => resolve(false), 4000))
  ]).then(async (ready) => {
    if (!ready) {
      alert.remove();
      console.error("Shoelace alerts did not load; using the accessible profile notice fallback.");
      fallback();
      return;
    }
    await alert.toast();
  }).catch((error) => {
    alert.remove();
    console.error("Could not display the profile alert.", error);
    fallback();
  });
}
const needsBubbleMigration = storedState.qPositionVersion !== DEF.qPositionVersion;
if (needsBubbleMigration) {
  S.qPositioned = false;
  S.qx = DEF.qx;
  S.qy = DEF.qy;
  S.qPositionVersion = DEF.qPositionVersion;
}
if (legacyLayout) {
  if (S.divStyle === "line" && S.divColor === "#ff4444" && S.divSize === 4) S.divStyle = "none";
  if (S.bw === 4 && S.bc1 === "#ff4444" && S.bc2 === "#ff4444") {
    S.bw = 1; S.bc1 = "#383a40"; S.bc2 = "#383a40";
  }
  if (S.bh === 160) S.bh = 210;
  if (S.r === 18) S.r = 12;
  if (S.nf === "ui-monospace,Menlo,Consolas,monospace" && !S.nm) S.nf = "system-ui,sans-serif";
  S.layoutVersion = 2;
  save();
} else if (needsBubbleMigration || legacyMaskStyle) save();
const cloneProfileState = (state) => JSON.parse(JSON.stringify(state));
const initialProfileSnapshot = cloneProfileState(S);
let profileDraftBeforePreview = null;
let viewingSavedProfile = false;
function readMainProfile() {
  const raw = localStorage.getItem(MAIN_PROFILE_KEY);
  if (raw === null) return null;
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The saved profile data is invalid.");
  }
  const profile = { ...DEF };
  Object.keys(DEF).forEach((key) => {
    if (key in parsed && typeof parsed[key] === typeof DEF[key]) profile[key] = parsed[key];
  });
  if (!Array.isArray(profile.roles)) profile.roles = [...DEF.roles];
  if (!Array.isArray(profile.ach)) profile.ach = [];
  return profile;
}
function writeMainProfile(profile) {
  try {
    localStorage.setItem(MAIN_PROFILE_KEY, JSON.stringify(profile));
    return true;
  } catch (error) {
    console.error("Could not save the main profile.", error);
    return false;
  }
}
let earned = {};
try { earned = JSON.parse(ls("ws_achievements") || "{}") || {}; } catch (_) {}
const hasAch = (id) => S.achDemo || id in earned;

function syncBannerFields() {
  const bannerUrl = S.bimg || S.bimgMedia || "";
  if ($("bimg")) $("bimg").value = bannerUrl;
  if ($("bimgMedia")) $("bimgMedia").value = bannerUrl;
}

function populatePresets() {
  Object.entries(PRESET_MEDIA).forEach(([key, items]) => {
    const sel = $(key + "Preset");
    if (!sel) return;
    sel.innerHTML = '<option value="">Custom URL</option>' + items.map((item) => `<option value="${item.value}">${item.label}</option>`).join("");
    sel.value = "";
    sel.addEventListener("change", () => {
      if (!sel.value) return;
      const target = { avatar: "pimg", frame: "pframe", wrapper: "pwrapper", banner: "bimgMedia" }[key];
      if (!target) return;
      S[target] = sel.value;
      if (key === "banner") S.bimg = sel.value;
      save(); paint();
    });
  });
}

const SIMPLE = ["divStyle","divFill","divColor","divSize","bw","bc1","bc2","ba","bh","r","qText","qSize","qColor","fx_t","fx_n","nm","nf","ns","nc","no","pimg","pframe","pframeScale","pframeX","pframeY","pwrapper","pwrapperMode","pwrapperColor","pwrapperOpacity","pfpSize","pfpBorderSize","pfpBorderMode","pfpBorderColor","bimgMedia","bannerTint","pfpRadius","pixelate","statusMode","npImg","npFit","npOpacity","npDim","npAnim","npDur","cbType","cbImg","cbAnim","cbDur","cbSlice","cbRepeat"];
const DATA_FIELDS = ["pframe","npImg","cbImg"];   // may hold an imported data: image; never dumped into the URL box
const rangeUnits = { bh:"px", bw:"px", divSize:"px", fx_n:"", ns:"px", no:"px", pfpSize:"px", pfpRadius:"%", pfpBorderSize:"px", pframeScale:"%", pframeX:"px", pframeY:"px", pwrapperOpacity:"%", pixelate:"", qSize:"px", r:"px", npOpacity:"%", npDim:"%", npDur:"s", cbDur:"s", cbSlice:"px" };
function showRangeValue(input) {
  const output = input.nextElementSibling;
  const min = Number(input.min) || 0;
  const max = Number(input.max) || 100;
  const progress = max === min ? 0 : ((Number(input.value) - min) / (max - min)) * 100;
  input.style.setProperty("--range-progress", `${Math.min(100, Math.max(0, progress))}%`);
  if (output?.tagName !== "OUTPUT") return;
  const isPaintMaskSize = input.id === "divSize" && S.divStyle === "drip" && S.divFill === "mask";
  output.value = `${isPaintMaskSize ? Number(input.value) * 4 : input.value}${rangeUnits[input.id] ?? ""}`;
  output.textContent = output.value;
}
SIMPLE.forEach((k) => {
  const el = $(k); if (!el) return;
  if (DATA_FIELDS.includes(k) && String(S[k]).startsWith("data:image/")) {
    el.value = "";
    el.placeholder = "Imported image (stored locally)";
  } else {
    el.value = S[k] ?? "";
  }
  if (el.type === "range") {
    const output = document.createElement("output");
    output.setAttribute("aria-hidden", "true");
    el.insertAdjacentElement("afterend", output);
    showRangeValue(el);
  }
  el.addEventListener("input", () => {
    const val = el.type === "range" ? +el.value : el.value;
    if (k === "bimgMedia") {
      S.bimg = val;
      S.bimgMedia = val;
    } else if (k === "pfpRadius") {
      S.pfpRadius = val;
    } else {
      S[k] = val;
    }
    if (k === "npImg" && String(val).trim() && S.npKind === "none") S.npKind = "image";
    if (el.type === "range") showRangeValue(el);
    save(); paint();
  });
});
const profileBio = $("profileBio");
profileBio.textContent = S.bioText;
profileBio.addEventListener("beforeinput", (event) => {
  if (!event.inputType.startsWith("insert") || typeof event.data !== "string") return;
  const selection = window.getSelection();
  const selectedLength = selection && profileBio.contains(selection.anchorNode) ? selection.toString().length : 0;
  if ((profileBio.innerText || "").length - selectedLength + event.data.length > 500) event.preventDefault();
});
profileBio.addEventListener("input", () => {
  if (viewingSavedProfile) return;
  let value = (profileBio.innerText || "").replace(/\r\n?/g, "\n");
  if (value.length > 500) {
    value = value.slice(0, 500);
    profileBio.textContent = value;
  }
  S.bioText = value;
  if (!save()) notifyProfile("Could not save your bio. Check browser storage and try again.", "danger");
});
["nb","ni","achDemo","actShow"].forEach((k) => { const el = $(k); if (!el) return; el.checked = !!S[k]; el.addEventListener("change", () => { S[k] = el.checked; save(); paint(); }); });
function syncProfileEditorFields() {
  SIMPLE.forEach((key) => {
    const input = $(key);
    if (!input) return;
    input.value = DATA_FIELDS.includes(key) && String(S[key]).startsWith("data:image/") ? "" : (S[key] ?? "");
    if (input.type === "range") showRangeValue(input);
  });
  ["nb", "ni", "achDemo", "actShow"].forEach((key) => {
    if ($(key)) $(key).checked = !!S[key];
  });
  $("profileBio").textContent = S.bioText || "";
  renderAllPicks();
  paint();
  renderActivity();
}

function svgFor(style, c) {
  const p = { line: "M0 0H40V12H0Z", jagged: "M0 0H40L30 12L20 4L10 12Z", drip: "M0 0H40V3C38 3 38 12 35 12S32 3 28 3H20V5C19 5 19 10 17 10S15 5 13 3H0Z", wave: "M0 0H40V4Q30 12 20 4T0 4Z" }[style];
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 12' preserveAspectRatio='none'><path d='${p}' fill='${c}'/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
function getBannerCoverSize(src, width, height) {
  let image = bannerImageSizes.get(src);
  if (!image) {
    image = new Image();
    bannerImageSizes.set(src, image);
    image.onload = () => {
      if (String(S.bimg || S.bimgMedia || "").trim() === src) paint();
    };
    image.onerror = () => bannerImageSizes.delete(src);
    image.src = src;
  }
  if (!image.complete || !image.naturalWidth || !image.naturalHeight) return null;
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  return { width: image.naturalWidth * scale, height: image.naturalHeight * scale };
}
function hueForColor(color) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(color || ""));
  if (!match) return 0;
  const hex = match[1];
  const [r, g, b] = [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  if (!delta) return 0;
  const hue = max === r ? 60 * (((g - b) / delta) % 6)
    : max === g ? 60 * ((b - r) / delta + 2)
      : 60 * ((r - g) / delta + 4);
  return Math.round((hue + 360) % 360);
}
function renderRoles() {
  const list = $("profileRoleList");
  if (!list) return;
  list.replaceChildren();
  S.roles.forEach((role) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "profile-role";
    item.textContent = role;
    item.setAttribute("aria-label", `Remove ${role} role`);
    item.title = `Remove ${role}`;
    item.addEventListener("click", () => {
      const previousRoles = [...S.roles];
      S.roles = S.roles.filter((current) => current !== role);
      if (!save()) {
        S.roles = previousRoles;
        notifyProfile("Could not save this change. Check browser storage and try again.", "danger");
        return;
      }
      notifyProfile(`${role} role removed.`, "success");
      paint();
    });
    list.appendChild(item);
  });
  $("addRoleButton").disabled = S.roles.length >= 12;
  $("addRoleButton").title = S.roles.length >= 12 ? "Up to 12 roles can be previewed" : "Add a role";
}

function buildAchievementControls() {
  const area = $("achList"); if (!area) return;
  area.innerHTML = "";
  ACH.forEach((a) => {
    const wrap = document.createElement("label");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "achievement-choice" + (S.ach.includes(a.id) ? " selected" : "");
    btn.title = a.title;
    btn.setAttribute("aria-label", a.title);
    if (a.image) {
      const img = document.createElement("img");
      img.src = a.image;
      img.alt = a.title;
      btn.appendChild(img);
    }
    btn.addEventListener("click", () => {
      const current = S.ach.includes(a.id);
      S.ach = S.ach.filter((x) => x !== a.id);
      if (!current) {
        if (S.ach.length >= 5) return;
        S.ach.push(a.id);
      }
      save(); buildAchievementControls(); paint();
    });
    wrap.appendChild(btn); area.appendChild(wrap);
  });
}

async function loadAchievements() {
  try {
    const res = await fetch("./achievements.json", { cache: "no-store" });
    if (!res.ok) throw new Error("missing");
    const data = await res.json();
    const next = toAchievementList(data);
    if (next.length) ACH = next;
  } catch (_) {
    ACH = toAchievementList(FALLBACK_ACH);
  }
  buildAchievementControls();
  paint();
}

let cropper = null;
let cropTarget = null;
function openCrop(targetKey) {
  const cropModal = $("cropModal");
  const cropImg = $("cropImage");
  const src = targetKey === "banner" ? (S.bimg || S.bimgMedia || "") : (S.pimg || "");
  if (!src) return;
  cropTarget = targetKey;
  cropImg.src = src;
  cropModal.classList.add("visible");
  cropModal.setAttribute("aria-hidden", "false");
  if (cropper) cropper.destroy();
  cropper = new Cropper(cropImg, {
    aspectRatio: targetKey === "banner" ? 4 / 1 : 1,
    viewMode: 1,
    dragMode: "move",
    autoCropArea: 1,
    background: false,
    responsive: true,
    modal: true,
    guides: true,
    highlight: true
  });
}
function closeCrop() {
  const cropModal = $("cropModal");
  cropModal.classList.remove("visible");
  cropModal.setAttribute("aria-hidden", "true");
  if (cropper) { cropper.destroy(); cropper = null; }
  cropTarget = null;
}
$("cropCancel").addEventListener("click", closeCrop);
$("cropApply").addEventListener("click", () => {
  if (!cropper || !cropTarget) return;
  const canvas = cropper.getCroppedCanvas({ width: 600, height: cropTarget === "banner" ? 150 : 600, imageSmoothingEnabled: true });
  const dataUrl = canvas.toDataURL("image/png");
  if (cropTarget === "banner") { S.bimg = dataUrl; S.bimgMedia = dataUrl; }
  else { S.pimg = dataUrl; }
  save(); paint(); closeCrop();
});
$("cropAvatarBtn").addEventListener("click", () => openCrop("avatar"));
$("cropBannerBtn").addEventListener("click", () => openCrop("banner"));

function applyImageAsset(targetEl, rawUrl, forcePixelate = null) {
  const done = () => { if (targetEl.id === "avatar") paintTiles(); };
  if (!rawUrl) { targetEl.style.backgroundImage = ""; done(); return; }
  const url = String(rawUrl).trim();
  const shouldPixelate = forcePixelate ?? (Number(S.pixelate) > 0 && !isAnimatedMedia(url));
  if (shouldPixelate) {
    pixelateImageData(url, Number(S.pixelate) || 32).then((data) => {
      targetEl.style.backgroundImage = `url("${escapeCssUrl(data)}")`;
      done();
    }).catch(() => {
      targetEl.style.backgroundImage = `url("${escapeCssUrl(url)}")`;
      done();
    });
    return;
  }
  targetEl.style.backgroundImage = `url("${escapeCssUrl(url)}")`;
  done();
}

function getRenderedAvatarSize() {
  const compactProfile = S.pfpAlign === "left" || S.pfpAlign === "right";
  return compactProfile
    ? Math.min(Number(S.pfpSize), Math.max(84, (window.innerWidth - 72) * 0.4))
    : Number(S.pfpSize);
}
function paint() {
  const card = $("card"), st = card.style;
  st.setProperty("--bw", S.bw + "px"); st.setProperty("--bc1", S.bc1); st.setProperty("--bc2", S.bc2);
  st.setProperty("--ba", S.ba + "deg"); st.setProperty("--r", S.r + "px");
  const compactProfile = S.pfpAlign === "left" || S.pfpAlign === "right";
  const renderedAvatarSize = getRenderedAvatarSize();
  st.setProperty("--avatar-size", `${renderedAvatarSize}px`);
  $("profileEditor").dataset.profileAlign = S.pfpAlign;
  card.dataset.avatarAlign = S.pfpAlign;
  const avatar = $("avatar");
  $("body").dataset.avatarAlign = S.pfpAlign;
  document.querySelectorAll("#avatarAlignModes [data-avatar-align]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.avatarAlign === S.pfpAlign));
  });
  avatar.style.borderRadius = `${S.pfpRadius}%`;
  avatar.style.borderWidth = `${S.pfpBorderSize}px`;
  avatar.style.borderColor = S.pfpBorderMode === "custom" ? S.pfpBorderColor : "#383a40";
  $("pfpBorderColorControl").hidden = S.pfpBorderMode !== "custom";
  const status = $("avatarStatus");
  const statusNames = { green: "Green", red: "Red", yellow: "Yellow", moon: "Moon", grey: "Grey" };
  status.dataset.status = S.statusMode;
  status.setAttribute("aria-label", `${statusNames[S.statusMode]} status`);
  const statusAvatarSize = renderedAvatarSize;
  const statusAvatarBorder = Number(S.pfpBorderSize);
  const statusSize = 24;
  const statusOffset = Number(S.pfpRadius) >= 49
    ? statusAvatarSize / 2 - statusAvatarBorder - (statusAvatarSize - statusAvatarBorder * 2) / (2 * Math.SQRT2) - statusSize / 2
    : -statusSize / 2;
  status.style.right = `${statusOffset}px`;
  status.style.bottom = `${statusOffset}px`;
  const savedPic = S.pimgRemoved ? "" : ls("profilePic") || ls("profilePfp") || "";
  const requestedPic = (S.pimg || savedPic || PROFILE_PLACEHOLDER).trim();
  const pic = /^(https?:|data:image)/i.test(requestedPic) || requestedPic.startsWith(PROFILE_IMAGE_DIR)
    ? requestedPic
    : PROFILE_PLACEHOLDER;
  applyImageAsset(avatar, pic, Number(S.pixelate) > 0 && !isAnimatedMedia(pic));
  $("removeProfileImage").setAttribute("aria-pressed", String(!!S.pimgRemoved));
  const banner = $("banner");
  const bannerUrl = S.bimg || S.bimgMedia || "";
  const bannerHeight = Number(S.bh);
  banner.style.height = `${bannerHeight}px`;
  st.setProperty("--profile-banner-height", `${bannerHeight}px`);
  banner.style.backgroundImage = bannerUrl.trim()
    ? `url("${escapeCssUrl(bannerUrl.trim())}")`
    : `linear-gradient(120deg,color-mix(in srgb,${S.bannerTint || S.divColor} 34%,#8a8172),#4a4543 58%,#292b2e)`;
  banner.style.backgroundSize = bannerUrl.trim() ? "cover" : "";
  banner.style.backgroundPosition = bannerUrl.trim() ? "center" : "";
  banner.style.backgroundRepeat = bannerUrl.trim() ? "no-repeat" : "";
  const useBannerMask = S.divFill === "mask" && ["line", "jagged", "drip", "wave"].includes(S.divStyle);
  const tint = $("bannerTintLayer");
  tint.style.backgroundColor = S.bannerTint || S.divColor;
  tint.style.opacity = bannerUrl.trim() && !useBannerMask ? ".16" : "0";
  const d = $("divider");
  banner.style.borderBottom = "0";
  d.style.cssText = "left:0;right:0;bottom:0;height:0";
  if (S.divStyle === "line" && !useBannerMask) banner.style.borderBottom = `${S.divSize}px solid ${S.divColor}`;
  else if (!useBannerMask && ["drip", "xmaslights"].includes(S.divStyle)) {
    const imageHeight = Math.max(56, Number(S.divSize) * 4);
    const imageUrl = DIVIDER_ASSETS[S.divStyle];
    const recolor = S.divStyle === "drip" ? `filter:hue-rotate(${hueForColor(S.divColor)}deg);` : "";
    d.style.cssText = `left:0;right:0;bottom:-${imageHeight}px;height:${imageHeight}px;background:url("${imageUrl}") 0 0/auto 100% repeat-x;${recolor}z-index:2`;
  } else if (!useBannerMask && S.divStyle !== "none" && S.divStyle !== "blend") {
    const h = Math.max(6, S.divSize * 2);
    d.style.cssText = `left:0;right:0;bottom:${-h + 1}px;height:${h}px;background:${svgFor(S.divStyle, S.divColor)} 0 0/${h * 3.33}px 100% repeat-x;z-index:1`;
  }
  const wrapper = $("wrapper");
  const wrapperUrl = (S.pwrapper || "").trim();
  const wrapperUsesImage = S.pwrapperMode !== "color";
  wrapper.style.backgroundColor = wrapperUsesImage ? "transparent" : S.pwrapperColor;
  wrapper.style.backgroundImage = wrapperUsesImage && wrapperUrl ? `url("${escapeCssUrl(wrapperUrl)}")` : "";
  wrapper.style.backgroundSize = "100% 100%";
  wrapper.style.backgroundPosition = "center";
  wrapper.style.backgroundRepeat = "no-repeat";
  wrapper.style.opacity = String((Number(S.pwrapperOpacity) || 0) / 100);
  $("wrapperColorControl").hidden = wrapperUsesImage;
  $("wrapperImageControls").hidden = !wrapperUsesImage;
  $("divFillControl").hidden = !["line", "jagged", "drip", "wave"].includes(S.divStyle);
  $("divColorControl").hidden = !["line", "jagged", "drip", "wave"].includes(S.divStyle) || useBannerMask;
  const paintMask = S.divStyle === "drip" && useBannerMask;
  $("divSizeLabel").textContent = paintMask ? "Size" : "Thickness";
  showRangeValue($("divSize"));
  const bannerMask = $("bannerMaskExtension");
  if (useBannerMask) {
    const maskHeight = S.divStyle === "line" ? Math.max(1, Number(S.divSize)) : Math.max(6, Number(S.divSize) * 2);
    const bannerStyle = getComputedStyle(banner);
    const imageMask = S.divStyle === "drip";
    const paintMaskSize = Number(S.divSize) * 4;
    const coverSize = bannerUrl.trim()
      ? getBannerCoverSize(bannerUrl.trim(), banner.clientWidth, banner.offsetHeight)
      : null;
    const maskImage = imageMask ? `url("${DIVIDER_ASSETS.drip}")` : svgFor(S.divStyle, "#fff");
    bannerMask.style.display = "block";
    bannerMask.style.height = `${imageMask ? paintMaskSize : banner.offsetHeight}px`;
    bannerMask.style.backgroundColor = "#383a40";
    bannerMask.style.backgroundImage = bannerStyle.backgroundImage;
    bannerMask.style.backgroundSize = coverSize
      ? `${coverSize.width}px ${coverSize.height}px`
      : bannerStyle.backgroundSize;
    bannerMask.style.backgroundPosition = coverSize
      ? `${(banner.clientWidth - coverSize.width) / 2}px ${((banner.offsetHeight - coverSize.height) / 2) - banner.offsetHeight}px`
      : `50% calc(50% - ${(banner.offsetHeight + (imageMask ? paintMaskSize : banner.offsetHeight)) / 2}px)`;
    bannerMask.style.backgroundRepeat = bannerStyle.backgroundRepeat;
    bannerMask.style.maskImage = maskImage;
    bannerMask.style.maskSize = imageMask ? `${paintMaskSize * 3}px ${paintMaskSize}px` : `${maskHeight * 3.33}px ${maskHeight}px`;
    bannerMask.style.maskPosition = "left top";
    bannerMask.style.maskRepeat = "repeat-x";
    bannerMask.style.webkitMaskImage = maskImage;
    bannerMask.style.webkitMaskSize = imageMask ? `${paintMaskSize * 3}px ${paintMaskSize}px` : `${maskHeight * 3.33}px ${maskHeight}px`;
    bannerMask.style.webkitMaskPosition = "left top";
    bannerMask.style.webkitMaskRepeat = "repeat-x";
  } else {
    bannerMask.style.display = "none";
    bannerMask.style.backgroundColor = "transparent";
    bannerMask.style.backgroundImage = "none";
    bannerMask.style.backgroundSize = "";
    bannerMask.style.backgroundPosition = "";
    bannerMask.style.maskImage = "none";
    bannerMask.style.webkitMaskImage = "none";
  }
  const blendMark = $("blendMark");
  if (S.divStyle === "blend") {
    const markHeight = Math.max(12, Number(S.divSize) * 2);
    const seamY = banner.offsetTop + banner.offsetHeight - markHeight / 2;
    const textureUrl = wrapperUsesImage ? wrapperUrl : "";
    blendMark.style.display = textureUrl ? "block" : "none";
    blendMark.style.height = `${markHeight}px`;
    blendMark.style.bottom = `${-markHeight / 2}px`;
    blendMark.style.backgroundImage = textureUrl ? `url("${escapeCssUrl(textureUrl)}")` : "none";
    blendMark.style.backgroundSize = `${card.clientWidth}px ${wrapper.clientHeight}px`;
    blendMark.style.backgroundPosition = `0px -${seamY}px`;
  } else {
    blendMark.style.display = "none";
    blendMark.style.backgroundImage = "none";
  }
  const frame = $("avatarFrame");
  const frameUrl = (S.pframe || "").trim();
  if (frameUrl) {
    frame.style.backgroundImage = `url("${escapeCssUrl(frameUrl)}")`;
    frame.classList.add("visible");
    const frameSize = renderedAvatarSize * Math.max(0.8, Number(S.pframeScale || 120) / 100);
    frame.style.width = `${frameSize}px`;
    frame.style.height = `${frameSize}px`;
    frame.style.transform = `translate(-50%,-50%) translate(${Number(S.pframeX) || 0}px,${Number(S.pframeY) || 0}px)`;
  } else {
    frame.style.backgroundImage = "";
    frame.classList.remove("visible");
  }
  const n = $("name");
  n.textContent = S.nm || ls("nickname") || "Your Name";
  n.style.cssText = `font-family:${S.nf};font-size:${S.ns}px;color:${S.nc};font-weight:${S.nb ? 700 : 400};font-style:${S.ni ? "italic" : "normal"};-webkit-text-stroke:${S.no}px #000;paint-order:stroke fill`;
  const bodyRect = $("body").getBoundingClientRect();
  const actionsRect = $("profileActions").getBoundingClientRect();
  const bodyStyle = getComputedStyle($("body"));
  const avatarSize = renderedAvatarSize;
  const contentLeft = bodyRect.left + parseFloat(bodyStyle.paddingLeft);
  const contentRight = bodyRect.right - parseFloat(bodyStyle.paddingRight);
  const avatarLeft = S.pfpAlign === "left"
    ? contentLeft - actionsRect.left
    : S.pfpAlign === "right"
      ? contentRight - actionsRect.left - avatarSize
      : (contentLeft + contentRight) / 2 - actionsRect.left - avatarSize / 2;
  avatar.style.left = `${Math.max(0, Math.min(actionsRect.width - avatarSize, avatarLeft))}px`;
  const verticalOffset = !compactProfile && matchMedia("(min-width: 1181px)").matches
    ? Math.max(0, avatarSize - 116) / 2
    : 0;
  card.style.transform = verticalOffset ? `translateY(${verticalOffset}px)` : "";
  card.style.marginBottom = `${verticalOffset}px`;
  const q = $("quote");
  q.textContent = S.qText; q.style.display = S.qText ? "" : "none";
  q.style.fontSize = S.qSize + "px";
  q.style.color = S.qColor;
  if (S.qPositioned) {
    q.style.left = S.qx + "%";
    q.style.top = S.qy + "%";
  } else {
    const cardRect = card.getBoundingClientRect();
    const avatarRect = avatar.getBoundingClientRect();
    const left = Math.min(cardRect.width - q.offsetWidth - 8, Math.max(8, avatarRect.right - cardRect.left - 10));
    const top = Math.max(8, avatarRect.top - cardRect.top - q.offsetHeight - 8);
    q.style.left = `${left}px`;
    q.style.top = `${top}px`;
  }
  $("badges").innerHTML = "";
  S.ach.filter(hasAch).slice(0, 5).forEach((id) => {
    const a = ACH.find((x) => x.id === id); if (!a) return;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "badge";
    b.title = a.title;
    b.setAttribute("aria-label", a.title);
    const img = document.createElement("img");
    img.src = a.image;
    img.alt = a.title;
    b.appendChild(img);
    $("badges").appendChild(b);
  });
  renderRoles();
  syncBannerFields();
  paintBorder();
  paintNameplate();
  paintTiles();
  startFx();
}

function bindPixelButtons() {
  document.querySelectorAll("[data-pixel]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const value = Number(btn.dataset.pixel || 0);
      $("pixelate").value = value;
      S.pixelate = value;
      save(); paint();
    });
  });
}

function bindProfilePreview() {
  const moreButton = $("profileMoreButton");
  const menu = $("profileMoreMenu");
  const tabs = Array.from(document.querySelectorAll("#railTabs [role=tab]"));
  const editorAsides = Array.from(document.querySelectorAll("#editSidebar"));
  const controlDisabledStates = new Map();
  const setViewMode = (enabled) => {
    if (enabled) showPane("");
    viewingSavedProfile = enabled;
    $("profileEditor").dataset.profileMode = enabled ? "view" : "edit";
    editorAsides.forEach((aside) => {
      aside.querySelectorAll("input,select,textarea,button").forEach((control) => {
        if (!controlDisabledStates.has(control)) controlDisabledStates.set(control, control.disabled);
        control.disabled = enabled || controlDisabledStates.get(control);
      });
    });
    $("profileBio").contentEditable = enabled ? "false" : "plaintext-only";
    $("profileBio").setAttribute("aria-readonly", String(enabled));
    $("previewProfileButton").textContent = enabled ? "Edit Profile" : "Preview Profile";
    document.querySelectorAll("#avatarAlignModes [data-avatar-align]").forEach((button) => { button.disabled = enabled; });
    $("saveProfileButton").disabled = enabled;
    $("saveMainProfileButton").disabled = enabled;
  };
  const enterProfileView = (profile, message) => {
    if (!viewingSavedProfile) profileDraftBeforePreview = cloneProfileState(S);
    S = cloneProfileState(profile);
    setViewMode(true);
    syncProfileEditorFields();
    notifyProfile(message, "success");
  };
  const exitProfileView = (message) => {
    S = cloneProfileState(profileDraftBeforePreview || initialProfileSnapshot);
    profileDraftBeforePreview = null;
    setViewMode(false);
    syncProfileEditorFields();
    notifyProfile(message);
  };
  const saveToMainProfile = () => {
    if (viewingSavedProfile) return;
    const profile = cloneProfileState(S);
    if (EMBEDDED_PROFILE && typeof window.parent.WS_ProfileApply !== "function") {
      notifyProfile("The homepage profile connection is unavailable. Reload the page and try again.", "danger");
      return;
    }
    if (!writeMainProfile(profile)) {
      notifyProfile("Could not save the main profile. Check browser storage and try again.", "danger");
      return;
    }
    if (EMBEDDED_PROFILE) {
      let profileApplied = false;
      try {
        profileApplied = window.parent.WS_ProfileApply(profile) === true;
      } catch (error) {
        console.error("Could not apply the profile to the homepage.", error);
      }
      if (!profileApplied) {
        notifyProfile("Some profile settings could not be saved. Check browser storage and try again.", "danger");
        return;
      }
      window.parent.postMessage({ type: "ws-profile-modal-saved" }, HOST_ORIGIN);
      return;
    }
    const draftSaved = save();
    enterProfileView(profile, draftSaved
      ? "Profile saved locally and opened as a read-only preview."
      : "Profile saved locally, but the draft copy could not be updated.");
  };
  $("previewProfileButton").addEventListener("click", () => {
    if (viewingSavedProfile) {
      exitProfileView("Returned to profile editing.");
      return;
    }
    try {
      const savedProfile = readMainProfile();
      enterProfileView(savedProfile || S, savedProfile
        ? "Viewing the saved profile. Bio is read-only."
        : "No saved profile yet. Previewing this draft with a read-only bio.");
    } catch (error) {
      console.error("Could not read the saved main profile.", error);
      notifyProfile("Could not open the saved profile. Its saved data may be invalid.", "danger");
    }
  });
  $("saveDraftButton").addEventListener("click", () => {
    const draft = profileDraftBeforePreview || S;
    try {
      localStorage.setItem(KEY, JSON.stringify(draft));
      notifyProfile("Draft saved in this browser.", "success");
    } catch (error) {
      console.error("Could not save the profile draft.", error);
      notifyProfile("Could not save the draft. Check browser storage and try again.", "danger");
    }
  });
  $("saveProfileButton").addEventListener("click", saveToMainProfile);

  // ── Homepage modal stages ─────────────────────────────────────────────
  // The homepage hosts this page in its profile modal and owns the buttons
  // under the card. "view" shows only the read-only card; "edit" slides the
  // editor panel in beside it. Everything else here is plumbing for that.
  if (EMBEDDED_PROFILE) {
    const root = document.documentElement;
    const card = $("card");
    const shell = $("previewShell");
    const toHost = (type, extra) => {
      try { window.parent.postMessage({ type, ...(extra || {}) }, HOST_ORIGIN); } catch (_) {}
    };
    let stage = "";
    let lastHeight = 0, lastWidth = 0;
    const reportSize = () => {
      const editing = stage === "edit";
      const wanted = Math.ceil(shell.offsetHeight + 48);
      const height = editing ? window.innerHeight : wanted;
      const width = window.innerWidth;
      if (height === lastHeight && width === lastWidth) return;
      lastHeight = height;
      lastWidth = width;
      toHost("ws-profile-modal-size", { height, width, stage });
    };
    const applyStage = (next) => {
      next = next === "edit" ? "edit" : "view";
      if (next === stage) return;
      stage = next;
      root.dataset.pfStage = stage;
      setViewMode(stage === "view");
      lastHeight = 0;
      reportSize();
    };
    const initialStage = new URLSearchParams(location.search).get("stage") === "edit" ? "edit" : "view";
    root.dataset.pfStage = initialStage;
    if (typeof ResizeObserver === "function") {
      new ResizeObserver(reportSize).observe(shell);
      new ResizeObserver(reportSize).observe(document.documentElement);
    }
    window.addEventListener("resize", reportSize);
    window.addEventListener("message", (event) => {
      if (event.source !== window.parent) return;
      const data = event.data || {};
      if (data.type === "ws-profile-modal-stage") applyStage(data.stage);
      else if (data.type === "ws-profile-modal-action" && data.action === "save") saveToMainProfile();
    });
    window.addEventListener("load", () => {
      applyStage(initialStage);
      reportSize();
      toHost("ws-profile-modal-effects", { effect: S.fx_t, count: S.fx_n });
      toHost("ws-profile-modal-ready", { stage });
    });
  }
  $("saveMainProfileButton").addEventListener("click", saveToMainProfile);
  $("disregardProfileButton").addEventListener("click", () => {
    if (EMBEDDED_PROFILE) {
      window.parent.postMessage({ type: "ws-profile-modal-close" }, HOST_ORIGIN);
      return;
    }
    try {
      const savedProfile = readMainProfile();
      const restored = savedProfile || initialProfileSnapshot;
      if (viewingSavedProfile) profileDraftBeforePreview = null;
      S = cloneProfileState(restored);
      setViewMode(false);
      if (!save()) {
        notifyProfile("Changes were discarded, but the restored draft could not be saved.", "warning");
        syncProfileEditorFields();
        return;
      }
      syncProfileEditorFields();
      notifyProfile(savedProfile
        ? "Changes discarded. Restored the saved main profile."
        : "Changes discarded. Restored the profile as it was when this page opened.", "success");
    } catch (error) {
      console.error("Could not restore the saved profile.", error);
      notifyProfile("Could not restore the profile. Its saved data may be invalid.", "danger");
    }
  });
  document.querySelectorAll("#avatarAlignModes [data-avatar-align]").forEach((button) => {
    button.addEventListener("click", () => {
      if (viewingSavedProfile) return;
      S.pfpAlign = button.dataset.avatarAlign;
      if (!save()) {
        notifyProfile("Could not save the avatar position. Check browser storage and try again.", "danger");
        return;
      }
      paint();
    });
  });
  const closeMenu = (restoreFocus = false) => {
    if (menu.hidden) return;
    menu.hidden = true;
    moreButton.setAttribute("aria-expanded", "false");
    if (restoreFocus) moreButton.focus();
  };
  const announce = (message) => notifyProfile(message);
  const selectTab = (tab) => {
    tabs.forEach((item) => {
      const selected = item === tab;
      item.setAttribute("aria-selected", String(selected));
      item.tabIndex = selected ? 0 : -1;
      $(item.getAttribute("aria-controls")).hidden = !selected;
    });
    tab.focus();
  };

  moreButton.addEventListener("click", () => {
    const opening = menu.hidden;
    menu.hidden = !opening;
    moreButton.setAttribute("aria-expanded", String(opening));
    if (opening) menu.querySelector("[role=menuitem]")?.focus();
  });
  menu.addEventListener("click", async (event) => {
    const item = event.target.closest("[data-profile-action]");
    if (!item) return;
    const action = item.dataset.profileAction;
    closeMenu(true);
    if (action === "copy-link" || action === "copy-id" || action === "share") {
      const value = action === "copy-id" ? "2229" : location.href;
      const label = action === "copy-id" ? "User ID" : "Profile link";
      try {
        if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable in this browser.");
        await navigator.clipboard.writeText(value);
        announce(`${label} copied.`);
      } catch (error) {
        announce(error.message || `Couldn't copy the ${label.toLowerCase()}.`);
      }
      return;
    }
    const messages = {
      main: "Main profile navigation is preview-only.",
      ignore: "Ignore is preview-only.",
      block: "Block is preview-only.",
      report: "Reporting is preview-only."
    };
    announce(messages[action] || "This action is preview-only.");
  });
  menu.addEventListener("keydown", (event) => {
    const items = Array.from(menu.querySelectorAll("[role=menuitem]"));
    const index = items.indexOf(document.activeElement);
    let next = -1;
    if (event.key === "ArrowDown") next = (index + 1) % items.length;
    if (event.key === "ArrowUp") next = (index - 1 + items.length) % items.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = items.length - 1;
    if (next >= 0) { event.preventDefault(); items[next].focus(); }
    if (event.key === "Escape") { event.preventDefault(); closeMenu(true); }
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest("#profileMore")) closeMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (EMBEDDED_PROFILE) {
      event.preventDefault();
      window.parent.postMessage({ type: "ws-profile-modal-close" }, HOST_ORIGIN);
      return;
    }
    closeMenu(true);
  });
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectTab(tab));
    tab.addEventListener("keydown", (event) => {
      let next = -1;
      if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
      if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = tabs.length - 1;
      if (next >= 0) { event.preventDefault(); selectTab(tabs[next]); }
    });
  });
  $("messageUser").addEventListener("click", () => announce("Messaging is preview-only."));
  $("addFriend").addEventListener("click", () => announce("Adding a friend is preview-only."));
  const addRoleButton = $("addRoleButton");
  const roleComposer = $("roleComposer");
  const roleName = $("newRoleName");
  addRoleButton.addEventListener("click", () => {
    roleComposer.hidden = !roleComposer.hidden;
    addRoleButton.setAttribute("aria-expanded", String(!roleComposer.hidden));
    if (!roleComposer.hidden) roleName.focus();
  });
  $("cancelRole").addEventListener("click", () => {
    roleComposer.reset();
    roleComposer.hidden = true;
    addRoleButton.setAttribute("aria-expanded", "false");
    addRoleButton.focus();
  });
  roleComposer.addEventListener("submit", (event) => {
    event.preventDefault();
    const role = roleName.value.trim();
    if (!role) return;
    if (S.roles.length >= 12) {
      notifyProfile("The preview supports up to 12 roles.", "warning");
      return;
    }
    if (S.roles.some((current) => current.toLocaleLowerCase() === role.toLocaleLowerCase())) {
      notifyProfile("That role is already on this profile.", "warning");
      roleName.focus();
      return;
    }
    const previousRoles = [...S.roles];
    S.roles.push(role);
    if (!save()) {
      S.roles = previousRoles;
      notifyProfile("Could not save this role. Check browser storage and try again.", "danger");
      return;
    }
    roleComposer.reset();
    roleComposer.hidden = true;
    addRoleButton.setAttribute("aria-expanded", "false");
    notifyProfile(`${role} role added.`, "success");
    paint();
    addRoleButton.focus();
  });
}

// ── draggable quote ──
(() => {
  const q = $("quote"), card = $("card"); let drag = false;
  q.addEventListener("pointerdown", (e) => { drag = true; q.setPointerCapture(e.pointerId); });
  q.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const r = card.getBoundingClientRect();
    S.qPositioned = true;
    S.qx = Math.min(95, Math.max(5, ((e.clientX - r.left) / r.width) * 100));
    S.qy = Math.min(95, Math.max(5, ((e.clientY - r.top) / r.height) * 100));
    q.style.left = S.qx + "%"; q.style.top = S.qy + "%";
  });
  q.addEventListener("pointerup", () => { drag = false; save(); });
  $("qReset").onclick = () => { S.qx = DEF.qx; S.qy = DEF.qy; S.qPositioned = false; save(); paint(); };
})();

// ── particles ──
let fxRaf = 0, parts = [];
function startFx() {
  cancelAnimationFrame(fxRaf);
  const cv = $("fx"), ctx = cv.getContext("2d");
  if (EMBEDDED_PROFILE) {
    window.parent.postMessage({ type: "ws-profile-modal-effects", effect: S.fx_t, count: S.fx_n }, HOST_ORIGIN);
  }
  const w = cv.width = cv.clientWidth, h = cv.height = cv.clientHeight;
  ctx.clearRect(0, 0, w, h);
  if (S.fx_t === "none" || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const t = S.fx_t;
  parts = Array.from({ length: S.fx_n }, () => ({ x: Math.random() * w, y: Math.random() * h, s: 1 + Math.random() * 2.5, v: 0.4 + Math.random() * 1.2, p: Math.random() * 6 }));
  const tick = () => {
    ctx.clearRect(0, 0, w, h);
    parts.forEach((o) => {
      o.p += 0.03;
      if (t === "snow") { o.y += o.v; o.x += Math.sin(o.p) * 0.5; ctx.fillStyle = "rgba(255,255,255,.85)"; ctx.beginPath(); ctx.arc(o.x, o.y, o.s, 0, 7); ctx.fill(); }
      else if (t === "rain") { o.y += o.v * 6; ctx.strokeStyle = "rgba(150,190,255,.6)"; ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(o.x - 2, o.y + 9); ctx.stroke(); }
      else if (t === "embers") { o.y -= o.v; o.x += Math.sin(o.p); ctx.fillStyle = `rgba(255,${120 + o.s * 40 | 0},40,.85)`; ctx.fillRect(o.x, o.y, o.s, o.s); }
      else { ctx.fillStyle = `rgba(255,255,200,${0.4 + Math.sin(o.p * 2) * 0.4})`; ctx.fillRect(o.x, o.y, o.s, o.s); }
      if (o.y > h + 10) o.y = -10; if (o.y < -10) o.y = h + 10;
    });
    fxRaf = requestAnimationFrame(tick);
  };
  tick();
}
addEventListener("resize", paint);

// ── share code ──
const enc = () => btoa(unescape(encodeURIComponent(JSON.stringify(S))));
$("copy").onclick = async () => { $("code").value = enc(); try { await navigator.clipboard.writeText($("code").value); } catch (_) { $("code").select(); } };
$("load").onclick = () => {
  try {
    const o = JSON.parse(decodeURIComponent(escape(atob($("code").value.trim()))));
    S = { ...DEF }; for (const k of Object.keys(DEF)) if (k in o && typeof o[k] === typeof DEF[k]) S[k] = o[k];
    save(); location.reload();
  } catch (_) { alert("That share code isn't valid."); }
};
$("reset").onclick = () => { if (confirm("Reset every profile-testing setting?")) { try { localStorage.removeItem(KEY); } catch (_) {} location.reload(); } };

// -- library pickers: every item from /json (same catalogs as the store) --
const MB = "https://raw.githubusercontent.com/wannasmile4evr/mediabaseWS/refs/heads/main/";
const AVATARS = ["bleh","catcher","clown","clowninabox","dream","eye","eyes","glitched","me","purpleu","sleeppy","smile","starry","starwalk","yum"]
  .map((n) => ({ label: n, url: `https://cdn.jsdelivr.net/gh/mcmattyobriore/yogurtyooo.github.io@main/system/images/profile/${n}.${n === "smile" ? "png" : "jpeg"}` }))
  .concat(["skele.jpg","pumpkinPalLeft.gif","pumpkinPalRight.gif"].map((f) => ({ label: f.replace(/\.\w+$/, ""), url: `${MB}profile/halloween/${f}` })));
const PICK = {
  avatar:  { el: "pickAvatar",  key: "pimg",      input: "pimg",      none: "Saved",   items: AVATARS },
  frame:   { el: "pickFrame",   key: "pframe",    input: "pframe",    none: "None",    items: [], contain: true },
  wrapper: { el: "pickWrapper", key: "pwrapper",  input: "pwrapper",  none: "None",    items: [] },
  banner:  { el: "pickBanner",  key: "bimgMedia", input: "bimgMedia", none: "Default", items: [] }
};
const getJson = async (name) => {
  try { const r = await fetch(`../../json/${name}.json`, { cache: "no-cache" }); if (!r.ok) throw 0; return await r.json(); }
  catch (_) { return null; }
};
const FRIEND_NAME_STYLES = [
  { label: "Electric", color: "#b7f7ff", fontFamily: "system-ui,sans-serif", fontWeight: "800", letterSpacing: ".035em", textShadow: "0 0 9px rgba(49,214,255,.8)" },
  { label: "Rose", color: "#ffd1e7", fontFamily: "Georgia,serif", fontWeight: "700", fontStyle: "italic", textShadow: "1px 2px 0 #7b214b" },
  { label: "Sunburst", color: "#ffe39b", fontFamily: "Impact,Haettenschweiler,sans-serif", fontWeight: "700", letterSpacing: ".025em", textShadow: "1px 2px 0 #713b12" },
  { label: "Arcade", color: "#d8ffb0", fontFamily: "ui-monospace,Menlo,Consolas,monospace", fontWeight: "700", textShadow: "1px 1px 0 #283c21" },
  { label: "Lilac", color: "#e3d6ff", fontFamily: "system-ui,sans-serif", fontWeight: "800", fontStyle: "italic", textShadow: "0 1px 7px rgba(177,126,255,.8)" }
];
function shuffled(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
function shuffleFriendsPreview() {
  const rows = Array.from(document.querySelectorAll("[data-friend-preview]"));
  const backgrounds = PICK.banner.items.length
    ? PICK.banner.items
    : PRESET_MEDIA.banner.map((item) => ({ label: item.label, url: item.value }));
  const frames = PICK.frame.items.length
    ? PICK.frame.items
    : PRESET_MEDIA.frame.map((item) => ({ label: item.label, url: item.value }));
  const avatars = shuffled(AVATARS);
  const nameStyles = shuffled(FRIEND_NAME_STYLES);
  rows.forEach((row, index) => {
    const background = backgrounds[Math.floor(Math.random() * backgrounds.length)];
    const frame = frames[Math.floor(Math.random() * frames.length)];
    const avatar = avatars[index % avatars.length];
    const nameStyle = nameStyles[index % nameStyles.length];
    if (!background || !frame || !avatar || !nameStyle) return;
    row.querySelector(".friend-plate").style.backgroundImage = `url("${escapeCssUrl(background.url)}")`;
    row.querySelector(".profile-friend-frame").style.backgroundImage = `url("${escapeCssUrl(frame.url)}")`;
    row.querySelector(".profile-friend-avatar img").src = avatar.url;
    row.querySelector(".profile-friend-name").style.cssText = `color:${nameStyle.color};font-family:${nameStyle.fontFamily};font-weight:${nameStyle.fontWeight};font-style:${nameStyle.fontStyle || "normal"};letter-spacing:${nameStyle.letterSpacing || "normal"};text-shadow:${nameStyle.textShadow}`;
    row.title = `${background.label} nameplate · ${frame.label} avatar frame · ${avatar.label} profile image · ${nameStyle.label} name style`;
  });
}
document.querySelector("#shuffleFriendsPreview").addEventListener("click", shuffleFriendsPreview);
function renderPick(kind) {
  const cfg = PICK[kind], box = $(cfg.el); if (!box) return;
  const q = (document.querySelector(`.pfilter[data-for="${kind}"]`)?.value || "").trim().toLowerCase();
  const cur = (S[cfg.key] || "").trim();
  box.innerHTML = "";
  const none = document.createElement("button");
  none.type = "button"; none.className = "tile none" + (!cur && !(kind === "avatar" && S.pimgRemoved) ? " sel" : ""); none.textContent = cfg.none;
  none.onclick = () => choosePick(kind, { url: "" });
  box.append(none);
  cfg.items.filter((it) => !q || it.label.toLowerCase().includes(q)).forEach((it) => {
    const b = document.createElement("button");
    b.type = "button"; b.title = it.label;
    b.className = "tile" + (cfg.contain ? " contain" : "") + (it.url === cur ? " sel" : "");
    const img = document.createElement("img");
    img.loading = "lazy"; img.alt = it.label; img.src = it.thumb || it.url;
    const name = document.createElement("b"); name.textContent = it.label;
    b.append(img, name);
    b.onclick = () => choosePick(kind, it);
    box.append(b);
  });
}
const renderAllPicks = () => { Object.keys(PICK).forEach(renderPick); renderNpPick(); renderBorderPick(); };
function choosePick(kind, it) {
  const cfg = PICK[kind], url = it.url || "";
  S[cfg.key] = url;
  if (kind === "avatar") S.pimgRemoved = false;
  if (kind === "banner") S.bimg = url;
  if (kind === "frame" && it.scale) { S.pframeScale = it.scale; $("pframeScale").value = it.scale; showRangeValue($("pframeScale")); }
  $(cfg.input).value = url;
  if (kind === "frame") $("pframe").placeholder = "blank = none";
  save(); paint(); renderAllPicks();
}
$("removeProfileImage").addEventListener("click", () => {
  const previousImage = S.pimg;
  const previousRemoved = S.pimgRemoved;
  S.pimg = "";
  S.pimgRemoved = true;
  if (!save()) {
    S.pimg = previousImage;
    S.pimgRemoved = previousRemoved;
    notifyProfile("Could not remove the profile image. Check browser storage and try again.", "danger");
    return;
  }
  $("pimg").value = "";
  notifyProfile("Profile image removed. The placeholder is shown instead.", "success");
  paint();
  renderPick("avatar");
});
async function loadCatalogs() {
  const [fr, wr, bn, np] = await Promise.all(["frames", "wrappers", "banners", "nameplates"].map(getJson));
  if (Array.isArray(np)) NP_CATALOG = np.filter((r) => r.id).map((r) => ({ label: r.name || r.id, url: `${MB}nameplates/${r.id}/splash.${r.ext || "png"}` }));
  const ext = (r) => r.ext || "png";
  if (fr) PICK.frame.items = fr.filter((r) => r.id).map((r) => ({ label: r.name || r.id, url: `${MB}frames/${r.id}/splash.${ext(r)}`, scale: Math.round((+r.scale || 1.2) * 100) })).concat(LOCAL_FRAME_MEDIA);
  if (wr) PICK.wrapper.items = wr.filter((r) => r.id).map((r) => ({ label: r.name || r.id, url: `${MB}wrappers/${r.id}/splash.${ext(r)}` }));
  if (bn) PICK.banner.items = bn.filter((r) => r.src).map((r) => ({ label: r.name || r.identification, url: r.src, thumb: r.thumb || r.src }));
  if (!(fr && wr && bn)) {
    Object.entries({ frame: fr, wrapper: wr, banner: bn }).forEach(([k, v]) => { if (!v) PICK[k].items = PRESET_MEDIA[k].map((p) => ({ label: p.label, url: p.value })); });
    $("catNote").textContent = "Couldn't read ../../json - showing a short built-in list. Open this page from system/pages/profile-testing/ to get every library item.";
  }
  renderAllPicks();
  shuffleFriendsPreview();
}
document.querySelectorAll(".pfilter").forEach((el) => el.addEventListener("input", () => renderPick(el.dataset.for)));
["pimg","pframe","pwrapper","bimgMedia","npImg","cbImg"].forEach((id) => $(id)?.addEventListener("input", renderAllPicks));
populatePresets();
loadCatalogs();
bindPixelButtons();
bindProfilePreview();
loadAchievements();

// ═══════════════════════════════════════════════════════════════════════
// Edit areas: the sidebar shows preview tiles; a tile opens its own pane.
// ═══════════════════════════════════════════════════════════════════════
const PANE_TITLES = {
  nameplate: "Nameplate", avatar: "Avatar", frame: "Avatar frame", banner: "Banner & divider",
  border: "Card border", wrapper: "Card wrapper", effects: "Profile effect", bubble: "Status bubble",
  name: "Display name style", achievements: "Achievements", activity: "Activity", share: "Share or reset"
};
let openPaneId = "", paneOpener = null;
function showPane(id, opener) {
  openPaneId = PANE_TITLES[id] ? id : "";
  if (opener) paneOpener = opener;
  $("editHome").hidden = !!openPaneId;
  $("editPane").hidden = !openPaneId;
  document.querySelectorAll(".edit-pane").forEach((pane) => { pane.hidden = pane.id !== `pane-${openPaneId}`; });
  if (openPaneId) {
    $("paneTitle").textContent = PANE_TITLES[openPaneId];
    $("editPane").scrollTop = 0;
    $("paneBack").focus({ preventScroll: true });
    if (openPaneId === "activity") refreshActivityTools();
  } else if (paneOpener && paneOpener.isConnected && !paneOpener.disabled) {
    paneOpener.focus({ preventScroll: true });
  }
}
document.querySelectorAll("[data-open]").forEach((button) => button.addEventListener("click", () => showPane(button.dataset.open, button)));
$("paneBack").addEventListener("click", () => showPane(""));
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !openPaneId) return;
  if (!$("profileMoreMenu").hidden || $("cropModal").classList.contains("visible")) return;
  showPane("");
});

// Generic "import an image file" button (frame, nameplate, border all use it).
function bindImageImport({ button, file, status, key, input, onDone }) {
  $(button).addEventListener("click", () => $(file).click());
  $(file).addEventListener("change", () => {
    const picked = $(file).files?.[0];
    const note = $(status);
    if (!picked) return;
    if (!picked.type.startsWith("image/") && !/\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/i.test(picked.name)) {
      note.textContent = "Choose an image file.";
      $(file).value = "";
      return;
    }
    if (picked.size > 1.5 * 1024 * 1024) {
      note.textContent = "Image must be 1.5 MB or smaller.";
      $(file).value = "";
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => { note.textContent = "Could not read this image. Try another file."; $(file).value = ""; };
    reader.onload = () => {
      const previous = S[key];
      S[key] = String(reader.result || "");
      if (!save()) {
        S[key] = previous;
        note.textContent = "Could not save this image in browser storage.";
      } else {
        $(input).value = "";
        $(input).placeholder = `Imported: ${picked.name}`;
        note.textContent = "Image imported.";
        if (onDone) onDone();
        paint();
        renderAllPicks();
      }
      $(file).value = "";
    };
    reader.readAsDataURL(picked);
  });
}
bindImageImport({ button: "importFrameBtn", file: "frameFile", status: "frameImportStatus", key: "pframe", input: "pframe" });
bindImageImport({ button: "importNpBtn", file: "npFile", status: "npImportStatus", key: "npImg", input: "npImg", onDone: () => { S.npKind = "image"; save(); } });
bindImageImport({ button: "importBorderBtn", file: "borderFile", status: "borderImportStatus", key: "cbImg", input: "cbImg" });
$("centerProfileFrame").addEventListener("click", () => {
  S.pframeX = 0;
  S.pframeY = 0;
  $("pframeX").value = "0";
  $("pframeY").value = "0";
  showRangeValue($("pframeX"));
  showRangeValue($("pframeY"));
  if (!save()) {
    notifyProfile("Could not save the frame position. Check browser storage and try again.", "danger");
    return;
  }
  paint();
});

// ═══════════════════════════════════════════════════════════════════════
// Card border ("modal border"): gradient, image ring, image overlay, 9-slice
// ═══════════════════════════════════════════════════════════════════════
const svgUri = (svg) => `data:image/svg+xml,${encodeURIComponent(svg)}`;
const BORDER_PRESETS = [
  { id: "neon", name: "Neon frame", type: "overlay", img: svgUri("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='none'><rect x='1.5' y='1.5' width='97' height='97' rx='5' fill='none' stroke='#6ef2ff' stroke-width='3' vector-effect='non-scaling-stroke'/><rect x='3.6' y='3.6' width='92.8' height='92.8' rx='4' fill='none' stroke='#ff4fd8' stroke-width='1.5' vector-effect='non-scaling-stroke'/></svg>") },
  { id: "brackets", name: "Corner brackets", type: "overlay", img: svgUri("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='none'><path d='M2 14V2H14M86 2H98V14M98 86V98H86M14 98H2V86' fill='none' stroke='#ffd36e' stroke-width='3' stroke-linecap='square' vector-effect='non-scaling-stroke'/></svg>") },
  { id: "rope", name: "Studded rope", type: "slice", slice: 20, bw: 14, repeat: "round", img: svgUri("<svg xmlns='http://www.w3.org/2000/svg' width='60' height='60' viewBox='0 0 60 60'><g fill='none' stroke='#d9b36c' stroke-width='6' stroke-dasharray='6 4'><path d='M20 7H40'/><path d='M20 53H40'/><path d='M7 20V40'/><path d='M53 20V40'/></g><g fill='#8a5a1e' stroke='#f3d9a0' stroke-width='2'><circle cx='10' cy='10' r='8'/><circle cx='50' cy='10' r='8'/><circle cx='10' cy='50' r='8'/><circle cx='50' cy='50' r='8'/></g></svg>") },
  { id: "stripes", name: "Rainbow stripes", type: "ring", bw: 6, anim: "spin", img: svgUri("<svg xmlns='http://www.w3.org/2000/svg' width='128' height='128' viewBox='0 0 128 128'><defs><linearGradient id='g' x1='0' y1='0' x2='.28' y2='.28' spreadMethod='repeat'><stop offset='0' stop-color='#ff4d6d'/><stop offset='.2' stop-color='#ffb347'/><stop offset='.4' stop-color='#fff275'/><stop offset='.6' stop-color='#5be37d'/><stop offset='.8' stop-color='#4db8ff'/><stop offset='1' stop-color='#b36bff'/></linearGradient></defs><rect width='128' height='128' fill='url(#g)'/></svg>") }
];
const BORDER_ANIMS = ["none", "spin", "comet", "pulse", "rainbow", "shimmer", "breathe"];
const BORDER_NOTES = {
  gradient: "Two colours blended around the card. Spin and comet rotate them.",
  ring: "An image shown only inside the border width. Spin turns the image under the ring.",
  overlay: "A transparent-centre image stretched over the whole card. Best for ready-made frames.",
  slice: "Cuts an image into corners and edges so it scales cleanly. Square corners; the card’s rounding clips the outside."
};
function borderAnim(s = S) {
  const anim = BORDER_ANIMS.includes(s.cbAnim) ? s.cbAnim : "none";
  const rotates = s.cbType === "gradient" || s.cbType === "ring";
  return !rotates && (anim === "spin" || anim === "comet") ? "none" : anim;
}
// Draws the current border into any ring/overlay pair (the card, and the sidebar tile).
function renderBorder(ring, overlay, { w, r }) {
  const type = ["gradient", "ring", "overlay", "slice"].includes(S.cbType) ? S.cbType : "gradient";
  const img = (S.cbImg || "").trim();
  const anim = borderAnim();
  const spin = anim === "spin" || anim === "comet";
  const dur = `${Math.max(1, Number(S.cbDur) || 6)}s`;
  const showRing = (type === "gradient" || (type === "ring" && img)) && w > 0;
  ring.hidden = !showRing;
  if (showRing) {
    const a = S.bc1, b = S.bc2;
    let bg;
    if (type === "ring") bg = `url("${escapeCssUrl(img)}") center/cover no-repeat`;
    else if (anim === "spin") bg = `conic-gradient(from 0deg, ${a}, ${b}, ${a})`;
    else if (anim === "comet") bg = `conic-gradient(from 0deg, color-mix(in srgb, ${b} 22%, transparent) 0deg 215deg, ${b} 310deg, ${a} 360deg)`;
    else bg = `linear-gradient(${Number(S.ba)}deg, ${a}, ${b})`;
    ring.style.setProperty("--ring-bg", bg);
    ring.style.setProperty("--ring-w", `${w}px`);
    ring.style.setProperty("--ring-r", `${r}px`);
    ring.style.setProperty("--ring-dur", dur);
    ring.dataset.anim = anim;
    ring.dataset.spin = spin ? "1" : "0";
  }
  const showOverlay = !!img && (type === "overlay" || type === "slice");
  overlay.hidden = !showOverlay;
  if (showOverlay) {
    const url = `url("${escapeCssUrl(img)}")`;
    const base = `--ring-dur:${dur};`;
    overlay.style.cssText = type === "overlay"
      ? `${base}border-radius:${r}px;background:${url} 0 0/100% 100% no-repeat`
      : `${base}border-radius:0;border:${w}px solid transparent;border-image:${url} ${Math.max(1, Number(S.cbSlice) || 1)} / ${w}px / 0 ${S.cbRepeat || "stretch"}`;
    overlay.dataset.anim = anim;
  }
}
function paintBorder() {
  const card = $("card");
  const type = ["gradient", "ring", "overlay", "slice"].includes(S.cbType) ? S.cbType : "gradient";
  renderBorder($("cardRing"), $("cardOverlay"), { w: Number(S.bw) || 0, r: Number(S.r) || 0 });
  card.dataset.ringAnim = borderAnim();
  card.style.setProperty("--ring-dur", `${Math.max(1, Number(S.cbDur) || 6)}s`);
  // sidebar tile: always show something visible, even when the real width is 0
  renderBorder($("tileRing"), $("tileOverlay"), { w: Math.min(6, Math.max(3, Number(S.bw) || 0)), r: 9 });
  // controls
  const imageType = type !== "gradient";
  $("cbGradientControls").hidden = imageType;
  $("cbImageControls").hidden = !imageType;
  $("cbSliceControls").hidden = type !== "slice";
  $("cbWidthControl").hidden = type === "overlay";
  $("cbDirControl").hidden = !imageType && ["spin", "comet"].includes(S.cbAnim);
  $("cbTypeNote").textContent = BORDER_NOTES[type];
  document.querySelectorAll("#cbAnim option").forEach((option) => {
    option.disabled = (type === "overlay" || type === "slice") && (option.value === "spin" || option.value === "comet");
  });
  $("cbAnimNote").textContent = borderAnim() !== S.cbAnim && S.cbAnim !== "none"
    ? "Spin and comet need the gradient or image-ring type, so no motion is applied here."
    : (imageType && !(S.cbImg || "").trim() ? "Pick or import an image to see this border." : "");
}
function renderBorderPick() {
  const box = $("pickBorder"); if (!box) return;
  const cur = (S.cbImg || "").trim();
  box.replaceChildren();
  const none = document.createElement("button");
  none.type = "button"; none.className = "tile none" + (!cur ? " sel" : ""); none.textContent = "None";
  none.onclick = () => { S.cbImg = ""; $("cbImg").value = ""; $("cbImg").placeholder = "png / gif / webp / svg"; save(); paint(); renderBorderPick(); };
  box.append(none);
  BORDER_PRESETS.forEach((preset) => {
    const b = document.createElement("button");
    b.type = "button"; b.title = `${preset.name} (${preset.type})`;
    b.className = "tile contain" + (preset.img === cur ? " sel" : "");
    const im = document.createElement("img"); im.alt = preset.name; im.src = preset.img;
    const name = document.createElement("b"); name.textContent = preset.name;
    b.append(im, name);
    b.onclick = () => {
      S.cbType = preset.type; S.cbImg = preset.img;
      if (preset.slice) S.cbSlice = preset.slice;
      if (preset.repeat) S.cbRepeat = preset.repeat;
      if (preset.bw) S.bw = preset.bw;
      if (preset.anim) S.cbAnim = preset.anim;
      save(); syncProfileEditorFields();
    };
    box.append(b);
  });
}

// ═══════════════════════════════════════════════════════════════════════
// Nameplate: built-in styles, library images (json/nameplates.json), or your own
// ═══════════════════════════════════════════════════════════════════════
const NP_PRESETS = [
  { id: "ember", name: "Ember", bg: "linear-gradient(100deg,#5a1209,#d6401f 40%,#ffb347 65%,#5a1209)", size: "200% 100%" },
  { id: "aurora", name: "Aurora", bg: "linear-gradient(100deg,#0f2027,#2c7a7b 28%,#6b5bd6 55%,#d65bb0 80%,#0f2027)", size: "200% 100%" },
  { id: "candy", name: "Candy", bg: "linear-gradient(100deg,#ff6ec7,#ffd36e 50%,#6ee7ff)", size: "" },
  { id: "ocean", name: "Deep ocean", bg: "repeating-linear-gradient(115deg,#082a4d 0 14px,#0b3d6e 14px 28px)", size: "" },
  { id: "scan", name: "Scanlines", bg: "repeating-linear-gradient(0deg,rgba(255,255,255,.07) 0 1px,transparent 1px 3px),linear-gradient(100deg,#101820,#2b3a4a)", size: "" },
  { id: "halftone", name: "Halftone", bg: "radial-gradient(circle,rgba(255,255,255,.24) 1.5px,transparent 2px) 0 0/10px 10px,linear-gradient(100deg,#3a1c71,#d76d77)", size: "" }
];
let NP_CATALOG = [];
function npSource(s) {
  if (s.npKind === "none") return null;
  const img = (s.npImg || "").trim();
  if (img) {
    const fit = s.npFit;
    return { bg: `url("${escapeCssUrl(img)}")`, size: fit === "stretch" ? "100% 100%" : fit === "tile" ? "auto 100%" : "cover", repeat: fit === "tile" ? "repeat-x" : "no-repeat", image: true };
  }
  const preset = NP_PRESETS.find((p) => p.id === s.npId) || NP_PRESETS[0];
  return { bg: preset.bg, size: preset.size, repeat: "", image: false };
}
function applyNameplate(plate, s) {
  const src = npSource(s);
  const layer = plate.querySelector(".np-layer");
  if (!src) {
    layer.style.background = "none";
    plate.dataset.anim = "none";
    plate.style.setProperty("--np-dim", "0");
    return false;
  }
  layer.style.background = src.bg;
  layer.style.backgroundSize = src.size || "";
  layer.style.backgroundRepeat = src.repeat || "";
  if (src.image) layer.style.backgroundPosition = "center";
  plate.style.setProperty("--np-opacity", String((Number(s.npOpacity) || 0) / 100));
  plate.style.setProperty("--np-dim", String((Number(s.npDim) || 0) / 100));
  plate.style.setProperty("--np-dur", `${Math.max(1, Number(s.npDur) || 8)}s`);
  plate.dataset.anim = ["sheen", "drift", "pulse", "hue"].includes(s.npAnim) ? s.npAnim : "none";
  return true;
}
function paintNameplate() {
  const on = applyNameplate($("nameplate"), S);
  document.querySelector(".profile-identity").dataset.np = on ? "on" : "off";
  const miniOn = applyNameplate($("tileNpPlate"), S);
  $("tileNp").dataset.empty = String(!miniOn);
}
function renderNpPick() {
  const box = $("pickNameplate"); if (!box) return;
  const none = S.npKind === "none";
  const img = (S.npImg || "").trim();
  box.replaceChildren();
  const tile = (label, selected, build, onPick) => {
    const b = document.createElement("button");
    b.type = "button"; b.title = label; b.className = "tile" + (selected ? " sel" : "");
    build(b);
    const name = document.createElement("b"); name.textContent = label;
    b.append(name);
    b.onclick = onPick;
    box.append(b);
  };
  tile("None", none, (b) => { b.classList.add("none"); }, () => { S.npKind = "none"; save(); paint(); renderNpPick(); });
  NP_PRESETS.forEach((preset) => tile(preset.name, !none && !img && (S.npId || "ember") === preset.id, (b) => {
    const sw = document.createElement("span"); sw.className = "swatch";
    sw.style.background = preset.bg; if (preset.size) sw.style.backgroundSize = preset.size;
    b.append(sw);
  }, () => { S.npKind = "preset"; S.npId = preset.id; S.npImg = ""; $("npImg").value = ""; $("npImg").placeholder = "blank = use the style above"; save(); paint(); renderNpPick(); }));
  NP_CATALOG.forEach((item) => tile(item.label, !none && img === item.url, (b) => {
    const im = document.createElement("img"); im.loading = "lazy"; im.alt = item.label; im.src = item.url;
    b.append(im);
  }, () => { S.npKind = "image"; S.npImg = item.url; $("npImg").value = item.url; save(); paint(); renderNpPick(); }));
}

// ═══════════════════════════════════════════════════════════════════════
// Sidebar tile previews (kept in sync with the card on every paint)
// ═══════════════════════════════════════════════════════════════════════
function paintTiles() {
  const avatar = $("avatar");
  const pic = avatar.style.backgroundImage || "none";
  $("tileAvatar").style.backgroundImage = pic;
  $("tileAvatar").style.borderRadius = `${S.pfpRadius}%`;
  $("tileNpAvatar").style.backgroundImage = pic;
  const frameUrl = (S.pframe || "").trim();
  const nameplateFrame = $("tileNpFrame");
  nameplateFrame.style.backgroundImage = frameUrl ? `url("${escapeCssUrl(frameUrl)}")` : "none";
  nameplateFrame.classList.toggle("visible", !!frameUrl);
  const nameplateFrameScale = Math.max(0.8, Number(S.pframeScale || 120) / 100);
  const nameplateOffsetScale = 34 / Math.max(1, getRenderedAvatarSize() || 116);
  nameplateFrame.style.width = `${34 * nameplateFrameScale}px`;
  nameplateFrame.style.height = `${34 * nameplateFrameScale}px`;
  nameplateFrame.style.transform = `translate(-50%,-50%) translate(${(Number(S.pframeX) || 0) * nameplateOffsetScale}px,${(Number(S.pframeY) || 0) * nameplateOffsetScale}px)`;
  $("tileFrame").style.backgroundImage = frameUrl ? `url("${escapeCssUrl(frameUrl)}")` : "none";
  $("tilePlus").hidden = !!frameUrl;
  const banner = $("banner"), tb = $("tileBanner");
  tb.style.backgroundImage = banner.style.backgroundImage || "none";
  tb.style.backgroundSize = banner.style.backgroundSize || "cover";
  const wrapper = $("wrapper"), tw = $("tileWrapper");
  tw.style.backgroundColor = wrapper.style.backgroundColor || "";
  tw.style.backgroundImage = wrapper.style.backgroundImage || "none";
  tw.style.opacity = String(Math.max(0.35, Number(S.pwrapperOpacity) / 100 || 0));
  $("tileWrapperPlus").hidden = (S.pwrapperMode === "color") || (!!wrapper.style.backgroundImage && wrapper.style.backgroundImage !== "none");
  $("tileFx").textContent = ({ none: "No effect", snow: "Snow", rain: "Rain", embers: "Embers", stars: "Stars" })[S.fx_t] || "No effect";
  $("tileBubble").textContent = S.qText || "No bubble";
  const displayName = S.nm || ls("nickname") || "Your Name";
  const nameCss = `font-family:${S.nf};color:${S.nc};font-weight:${S.nb ? 700 : 400};font-style:${S.ni ? "italic" : "normal"};-webkit-text-stroke:${Math.min(2, S.no)}px #000;paint-order:stroke fill`;
  $("tileName").textContent = displayName;
  $("tileName").style.cssText = nameCss;
  $("tileNpName").textContent = displayName;
  $("tileNpName").style.cssText = nameCss;
  const badges = $("tileAch");
  badges.replaceChildren();
  const shown = S.ach.filter(hasAch).slice(0, 5).map((id) => ACH.find((a) => a.id === id)).filter(Boolean);
  if (!shown.length) badges.textContent = "No badges selected";
  shown.forEach((a) => {
    const b = document.createElement("span"); b.className = "badge"; b.title = a.title;
    const img = document.createElement("img"); img.src = a.image; img.alt = a.title;
    b.append(img); badges.append(b);
  });
  const count = readRecent().length;
  $("tileAct").textContent = !S.actShow ? "Hidden on profile" : count ? `${count} of ${RECENT_MAX} recent links` : "No recent links yet";
}

// ═══════════════════════════════════════════════════════════════════════
// Activity: the 6 most recent link opens, matched against the SQL library
// ═══════════════════════════════════════════════════════════════════════
const RECENT_KEY = "ws_recent_opens", RECENT_MAX = 6;
const LIB = { state: "idle", items: [], exact: new Map(), loose: new Map(), updated: "", source: "", error: "", promise: null };

// Normalised key: ignores protocol, "www.", fragment and trailing slashes.
// noQuery = also ignore ?query (used only against library links that have none).
function linkKey(raw, noQuery = false) {
  try {
    const u = new URL(String(raw).trim(), location.href);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "");
    return `${host}${u.port ? ":" + u.port : ""}${path}${noQuery ? "" : u.search}`;
  } catch (_) { return String(raw).trim().toLowerCase(); }
}
const linkHasQuery = (raw) => { try { return !!new URL(String(raw).trim(), location.href).search; } catch (_) { return false; } };

function readRecent() {
  try {
    const list = JSON.parse(ls(RECENT_KEY) || "[]");
    return Array.isArray(list) ? list.filter((e) => e && typeof e.url === "string" && Number.isFinite(e.t)).slice(0, RECENT_MAX) : [];
  } catch (_) { return []; }
}
function writeRecent(list) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX))); return true; }
  catch (_) { return false; }
}
// Newest first, de-duplicated by link, capped at 6.
function recordOpen(url) {
  const clean = String(url || "").trim();
  if (!/^https?:\/\//i.test(clean) || clean.length > 2000) return false;
  const key = linkKey(clean);
  const list = readRecent().filter((entry) => linkKey(entry.url) !== key);
  list.unshift({ url: clean, t: Date.now() });
  if (!writeRecent(list)) return false;
  renderActivity();
  ensureLibrary();
  return true;
}
window.WS_recordOpen = recordOpen;
// Anything this page opens in a new tab counts as an open, like the site-wide hook would.
(() => {
  const nativeOpen = window.open.bind(window);
  window.open = function (url, ...rest) {
    if (typeof url === "string") recordOpen(url);
    return nativeOpen(url, ...rest);
  };
})();
addEventListener("storage", (event) => { if (event.key === RECENT_KEY) renderActivity(); });

function libDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error("no indexedDB"));
    const req = indexedDB.open("ws_library", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("snap");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function libReadSaved(url) {
  try {
    const db = await libDb();
    return await new Promise((resolve) => {
      const get = db.transaction("snap").objectStore("snap").get(url);
      get.onsuccess = () => { db.close(); resolve(get.result || null); };
      get.onerror = () => { db.close(); resolve(null); };
    });
  } catch (_) { return null; }
}
function setLibrary(items, source, updated) {
  LIB.items = items.filter((it) => it && typeof it.link === "string" && it.link.trim());
  LIB.exact = new Map(); LIB.loose = new Map();
  LIB.items.forEach((it) => {
    const exact = linkKey(it.link);
    if (!LIB.exact.has(exact)) LIB.exact.set(exact, it);
    if (!linkHasQuery(it.link)) { const loose = linkKey(it.link, true); if (!LIB.loose.has(loose)) LIB.loose.set(loose, it); }
  });
  LIB.source = source; LIB.updated = updated || ""; LIB.state = "ready"; LIB.error = "";
}
// Same feed and saved copy the main site uses. Read-only: this page never writes the site's cache.
function loadLibrary(force = false) {
  const url = window.WS_ENDPOINTS?.library;
  if (!url) { LIB.state = "error"; LIB.error = "No library endpoint is configured."; renderActivity(); refreshActivityTools(); return Promise.resolve(); }
  LIB.state = "loading";
  renderActivity(); refreshActivityTools();
  LIB.promise = (async () => {
    const saved = force ? null : await libReadSaved(url);
    if (saved && Array.isArray(saved.items) && saved.items.length) { setLibrary(saved.items, "saved copy", saved.updated); renderActivity(); refreshActivityTools(); }
    try {
      const res = await fetch(url, { cache: force ? "reload" : "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      if (!Array.isArray(body?.items)) throw new Error("the feed has no items array");
      setLibrary(body.items, "live feed", body.updated);
    } catch (err) {
      if (LIB.state !== "ready") { LIB.state = "error"; LIB.error = err.message || String(err); }
    }
    renderActivity(); refreshActivityTools();
  })();
  return LIB.promise;
}
function ensureLibrary() { if (LIB.state === "idle" || LIB.state === "error") return loadLibrary(); return LIB.promise; }
function matchLink(url) {
  const exact = LIB.exact.get(linkKey(url));
  if (exact) return { item: exact, how: "exact" };
  const loose = LIB.loose.get(linkKey(url, true));
  return loose ? { item: loose, how: "same page, extra query/fragment" } : null;
}
function timeAgo(t) {
  const s = Math.max(0, (Date.now() - t) / 1000);
  const m = Math.floor(s / 60), h = Math.floor(s / 3600), d = Math.floor(s / 86400), w = Math.floor(d / 7);
  if (s < 45) return "just now";
  if (m < 60) return `${Math.max(1, m)}m ago`;
  if (h < 24) return `${h}h ago`;
  if (d < 7) return `${d}d ago`;
  if (w < 5) return `${w}w ago`;
  if (d < 365) return `${Math.floor(d / 30)}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}
function prettyLink(url) {
  try { const u = new URL(url); const path = u.pathname.replace(/\/+$/, ""); return { host: u.hostname.replace(/^www\./, ""), path }; }
  catch (_) { return { host: url, path: "" }; }
}
function iconUrl(raw) {
  const v = typeof window.toMediabase === "function" ? window.toMediabase(String(raw || "").trim()) : String(raw || "").trim();
  return /^https?:\/\//i.test(v) ? v : "";
}
let openActMenu = null;
function closeActMenu() { if (openActMenu) { openActMenu.remove(); openActMenu = null; } }
function activityCard(entry, match, index) {
  const item = match?.item;
  const card = document.createElement("article");
  card.className = "act-item";
  card.style.animationDelay = `${index * 40}ms`;
  const link = prettyLink(entry.url);
  const title = item?.title?.trim() || link.host;
  const icon = document.createElement("div");
  icon.className = "act-icon";
  const fallback = () => { icon.replaceChildren(); icon.textContent = (title[0] || "?").toUpperCase(); };
  const src = item ? iconUrl(item.image) : "";
  if (src) {
    const img = document.createElement("img");
    img.alt = ""; img.loading = "lazy"; img.referrerPolicy = "no-referrer"; img.src = src;
    img.addEventListener("error", fallback);
    icon.append(img);
  } else fallback();
  const body = document.createElement("div");
  body.className = "act-body";
  const t = document.createElement("div"); t.className = "act-title"; t.textContent = title; t.title = title;
  const by = document.createElement("div"); by.className = "act-by";
  by.textContent = item ? (item.author?.trim() ? `by ${item.author.trim()}` : "Library item") : `${link.host}${link.path.length > 1 ? link.path : ""}`;
  const meta = document.createElement("div"); meta.className = "act-meta";
  const chip = (text, cls = "") => { const c = document.createElement("span"); c.className = `act-chip ${cls}`.trim(); c.textContent = text; meta.append(c); };
  if (item) {
    if (item.category?.trim()) chip(item.category.trim());
    if (item.sub_category?.trim()) chip(item.sub_category.trim());
    if (Number(item.rating_count) > 0) chip(`★ ${Number(item.rating_avg).toFixed(1)} (${item.rating_count})`);
    card.title = [`Matched in the SQL library (${match.how})`, item.status ? `status: ${item.status}` : "", Array.isArray(item.flags) && item.flags.length ? `flags: ${item.flags.join(", ")}` : "", item.description ? item.description : ""].filter(Boolean).join("\n");
  } else {
    chip(LIB.state === "loading" || LIB.state === "idle" ? "Matching…" : "Link", "link");
    card.title = LIB.state === "ready" ? "Not found in the SQL library" : "Library not checked yet";
  }
  const time = document.createElement("span"); time.textContent = timeAgo(entry.t); time.dataset.t = String(entry.t); time.className = "act-time";
  meta.append(time);
  body.append(t, by, meta);
  const more = document.createElement("button");
  more.type = "button"; more.className = "act-more"; more.textContent = "⋯"; more.setAttribute("aria-label", `More options for ${title}`); more.setAttribute("aria-haspopup", "menu");
  more.addEventListener("click", (event) => {
    event.stopPropagation();
    const had = openActMenu && openActMenu.parentNode === card;
    closeActMenu();
    if (had) return;
    const menu = document.createElement("div"); menu.className = "act-menu"; menu.setAttribute("role", "menu");
    const mk = (label, cls, fn) => { const b = document.createElement("button"); b.type = "button"; b.setAttribute("role", "menuitem"); b.textContent = label; if (cls) b.className = cls; b.addEventListener("click", (e) => { e.stopPropagation(); closeActMenu(); fn(); }); menu.append(b); };
    mk("Open again", "", () => window.open(entry.url, "_blank", "noopener"));
    mk("Remove", "danger", () => { writeRecent(readRecent().filter((e) => linkKey(e.url) !== linkKey(entry.url))); renderActivity(); });
    card.append(menu); openActMenu = menu;
    menu.querySelector("button").focus();
  });
  card.append(icon, body, more);
  return card;
}
function renderActivity() {
  const box = $("activityList"); if (!box) return;
  closeActMenu();
  box.replaceChildren();
  const list = readRecent();
  const status = $("libStatus");
  status.textContent = !S.actShow ? "" : LIB.state === "loading" ? "Checking the SQL library…"
    : LIB.state === "ready" ? `Matched against ${LIB.items.length.toLocaleString()} library items (${LIB.source}).`
    : LIB.state === "error" ? "The SQL library couldn't be reached, so plain links are shown." : "";
  if (!S.actShow) {
    const empty = document.createElement("p"); empty.className = "profile-empty"; empty.textContent = "Activity is hidden on this profile.";
    box.append(empty);
  } else if (!list.length) {
    const empty = document.createElement("p"); empty.className = "profile-empty";
    empty.textContent = "Nothing yet. Open a game or link on the site and it will show up here.";
    box.append(empty);
  } else list.forEach((entry, i) => box.append(activityCard(entry, LIB.state === "ready" ? matchLink(entry.url) : null, i)));
  paintTilesSafe();
}
function paintTilesSafe() { if ($("tileAct")) { const count = readRecent().length; $("tileAct").textContent = !S.actShow ? "Hidden on profile" : count ? `${count} of ${RECENT_MAX} recent links` : "No recent links yet"; } }
document.addEventListener("click", (event) => { if (!event.target.closest(".act-menu, .act-more")) closeActMenu(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeActMenu(); });
setInterval(() => document.querySelectorAll(".act-time").forEach((el) => { el.textContent = timeAgo(Number(el.dataset.t)); }), 60000);

function refreshActivityTools() {
  const info = $("libInfo"); if (!info) return;
  info.textContent = LIB.state === "ready" ? `${LIB.items.length.toLocaleString()} items from the ${LIB.source}${LIB.updated ? `, updated ${LIB.updated}` : ""}.`
    : LIB.state === "loading" ? "Loading the SQL library…"
    : LIB.state === "error" ? `Could not load the library: ${LIB.error}` : "The library loads the first time a link is recorded.";
  const pick = $("actPick");
  if (LIB.state === "ready" && pick.dataset.filled !== String(LIB.items.length)) {
    const items = LIB.items.filter((it) => /^https?:\/\//i.test(it.link.trim())).sort((a, b) => String(a.title).localeCompare(String(b.title))).slice(0, 300);
    pick.replaceChildren(new Option("Choose a library item…", ""));
    items.forEach((it) => pick.append(new Option(`${it.title || it.link}${it.author ? " — " + it.author : ""}`, it.link)));
    pick.dataset.filled = String(LIB.items.length);
  }
}
$("actRecord").addEventListener("click", () => {
  const value = $("actUrl").value.trim();
  if (!recordOpen(value)) { notifyProfile("Enter a full http(s) link to record.", "warning"); return; }
  $("actUrl").value = "";
  notifyProfile("Open recorded.", "success");
});
$("actRecordPick").addEventListener("click", () => {
  if (!$("actPick").value) { notifyProfile("Choose a library item first.", "warning"); return; }
  recordOpen($("actPick").value);
});
$("actClear").addEventListener("click", () => { writeRecent([]); renderActivity(); notifyProfile("Recent opens cleared.", "success"); });
$("libReload").addEventListener("click", () => { $("actPick").dataset.filled = ""; loadLibrary(true); });
$("actShow").addEventListener("change", renderActivity);

// ── init for the pieces above ──
(() => {
  let since = ls("ws_profile_test_since");
  if (!since) { since = new Date().toISOString(); try { localStorage.setItem("ws_profile_test_since", since); } catch (_) {} }
  const date = new Date(since);
  $("memberSince").textContent = Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
})();
renderActivity();
if (readRecent().length) ensureLibrary();

})();
