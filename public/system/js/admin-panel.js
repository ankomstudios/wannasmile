"use strict";

(() => {
  const API = window.WS_ENDPOINTS?.chat || "";
  const menuButton = document.getElementById("openAdminBots");
  const dialog = document.getElementById("adminBotDialog");
  const closeButton = document.getElementById("closeAdminBots");
  const select = document.getElementById("adminBotSelect");
  const profileInput = document.getElementById("adminBotProfile");
  const sqlOutput = document.getElementById("adminBotSql");
  const status = document.getElementById("adminBotStatus");
  const copyButton = document.getElementById("copyBotSql");
  const saveButton = document.getElementById("saveBotProfile");
  const bots = new Map();
  let isAdmin = false;
  let checkSequence = 0;

  if (!menuButton || !dialog || !window.WS_Ticket) return;

  const credentials = () => ({
    ticket: window.WS_Ticket.id(),
    key: (() => { try { return localStorage.getItem("ws_ticket_key") || ""; } catch (_) { return ""; } })(),
  });

  function showStatus(message, error = false) {
    status.textContent = message;
    status.dataset.error = String(error);
  }

  function setAdmin(enabled) {
    isAdmin = enabled;
    menuButton.hidden = !enabled;
    const shield = document.getElementById("dashAdminShield");
    if (shield) shield.hidden = !enabled;
    if (!enabled && dialog.open) dialog.close();
  }

  async function checkAdmin() {
    const sequence = ++checkSequence;
    const { ticket, key } = credentials();
    if (!ticket || !key || window.WS_Ticket.status() !== "approved") {
      setAdmin(false);
      return;
    }
    try {
      const response = await fetch(`${API}/auth/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket, key }),
        cache: "no-store",
      });
      const result = await response.json();
      if (sequence !== checkSequence) return;
      if (response.status === 401 || response.status === 403) {
        setAdmin(false);
        return;
      }
      if (!response.ok || result?.ok !== true) throw new Error(result?.error || `HTTP ${response.status}`);
      setAdmin(result.isAdmin === true);
    } catch (error) {
      if (sequence === checkSequence) setAdmin(false);
      console.error("[admin] Could not verify account role.", error);
    }
  }

  async function api(path, method = "POST", data = null) {
    if (!isAdmin) throw new Error("Admin access is required.");
    const auth = credentials();
    if (!auth.ticket || !auth.key) throw new Error("Sign in with an administrator account first.");
    let url = `${API}${path}`;
    const options = { method, cache: "no-store" };
    if (method === "GET") {
      const query = new URLSearchParams(auth);
      url += `?${query}`;
    } else {
      options.headers = { "Content-Type": "application/json" };
      options.body = JSON.stringify({ ...auth, ...data });
    }
    const response = await fetch(url, options);
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error("The account service returned an invalid response.");
    }
    if (!response.ok || result?.ok !== true) throw new Error(result?.error || `HTTP ${response.status}`);
    return result;
  }

  function loadSelectedBot() {
    const bot = bots.get(select.value);
    profileInput.value = bot ? JSON.stringify(bot.profile, null, 2) : "{}";
    sqlOutput.value = "";
    copyButton.disabled = true;
    saveButton.disabled = !bot;
  }

  async function loadBots() {
    if (!isAdmin) throw new Error("Admin access is required.");
    const result = await api("/admin/bots");
    bots.clear();
    select.replaceChildren();
    for (const bot of result.bots) {
      bots.set(bot.username, bot);
      const option = document.createElement("option");
      option.value = bot.username;
      option.textContent = bot.displayName ? `${bot.displayName} (@${bot.username})` : `@${bot.username}`;
      select.append(option);
    }
    select.disabled = result.bots.length === 0;
    if (!result.bots.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No managed bot accounts";
      select.append(option);
    }
    loadSelectedBot();
    showStatus(result.bots.length ? `${result.bots.length} managed bot profile${result.bots.length === 1 ? "" : "s"} loaded.` :
      "No bots are registered for editing. Add a bot account ID to managed_bots in D1.");
  }

  menuButton.addEventListener("click", async () => {
    if (!isAdmin) return;
    dialog.showModal();
    showStatus("Loading managed bot profiles…");
    try {
      await loadBots();
    } catch (error) {
      showStatus(error.message || "Could not load bot profiles.", true);
      console.error("[admin] Could not load managed bots.", error);
    }
  });
  closeButton.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  select.addEventListener("change", loadSelectedBot);
  document.getElementById("reloadAdminBots").addEventListener("click", async () => {
    showStatus("Reloading managed bot profiles…");
    try {
      await loadBots();
    } catch (error) {
      showStatus(error.message || "Could not reload bot profiles.", true);
      console.error("[admin] Could not reload managed bots.", error);
    }
  });
  saveButton.addEventListener("click", async () => {
    const username = select.value;
    if (!username || !bots.has(username)) {
      showStatus("There are no managed bots to edit.", true);
      return;
    }
    const bot = bots.get(username);
    try {
      const profile = JSON.parse(profileInput.value);
      if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
        throw new Error("Profile JSON must be an object.");
      }
      saveButton.disabled = true;
      showStatus(`Saving @${username}'s profile…`);
      const result = await api("/admin/bot-profile", "POST", { username, profile });
      bot.profile = result.profile;
      if (select.value === username) {
        profileInput.value = JSON.stringify(result.profile, null, 2);
        sqlOutput.value = "";
        copyButton.disabled = true;
      }
      showStatus(`Profile saved for @${result.username}.`);
    } catch (error) {
      showStatus(error.message || "Could not save the bot profile.", true);
    } finally {
      saveButton.disabled = !bots.has(select.value);
    }
  });
  document.getElementById("generateBotSql").addEventListener("click", async () => {
    const username = select.value;
    if (!username) {
      showStatus("There are no managed bots to edit.", true);
      return;
    }
    try {
      const profile = JSON.parse(profileInput.value);
      if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
        throw new Error("Profile JSON must be an object.");
      }
      showStatus("Validating profile and generating SQL…");
      const result = await api("/admin/bot-profile-sql", "POST", { username, profile });
      sqlOutput.value = result.sql;
      copyButton.disabled = false;
      showStatus(`SQL generated for @${result.username}. Review it, then run it in the Cloudflare D1 console.`);
    } catch (error) {
      showStatus(error.message || "Could not generate the D1 statement.", true);
    }
  });
  copyButton.addEventListener("click", async () => {
    if (!sqlOutput.value) return;
    try {
      await navigator.clipboard.writeText(sqlOutput.value);
      showStatus("D1 SQL copied. Review and run it in Cloudflare.");
    } catch (error) {
      showStatus("Could not copy SQL. Select and copy the generated statement manually.", true);
      console.error("[admin] Could not copy generated SQL.", error);
    }
  });

  window.WS_Ticket.ready.then(checkAdmin).catch((error) => {
    console.error("[admin] Could not verify account role.", error);
  });
  document.addEventListener("ws:ticket-change", checkAdmin);
})();
