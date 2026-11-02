(function () {
  const projectUrl = window.SMART_MOVE_SUPABASE_URL?.trim();
  const publishableKey = window.SMART_MOVE_SUPABASE_ANON_KEY?.trim();

  if (
    !projectUrl ||
    !publishableKey ||
    projectUrl.includes("YOUR_SUPABASE") ||
    publishableKey.includes("YOUR_SUPABASE")
  ) {
    window.smartMoveConfigError =
      "Set the Supabase project URL and publishable key in supabase-config.js.";
    return;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(projectUrl);
  } catch {
    window.smartMoveConfigError =
      "The Supabase project URL in supabase-config.js is invalid.";
    return;
  }

  if (parsedUrl.protocol !== "https:") {
    window.smartMoveConfigError =
      "The Supabase project URL must use HTTPS.";
    return;
  }

  const baseUrl = projectUrl.replace(/\/+$/, "");
  const sessionKey = "smartMoveSupabaseSession";

  async function request(path, options = {}, token) {
    const headers = new Headers(options.headers || {});
    headers.set("apikey", publishableKey);
    headers.set("Content-Type", "application/json");
    if (token) headers.set("Authorization", `Bearer ${token}`);

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    let response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers,
        signal: controller.signal,
      });
    } catch (error) {
      if (error.name === "AbortError") {
        const timeoutError = new Error(
          "Supabase did not respond in time. Please try again.",
        );
        timeoutError.code = "NETWORK";
        throw timeoutError;
      }
      const connectionError = new Error(
        `Could not connect to Supabase. Check your internet connection and project settings. (${error.message})`,
      );
      connectionError.code = "NETWORK";
      throw connectionError;
    } finally {
      window.clearTimeout(timeout);
    }

    const responseText = await response.text();
    let data;
    try {
      data = responseText ? JSON.parse(responseText) : null;
    } catch {
      throw new Error("Supabase returned an unreadable response.");
    }

    if (!response.ok) {
      throw new Error(
        data?.msg || data?.message || data?.error_description ||
          data?.error || `Supabase request failed (${response.status}).`,
      );
    }

    return data;
  }

  function saveSession(session) {
    const savedSession = {
      ...session,
      expires_at:
        session.expires_at ||
        Math.floor(Date.now() / 1000) + (session.expires_in || 3600),
    };
    localStorage.setItem(sessionKey, JSON.stringify(savedSession));
    return savedSession;
  }

  function readSession() {
    const stored = localStorage.getItem(sessionKey);
    if (!stored) return null;

    try {
      return JSON.parse(stored);
    } catch {
      localStorage.removeItem(sessionKey);
      throw new Error("The saved sign-in session is invalid. Please sign in again.");
    }
  }

  async function getSession() {
    let session = readSession();
    if (!session) return null;

    if (session.expires_at > Math.floor(Date.now() / 1000) + 60) {
      return session;
    }

    if (!session.refresh_token) {
      localStorage.removeItem(sessionKey);
      return null;
    }

    try {
      session = saveSession(await request("/auth/v1/token?grant_type=refresh_token", {
        method: "POST",
        body: JSON.stringify({ refresh_token: session.refresh_token }),
      }));
      return session;
    } catch (error) {
      if (error.code === "NETWORK") throw error;
      localStorage.removeItem(sessionKey);
      throw new Error(`Your sign-in expired. Please sign in again. ${error.message}`);
    }
  }

  function getCachedSession() {
    return readSession();
  }

  async function signUp(email, password) {
    const redirectTo = `${location.origin}${location.pathname}`;
    const result = await request(
      `/auth/v1/signup?redirect_to=${encodeURIComponent(redirectTo)}`,
      {
        method: "POST",
        body: JSON.stringify({
          email,
          password,
          data: {},
        }),
      },
    );

    if (result.access_token) saveSession(result);
    return result;
  }

  async function signIn(email, password) {
    const result = await request("/auth/v1/token?grant_type=password", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });

    saveSession(result);
    return result;
  }

  async function signOut() {
    const session = await getSession();
    try {
      if (session?.access_token) {
        await request("/auth/v1/logout", { method: "POST" }, session.access_token);
      }
    } finally {
      localStorage.removeItem(sessionKey);
    }
  }

  function clearLocalSession() {
    localStorage.removeItem(sessionKey);
  }

  async function rpc(functionName, parameters = {}) {
    const session = await getSession();
    if (!session?.access_token) throw new Error("Sign in to continue.");

    return request(
      `/rest/v1/rpc/${encodeURIComponent(functionName)}`,
      { method: "POST", body: JSON.stringify(parameters) },
      session.access_token,
    );
  }

  window.smartMoveSupabase = {
    getSession,
    getCachedSession,
    signUp,
    signIn,
    signOut,
    clearLocalSession,
    rpc,
  };
})();
