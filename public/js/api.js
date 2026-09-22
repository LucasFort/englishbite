const Api = (() => {
  function getToken() {
    return localStorage.getItem("eb_token") || "";
  }
  function setToken(token) {
    localStorage.setItem("eb_token", token);
  }
  function clearToken() {
    localStorage.removeItem("eb_token");
  }
  function getUser() {
    try {
      return JSON.parse(localStorage.getItem("eb_user") || "null");
    } catch {
      return null;
    }
  }
  function setUser(user) {
    localStorage.setItem("eb_user", JSON.stringify(user));
  }

  async function request(path, { method = "GET", body = null, auth = false } = {}) {
    const headers = { "Content-Type": "application/json" };
    if (auth) headers["Authorization"] = "Bearer " + getToken();

    const res = await fetch(path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }

    if (!res.ok) {
      const message = (data && data.error) || "Algo deu errado. Tente novamente.";
      throw new Error(message);
    }
    return data;
  }

  function requireAuth(redirectTo = "login.html") {
    if (!getToken()) {
      window.location.href = redirectTo;
    }
  }

  function logout() {
    clearToken();
    localStorage.removeItem("eb_user");
    window.location.href = "index.html";
  }

  return { request, getToken, setToken, clearToken, getUser, setUser, requireAuth, logout };
})();
