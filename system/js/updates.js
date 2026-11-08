"use strict";

// Project updates notice. It opens by itself whenever the
// site has a new update, meaning the latest commit on the live repo's main
// branch is not the one this visitor last dismissed or read (ws_updates_seen
// holds that commit's full sha, see data.js). So every new commit brings it
// back, and one visitor dismissing it never hides the next update.
//   - "Don't show again" / "View all updates" mark the current commit
//     as seen ("View all updates" also opens the news page).
//   - The backdrop and Escape close it for this viewing only.
//   - The commit comes from window.WS_LatestCommit (ui.js, shared with the
//     footer label). If GitHub can't be reached (offline, rate limit) the
//     modal only opens for a visitor who has never seen one, so a flaky
//     connection doesn't nag people on every page.
// Update the list in the modal (index.html) and the news page with each
// release; the modal itself needs nothing else.
(() => {
  const SEEN_KEY = "ws_updates_seen";

  const overlay = document.getElementById("updatesOverlay");
  const panel   = document.getElementById("updatesPanel");
  if (!overlay || !panel) return;

  // Site root from this script's own URL, so the news-page link resolves
  // the same whether this runs from the root page or a nested one.
  const root     = new URL("../../", document.querySelector("script[src*='js/updates.js']")?.src || location.href);
  const newsHref = new URL("system/pages/news/index.html", root).href;

  const seen = () => { try { return localStorage.getItem(SEEN_KEY) || ""; } catch (_) { return ""; } };
  let currentId = "";   // sha of the commit being announced ("" = unknown)
  const markSeen = () => { try { localStorage.setItem(SEEN_KEY, currentId || "offline"); } catch (_) {} };

  function close() {
    overlay.classList.remove("visible");
    setTimeout(() => { overlay.hidden = true; }, 200);
  }

  function open() {
    overlay.hidden = false;
    requestAnimationFrame(() => {
      overlay.classList.add("visible");
      panel.focus({ preventScroll: true });
    });
  }

  document.getElementById("updatesBackdrop")?.addEventListener("click", close);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("visible")) close();
  });

  document.getElementById("updatesDismiss")?.addEventListener("click", () => {
    markSeen();
    close();
  });

  document.getElementById("updatesReadMore")?.addEventListener("click", () => {
    markSeen();
    window.location.href = newsHref;
  });

  // The menu entry always opens it, whether or not the commit is known yet.
  document.getElementById("openUpdates")?.addEventListener("click", (e) => {
    e.preventDefault();
    open();
  });

  // The automatic pop-up never shows over the ticket / onboarding screens.
  // It waits for an approved ticket AND for the tutorial to be over (finished
  // or skipped: ws:tutorial-done; or, for someone who only had the ticket
  // screen back, until that screen closes). The menu entry above is not
  // affected: it opens whenever it's clicked.
  const ready = () =>
    !!window.WS_Ticket?.approved?.() &&
    !window.WS_Tutorial?.pending?.() &&
    !window.WS_Tutorial?.active?.();

  let waiting = false;
  function openWhenReady() {
    if (waiting) return;
    waiting = true;
    let timer = null;
    const tryOpen = () => {
      if (!ready()) return;
      waiting = false;
      clearInterval(timer);
      document.removeEventListener("ws:tutorial-done", tryOpen);
      document.removeEventListener("ws:ticket-change", tryOpen);
      // A beat after the onboarding card has gone, so the two never overlap.
      setTimeout(() => { if (ready()) open(); else { waiting = false; openWhenReady(); } }, 600);
    };
    document.addEventListener("ws:tutorial-done", tryOpen);
    document.addEventListener("ws:ticket-change", tryOpen);
    timer = setInterval(tryOpen, 500);   // also catches the ticket screen closing
    tryOpen();
  }

  const lookup = typeof window.WS_LatestCommit === "function" ? window.WS_LatestCommit() : Promise.resolve(null);
  lookup.then((c) => {
    currentId = c && c.sha ? c.sha : "";
    const last = seen();
    if (currentId ? last !== currentId : !last) openWhenReady();
  });
})();