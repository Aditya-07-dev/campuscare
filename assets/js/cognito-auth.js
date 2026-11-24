(function () {
  "use strict";

  const SESSION_KEY = "campuscare.cognito.session";
  const STATE_KEY = "campuscare.cognito.state";
  const VERIFIER_KEY = "campuscare.cognito.verifier";
  const NONCE_KEY = "campuscare.cognito.nonce";
  const config = window.CAMPUSCARE_AUTH_CONFIG;

  class AuthError extends Error {
    constructor(message, code) {
      super(message);
      this.name = "AuthError";
      this.code = code || "AUTH_ERROR";
    }
  }

  function getConfig() {
    const required = ["region", "userPoolId", "appClientId", "hostedUiDomain", "redirectUri", "logoutUri", "adminGroup"];
    if (!config || required.some((key) => !config[key] || String(config[key]).includes("REPLACE_WITH"))) {
      throw new AuthError("Cognito is not configured. Fill in the public values in assets/js/auth-config.js.", "CONFIGURATION");
    }
    const domain = new URL(config.hostedUiDomain);
    const redirect = new URL(config.redirectUri);
    const logout = new URL(config.logoutUri);
    if (domain.protocol !== "https:" || !["https:", "http:"].includes(redirect.protocol) ||
        !["https:", "http:"].includes(logout.protocol)) {
      throw new AuthError("Cognito domain and callback URLs must use HTTPS (HTTP is allowed for localhost development).", "CONFIGURATION");
    }
    if (redirect.hash || logout.hash) {
      throw new AuthError("Cognito callback and sign-out URLs cannot contain a fragment.", "CONFIGURATION");
    }
    if ((redirect.protocol === "http:" && !["localhost", "127.0.0.1"].includes(redirect.hostname)) ||
        (logout.protocol === "http:" && !["localhost", "127.0.0.1"].includes(logout.hostname))) {
      throw new AuthError("Use HTTPS for non-local callback and sign-out URLs.", "CONFIGURATION");
    }
    return {
      region: config.region,
      userPoolId: config.userPoolId,
      appClientId: config.appClientId,
      domain: domain.origin,
      redirectUri: redirect.href,
      logoutUri: logout.href,
      apiBaseUrl: String(config.apiBaseUrl || "").replace(/\/+$/, ""),
      adminGroup: config.adminGroup,
      scopes: Array.isArray(config.scopes) ? config.scopes : ["openid", "email", "profile"]
    };
  }

  function base64Url(bytes) {
    let binary = "";
    bytes.forEach((value) => { binary += String.fromCharCode(value); });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function randomUrlSafe(length) {
    const bytes = new Uint8Array(length);
    window.crypto.getRandomValues(bytes);
    return base64Url(bytes);
  }

  function decodeJwtPayload(token) {
    const parts = String(token || "").split(".");
    if (parts.length !== 3) throw new AuthError("Cognito returned a malformed token.", "INVALID_TOKEN");
    const encoded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = encoded + "=".repeat((4 - encoded.length % 4) % 4);
    try {
      return JSON.parse(decodeURIComponent(Array.prototype.map.call(atob(padded), (char) =>
        `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`).join("")));
    } catch (error) {
      throw new AuthError("Cognito returned a token with unreadable claims.", "INVALID_TOKEN");
    }
  }

  function expectedIssuer(settings) {
    return `https://cognito-idp.${settings.region}.amazonaws.com/${settings.userPoolId}`;
  }

  function validateTokenSet(tokens, settings, expectedNonce) {
    if (!tokens || !tokens.access_token || !tokens.id_token ||
        !Number.isFinite(Number(tokens.expires_in)) || Number(tokens.expires_in) <= 0) {
      throw new AuthError("Cognito did not return the required access and ID tokens.", "INVALID_TOKEN");
    }
    const accessClaims = decodeJwtPayload(tokens.access_token);
    const idClaims = decodeJwtPayload(tokens.id_token);
    const issuer = expectedIssuer(settings);
    const now = Math.floor(Date.now() / 1000);
    if (accessClaims.iss !== issuer || accessClaims.token_use !== "access" ||
        accessClaims.client_id !== settings.appClientId || !accessClaims.sub || accessClaims.exp <= now) {
      throw new AuthError("The Cognito access token is not valid for this application.", "INVALID_TOKEN");
    }
    if (idClaims.iss !== issuer || idClaims.token_use !== "id" ||
        idClaims.aud !== settings.appClientId || !idClaims.sub || idClaims.exp <= now ||
        (expectedNonce && idClaims.nonce !== expectedNonce)) {
      throw new AuthError("The Cognito ID token could not be validated for this sign-in.", "INVALID_TOKEN");
    }
    return { accessClaims, idClaims };
  }

  async function beginSignIn(screenHint) {
    const settings = getConfig();
    if (!window.crypto || !window.crypto.subtle) {
      throw new AuthError("Secure browser cryptography is unavailable. Use HTTPS or localhost.", "BROWSER_UNSUPPORTED");
    }
    const verifier = randomUrlSafe(32);
    const challengeBytes = new Uint8Array(await window.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(verifier)
    ));
    const state = randomUrlSafe(24);
    const nonce = randomUrlSafe(24);
    sessionStorage.setItem(STATE_KEY, state);
    sessionStorage.setItem(VERIFIER_KEY, verifier);
    sessionStorage.setItem(NONCE_KEY, nonce);

    const url = new URL("/oauth2/authorize", settings.domain);
    url.search = new URLSearchParams({
      client_id: settings.appClientId,
      response_type: "code",
      redirect_uri: settings.redirectUri,
      scope: settings.scopes.join(" "),
      state,
      nonce,
      code_challenge: base64Url(challengeBytes),
      code_challenge_method: "S256",
      ...(screenHint === "signup" ? { screen_hint: "signup" } : {})
    }).toString();
    window.location.assign(url.href);
  }

  async function postTokenForm(settings, values) {
    const response = await fetch(`${settings.domain}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(values),
      credentials: "omit",
      cache: "no-store"
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new AuthError(payload.error_description || payload.error || "Cognito could not complete authentication.", payload.error || "TOKEN_EXCHANGE");
    }
    return payload;
  }

  function clearTemporaryState() {
    sessionStorage.removeItem(STATE_KEY);
    sessionStorage.removeItem(VERIFIER_KEY);
    sessionStorage.removeItem(NONCE_KEY);
  }

  function cleanCallbackUrl(settings) {
    const callback = new URL(settings.redirectUri);
    if (window.location.origin === callback.origin) {
      window.history.replaceState({}, document.title, callback.pathname);
    }
  }

  async function handleCallback() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const oauthError = params.get("error");
    if (!code && !oauthError) return { handled: false, error: null };

    let settings;
    try {
      settings = getConfig();
      if (oauthError) {
        const description = params.get("error_description");
        clearTemporaryState();
        cleanCallbackUrl(settings);
        return { handled: true, error: description || oauthError };
      }

      const state = sessionStorage.getItem(STATE_KEY);
      const verifier = sessionStorage.getItem(VERIFIER_KEY);
      const nonce = sessionStorage.getItem(NONCE_KEY);
      if (!state || !verifier || !nonce || params.get("state") !== state) {
        throw new AuthError("Sign-in state did not match. Restart sign-in to protect this session.", "INVALID_STATE");
      }

      const tokens = await postTokenForm(settings, {
        grant_type: "authorization_code",
        client_id: settings.appClientId,
        code,
        redirect_uri: settings.redirectUri,
        code_verifier: verifier
      });
      const validated = validateTokenSet(tokens, settings, nonce);
      const session = {
        accessToken: tokens.access_token,
        idToken: tokens.id_token,
        refreshToken: tokens.refresh_token || "",
        expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000,
        sub: validated.idClaims.sub
      };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
      clearTemporaryState();
      cleanCallbackUrl(settings);
      return { handled: true, error: null };
    } catch (error) {
      clearTemporaryState();
      if (settings) cleanCallbackUrl(settings);
      return {
        handled: true,
        error: error instanceof AuthError ? error.message : "Could not finish sign-in. Check the Cognito app configuration and try again."
      };
    }
  }

  function readSession() {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    try {
      const session = JSON.parse(raw);
      if (!session.accessToken || !session.idToken || !Number.isFinite(session.expiresAt)) {
        throw new Error("invalid");
      }
      return session;
    } catch (error) {
      sessionStorage.removeItem(SESSION_KEY);
      throw new AuthError("The saved sign-in session is invalid. Sign in again.", "INVALID_SESSION");
    }
  }

  async function getSession() {
    const session = readSession();
    if (!session) return null;
    if (session.expiresAt > Date.now() + 60 * 1000) return session;
    if (!session.refreshToken) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    const settings = getConfig();
    let tokens;
    try {
      tokens = await postTokenForm(settings, {
        grant_type: "refresh_token",
        client_id: settings.appClientId,
        refresh_token: session.refreshToken
      });
    } catch (error) {
      if (error instanceof AuthError && error.code === "invalid_grant") {
        sessionStorage.removeItem(SESSION_KEY);
        return null;
      }
      throw error;
    }
    const validated = validateTokenSet(tokens, settings);
    const refreshed = {
      accessToken: tokens.access_token,
      idToken: tokens.id_token,
      refreshToken: tokens.refresh_token || session.refreshToken,
      expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000,
      sub: validated.idClaims.sub
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(refreshed));
    return refreshed;
  }

  async function apiRequest(path, options) {
    const request = options || {};
    const settings = getConfig();
    if (!settings.apiBaseUrl) {
      throw new AuthError("Backend authorization is not configured. Protected pages remain locked until the authenticated Function URL is added to auth-config.js.", "BACKEND_NOT_CONFIGURED");
    }
    const session = request.session || await getSession();
    if (!session) {
      throw new AuthError("Your sign-in session has expired. Sign in again.", "UNAUTHENTICATED");
    }
    if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) {
      throw new AuthError("The backend request path is invalid.", "CONFIGURATION");
    }
    const base = new URL(settings.apiBaseUrl);
    if (base.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(base.hostname)) {
      throw new AuthError("The backend URL must use HTTPS.", "CONFIGURATION");
    }
    const url = new URL(path, settings.apiBaseUrl);
    if (url.origin !== base.origin) {
      throw new AuthError("The backend request must stay on the configured Function URL.", "CONFIGURATION");
    }
    const method = String(request.method || "GET").toUpperCase();
    if (!["GET", "POST", "PATCH"].includes(method)) {
      throw new AuthError("This backend request method is not supported.", "CONFIGURATION");
    }
    const headers = { Authorization: `Bearer ${session.accessToken}` };
    const fetchOptions = {
      method,
      headers,
      credentials: "omit",
      cache: "no-store"
    };
    if (request.body !== undefined) {
      headers["Content-Type"] = "application/json";
      fetchOptions.body = JSON.stringify(request.body);
    }
    const response = await fetch(url.href, fetchOptions);
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) {
      sessionStorage.removeItem(SESSION_KEY);
      throw new AuthError("Your sign-in expired. Sign in again.", "UNAUTHENTICATED");
    }
    if (response.status === 403) {
      throw new AuthError(payload.message || "Your account is not permitted to perform this action.", "FORBIDDEN");
    }
    if (!response.ok) throw new AuthError(payload.message || "The backend could not verify your access.", "BACKEND_ERROR");
    return payload;
  }

  function apiGet(path, session) {
    return apiRequest(path, { method: "GET", session });
  }

  async function authorizePage(requiredRole) {
    const session = await getSession();
    if (!session) return { authenticated: false, user: null };
    const settings = getConfig();
    const profile = await apiGet("/auth/me", session);
    if (!profile || profile.sub !== session.sub || !["student", "admin"].includes(profile.role)) {
      throw new AuthError("The backend returned an invalid user profile.", "BACKEND_ERROR");
    }
    if (!Array.isArray(profile.groups) ||
        (profile.role === "admin") !== profile.groups.includes(settings.adminGroup)) {
      throw new AuthError("The backend returned inconsistent role and group information.", "BACKEND_ERROR");
    }
    // ID-token claims are for display only; the Lambda verifies the access-token signature and role.
    const identity = decodeJwtPayload(session.idToken);
    if (identity.sub !== profile.sub) {
      throw new AuthError("The Cognito identity does not match the backend-verified user.", "INVALID_TOKEN");
    }
    profile.id = profile.sub;
    profile.name = identity.name || identity.email || "CampusCare user";
    profile.email = identity.email || "";
    if (requiredRole === "admin") {
      if (profile.role !== "admin") return { authenticated: true, user: profile };
      const adminCheck = await apiGet("/admin/check", session);
      if (!adminCheck || adminCheck.ok !== true || adminCheck.sub !== profile.sub) {
        throw new AuthError("Administrator access was not confirmed by the backend.", "FORBIDDEN");
      }
      profile.role = "admin";
    }
    return { authenticated: true, user: profile };
  }

  async function signOut() {
    sessionStorage.removeItem(SESSION_KEY);
    clearTemporaryState();
    const settings = getConfig();
    const url = new URL("/logout", settings.domain);
    url.search = new URLSearchParams({
      client_id: settings.appClientId,
      logout_uri: settings.logoutUri
    }).toString();
    window.location.assign(url.href);
  }

  function configurationStatus() {
    try {
      getConfig();
      return { configured: true, message: "" };
    } catch (error) {
      return { configured: false, message: error.message };
    }
  }

  window.CampusCareAuth = Object.freeze({
    AuthError,
    beginSignIn,
    handleCallback,
    getSession,
    apiRequest,
    authorizePage,
    signOut,
    configurationStatus
  });
}());
