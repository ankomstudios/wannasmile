"use strict";

// Account/session compatibility state; the historical filename is retained
// because site pages already load this script.
(() => {
  const API_URL = window.WS_ENDPOINTS?.chat || "";
  const ID_KEY = "ws_ticket_id";
  const SECRET_KEY = "ws_ticket_key";
  const STATUS_KEY = "ws_ticket_status";
  const USER_KEY = "ws_username";
  const EMAIL_KEY = "ws_email";

  const read = (key) => { try { return localStorage.getItem(key) || ""; } catch (_) { return ""; } };
  const write = (key, value) => {
    try {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } catch (error) {
      console.error("[account] couldn't save account state:", error);
      throw new Error("This browser couldn't save your sign-in. Check available storage and try again.");
    }
  };
  const id = () => read(ID_KEY);
  const secret = () => read(SECRET_KEY);
  const status = () => read(STATUS_KEY);
  const username = () => read(USER_KEY);
  const approved = () => !!id() && !!secret() && status() === "approved";

  let resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });

  function changed() {
    document.dispatchEvent(new CustomEvent("ws:ticket-change", { detail: { id: id(), status: status() } }));
  }

  function setState(account) {
    write(ID_KEY, account.id);
    write(SECRET_KEY, account.key);
    write(STATUS_KEY, "approved");
    write(USER_KEY, account.username);
    write(EMAIL_KEY, account.email || "");
    resolveReady();
    changed();
  }

  async function request(path, data) {
    if (!API_URL) throw new Error("The account service is unavailable.");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    const options = data === undefined ? { cache: "no-store" } : {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      cache: "no-store",
    };
    options.signal = controller.signal;
    try {
      const response = await fetch(`${API_URL}${path}`, options);
      let result;
      try { result = await response.json(); }
      catch { throw new Error("The account service returned an invalid response."); }
      if (!response.ok && response.status >= 500) throw new Error(result?.error || "The account service is unavailable.");
      return result;
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("The account service took too long to answer.");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function register({ name, email, pass }) {
    const result = await request("/auth/register", { username: name, email, password: pass });
    if (result?.ok) setState(result);
    return result;
  }

  async function login({ name, pass }) {
    const result = await request("/auth/login", { username: name, password: pass });
    if (result?.ok) setState(result);
    return result;
  }

  async function authenticate(accountId, key) {
    if (!accountId || !key) return null;
    const query = new URLSearchParams({ ticket: accountId, key });
    const result = await request(`/auth/session?${query}`);
    return result?.ok ? result : null;
  }

  async function check() {
    if (!id() || !secret()) return "unknown";
    const result = await authenticate(id(), secret());
    if (!result) return "unknown";
    write(USER_KEY, result.username);
    write(EMAIL_KEY, result.email || "");
    write(STATUS_KEY, "approved");
    return "approved";
  }

  async function verify(accountId, key) {
    return await authenticate(String(accountId || "").trim(), String(key || "").trim()) ? "approved" : "unknown";
  }

  function revoke() {
    clearAuthState();
    document.dispatchEvent(new CustomEvent("ws:ticket-gate"));
    return ready;
  }

  function clearAuthState() {
    write(ID_KEY, "");
    write(SECRET_KEY, "");
    write(STATUS_KEY, "");
    write(USER_KEY, "");
    write(EMAIL_KEY, "");
    changed();
  }

  async function logout() {
    const accountId = id();
    const key = secret();
    let remoteError = null;
    if (accountId && key) {
      try {
        const result = await request("/auth/logout", { ticket: accountId, key });
        if (result?.ok !== true) throw new Error(result?.error || "The account service could not end this session.");
      } catch (error) {
        remoteError = error;
      }
    }
    clearAuthState();
    if (remoteError) {
      console.error("[account] couldn't revoke the server session:", remoteError);
      throw new Error("You are signed out on this device, but the server could not revoke the session.");
    }
    return ready;
  }

  function withTicket(url) {
    return url;
  }

  const dashCopy = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!id()) return;
    navigator.clipboard?.writeText(id()).then(() => {
      if (typeof showToast === "function") showToast("Account ID copied");
    }).catch(() => {});
  };

  function paintDashboard() {
    const logout = document.getElementById("logoutAccount");
    if (logout) {
      logout.hidden = !approved();
      logout.setAttribute("aria-hidden", String(!approved()));
    }
    const element = document.getElementById("dashTicketId");
    if (!element) return;
    const accountId = id();
    element.hidden = !accountId;
    element.setAttribute("aria-hidden", String(!accountId));
    element.tabIndex = accountId ? 0 : -1;
    element.textContent = accountId;
    element.classList.toggle("is-empty", !accountId);
    element.title = accountId ? "Your WannaSmile account ID (click to copy)" : "";
  }

  document.addEventListener("ws:ticket-change", paintDashboard);
  document.addEventListener("DOMContentLoaded", () => {
    paintDashboard();
    const element = document.getElementById("dashTicketId");
    element?.addEventListener("click", dashCopy);
    element?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); element.click(); }
    });
    const logoutControl = document.getElementById("logoutAccount");
    if (logoutControl && logoutControl.dataset.logoutHandler !== "chat") {
      logoutControl.addEventListener("click", async (event) => {
        event.preventDefault();
        const menu = document.getElementById("dashboardMenu");
        if (menu?.style.display === "block") document.getElementById("dashboardBtn")?.click();
        try {
          await logout();
          if (typeof showToast === "function") showToast("You have been logged out.");
        } catch (error) {
          console.error("[account] couldn't log out:", error);
          if (typeof showToast === "function") showToast(error.message || "Could not log out.");
        }
      });
    }
  });

  window.WS_Ticket = {
    ready,
    id,
    status,
    approved,
    username,
    withTicket,
    register,
    login,
    check,
    verify,
    revoke,
    logout,
  };

  if (!id() || !secret()) {
    resolveReady();
  } else {
    check().then((result) => {
      if (result !== "approved") revoke();
      else { resolveReady(); changed(); }
    }).catch((error) => {
      console.error("[account] couldn't verify the saved sign-in:", error);
      resolveReady();
    });
  }
})();
