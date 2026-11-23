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
  var PROGRESS_KEY = "nabh.progress";

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
    localStorage.removeItem(PROGRESS_KEY);
  }

  // ---------- Saved progress ----------
  // The last progress the server sent is kept on this device, so pages
  // can draw straight away and then check with the server in the
  // background. The server still checks every action, so an old copy
  // can never unlock anything.
  function savedProgress() {
    try {
      var p = JSON.parse(localStorage.getItem(PROGRESS_KEY));
      return p && p.token === getToken() ? p : null;
    } catch (e) { return null; }
  }

  function saveProgress(res) {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify({
      token: getToken(), at: Date.now(), name: res.name, progress: res.progress, settings: res.settings
    }));
  }

  // Change one module's saved row after a successful action.
  function patchProgress(moduleId, change) {
    var p = savedProgress();
    if (!p) return;
    var row = p.progress.find(function (r) { return Number(r.moduleId) === Number(moduleId); });
    if (!row) { row = { moduleId: Number(moduleId), readComplete: false, passed: false, bestScorePct: "", attempts: 0 }; p.progress.push(row); }
    Object.assign(row, change);
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
  }

  // Calls onData with the saved copy at once (if there is one), then
  // again with the server's answer if it is different. Resolves with
  // the server's answer.
  async function loadProgress(onData) {
    var saved = savedProgress();
    var shown = null;
    if (saved) { shown = JSON.stringify(saved.progress) + JSON.stringify(saved.settings); onData(Object.assign({ ok: true }, saved)); }
    // Just logged in: the login answer already had the progress.
    if (saved && Date.now() - saved.at < 15000) return saved;
    var res = await call("getProgress");
    if (!res.ok) { if (!saved) onData(res); return res; }
    if (JSON.stringify(res.progress) + JSON.stringify(res.settings) !== shown) onData(res);
    return res;
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

    if (result.ok) {
      if (action === "login" || action === "getProgress") {
        if (action === "login") saveSession(result.token, result.name);
        if (result.progress) saveProgress(result);
      }
      if (action === "markReadComplete") patchProgress(data.moduleId, { readComplete: true });
      if (action === "submitTest") {
        var p = savedProgress(), prev = p && p.progress.find(function (r) { return Number(r.moduleId) === Number(result.moduleId || data.moduleId); });
        var change = { attempts: result.attemptNumber, bestScorePct: Math.max(Number(prev && prev.bestScorePct) || 0, result.scorePct) };
        if (result.passed) change.passed = true; else change.readComplete = false;
        patchProgress(result.moduleId || data.moduleId, change);
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
    clearSession: clearSession,
    loadProgress: loadProgress
  };
})();
