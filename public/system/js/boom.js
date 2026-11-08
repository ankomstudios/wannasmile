const WS_BOOM_AUDIO_ICON_BASE = new URL("https://raw.githubusercontent.com/securlydetected/assets/refs/heads/main/audio-btn/");

(function () {
  const muted = localStorage.getItem("ws_muted") === "true";
  document.addEventListener("DOMContentLoaded", function () {
    const img = document.getElementById("muteToggleImg");
    if (img) img.src = new URL(muted ? "SHUT.gif" : "BOOM.gif", WS_BOOM_AUDIO_ICON_BASE).href;
    if (window.WS_Audio) window.WS_Audio.setMuted(muted);
  });
})();

document.addEventListener("DOMContentLoaded", () => {
  const btn = document.querySelector(".mute-btn");
  if (!btn) return;

  btn.removeAttribute("onclick");
  btn.addEventListener("click", () => {
    const img   = btn.querySelector("img");
    const muted = localStorage.getItem("ws_muted") === "true";
    const next  = !muted;
    localStorage.setItem("ws_muted", next);
    img.src = new URL(next ? "SHUT.gif" : "BOOM.gif", WS_BOOM_AUDIO_ICON_BASE).href;
    if (window.WS_Audio) window.WS_Audio.setMuted(next);
  });
});
