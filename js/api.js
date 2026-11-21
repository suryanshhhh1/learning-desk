// =============================================================
// All calls to the backend go through Api.call(action, data).
//
// Real mode: POST to the Apps Script web app. The body is JSON but
// sent as text/plain, which avoids a CORS preflight request.
// Mock mode: the same actions are answered by MockBackend (js/mock.js).
//
// Every response has the shape { ok: true, ... } or
// { ok: false, error: "message", code: "AUTH" | "LOCKED" | ... }.
// =============================================================

window.Api = (function () {
  var TOKEN_KEY = "nabh.token";
  var NAME_KEY = "nabh.name";

  // Previews on this computer (localhost) always use the test backend,
  // so local testing never touches the real Google Sheet.
  var useMock = APP_CONFIG.MOCK || /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);

  function getToken() { return localStorage.getItem(TOKEN_KEY); }
  function getName() { return localStorage.getItem(NAME_KEY); }

  function saveSession(token, name) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(NAME_KEY, name);
  }

  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(NAME_KEY);
  }

  async function call(action, data) {
    var body = Object.assign({ action: action, token: getToken() }, data || {});
    var result;

    if (useMock) {
      result = await MockBackend.handle(body);
    } else {
      try {
        var res = await fetch(APP_CONFIG.API_URL, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify(body)
        });
        result = await res.json();
      } catch (e) {
        result = { ok: false, error: "Could not reach the server. Check your internet connection and try again." };
      }
    }

    // Expired or missing session: go back to the login screen.
    if (!result.ok && result.code === "AUTH" && action !== "login") {
      clearSession();
      window.location.href = "index.html?expired=1";
      // Never resolve, so the calling page stops here.
      return new Promise(function () {});
    }
    return result;
  }

  return {
    call: call,
    getToken: getToken,
    getName: getName,
    saveSession: saveSession,
    clearSession: clearSession
  };
})();
