const TOKEN_KEY = "scoresense_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function notifyAuthChanged() {
  window.dispatchEvent(new CustomEvent("scoresense-auth-changed"));
}

export function authHeaders() {
  const token = getToken();
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function apiFetch(url, options = {}) {
  const { signal, headers, ...rest } = options;
  const init = {
    ...rest,
    credentials: "include",
    headers: { ...authHeaders(), ...(headers || {}) },
  };
  if (signal instanceof AbortSignal) {
    init.signal = signal;
  }
  const res = await fetch(url, init);
  return res;
}

export async function fetchAuthConfig() {
  const res = await fetch("/api/auth/config");
  if (!res.ok) return { auth_required: false, patreon_configured: false };
  return res.json();
}

async function parseAuthError(res, fallback) {
  let detail = await res.text();
  try {
    detail = JSON.parse(detail).detail || detail;
  } catch {
    /* plain text */
  }
  throw new Error(detail || fallback);
}

export async function loginAccount({ email, password }) {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) await parseAuthError(res, "Login failed");
  return res.json();
}

export async function registerAccount({ email, password, displayName, acceptTerms }) {
  const res = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      email,
      password,
      display_name: displayName || undefined,
      accept_terms: Boolean(acceptTerms),
    }),
  });
  if (!res.ok) await parseAuthError(res, "Registration failed");
  return res.json();
}

export async function forgotPassword({ email }) {
  const res = await fetch("/api/auth/forgot-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email }),
  });
  if (!res.ok) await parseAuthError(res, "Could not send reset email");
  return res.json();
}

export async function resetPassword({ token, password }) {
  const res = await fetch("/api/auth/reset-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ token, password }),
  });
  if (!res.ok) await parseAuthError(res, "Could not reset password");
  return res.json();
}

export async function resendVerificationEmail({ email } = {}) {
  const res = await apiFetch("/api/auth/resend-verification", {
    method: "POST",
    body: JSON.stringify(email ? { email } : {}),
  });
  if (!res.ok) await parseAuthError(res, "Could not resend verification email");
  return res.json();
}

export async function changePassword({ currentPassword, newPassword }) {
  const res = await apiFetch("/api/auth/change-password", {
    method: "POST",
    body: JSON.stringify({
      current_password: currentPassword,
      new_password: newPassword,
    }),
  });
  if (!res.ok) await parseAuthError(res, "Could not change password");
  return res.json();
}

export async function updateProfile({ displayName }) {
  const res = await apiFetch("/api/auth/profile", {
    method: "PATCH",
    body: JSON.stringify({ display_name: displayName }),
  });
  if (!res.ok) await parseAuthError(res, "Could not update profile");
  return res.json();
}

export async function acceptTerms() {
  const res = await apiFetch("/api/auth/accept-terms", { method: "POST", body: "{}" });
  if (!res.ok) await parseAuthError(res, "Could not accept terms");
  return res.json();
}

export async function deleteAccount({ password }) {
  const res = await apiFetch("/api/auth/delete-account", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
  if (!res.ok) await parseAuthError(res, "Could not delete account");
  return res.json();
}

export async function loginWithPatreon(nextPath) {
  const next = nextPath || `${window.location.pathname}${window.location.search}`;
  const q = encodeURIComponent(next);
  const res = await fetch(`/api/auth/patreon/login?next=${q}`);
  if (!res.ok) throw new Error(await res.text());
  const { url } = await res.json();
  window.location.href = url;
}

export async function fetchMe() {
  const res = await apiFetch("/api/auth/me");
  if (!res.ok) return { authenticated: false };
  return res.json();
}

export async function logout() {
  await apiFetch("/api/auth/logout", { method: "POST" });
  setToken(null);
}

/** Legacy hook — auth callback is handled by AuthPages route. */
export function handleAuthCallback() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  if (!token || !window.location.pathname.startsWith("/auth/callback")) return null;
  setToken(token);
  notifyAuthChanged();
  const next = params.get("next") || "/projections/weekly";
  const safeNext = next.startsWith("/") ? next : "/projections/weekly";
  return safeNext;
}

export const PRODUCT_DISCLAIMER =
  "For entertainment and research only. Not gambling or financial advice. 18+ where applicable.";
