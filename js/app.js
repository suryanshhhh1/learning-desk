// =============================================================
// Shared helpers used by all three pages.
// =============================================================

window.App = (function () {

  // Send the user to the login page if there is no saved session.
  function requireLogin() {
    if (!Api.getToken()) {
      window.location.replace("index.html");
      return false;
    }
    return true;
  }

  // Browsers keep recent pages in a back/forward cache, so pressing Back
  // after logging out could show an old page without loading it again.
  // When a page is shown from that cache, check the session again.
  window.addEventListener("pageshow", function (e) {
    if (!e.persisted) return;
    var onLoginPage = /index\.html$|\/$/.test(window.location.pathname);
    if (!Api.getToken() && !onLoginPage) {
      window.location.replace("index.html");
    } else {
      window.location.reload();
    }
  });

  // Read a ?key=value from the page URL.
  function param(key) {
    return new URLSearchParams(window.location.search).get(key);
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // Load content/modules.json. "no-cache" makes the browser check for a newer copy.
  async function loadManifest() {
    var res = await fetch("content/modules.json", { cache: "no-cache" });
    if (!res.ok) throw new Error("Could not load the module list.");
    return res.json();
  }

  // Treat TRUE, "TRUE" and true the same (Google Sheets can return either).
  function isTrue(v) { return v === true || String(v).toUpperCase() === "TRUE"; }

  // Work out the dashboard status of every module from the progress rows.
  // Returns: "completed" | "testReady" | "open" | "locked" | "comingSoon"
  function moduleStatuses(modules, progressRows) {
    var byId = {};
    (progressRows || []).forEach(function (p) { byId[Number(p.moduleId)] = p; });

    return modules.map(function (mod) {
      var p = byId[mod.id] || {};
      var prev = byId[mod.id - 1] || {};
      var status;
      if (!mod.published) status = "comingSoon";
      else if (isTrue(p.passed)) status = "completed";
      else if (mod.id !== 1 && !isTrue(prev.passed)) status = "locked";
      else if (isTrue(p.readComplete)) status = "testReady";
      else status = "open";
      return { module: mod, progress: p, status: status };
    });
  }

  // ----- Reading position, kept in localStorage per user and module -----
  function readKey(moduleId) { return "nabh.read." + (Api.getName() || "") + "." + moduleId; }

  // { current: index of the section on screen, maxSeen: furthest section already timed }
  function getReadState(moduleId) {
    return JSON.parse(localStorage.getItem(readKey(moduleId)) || '{"current":0,"maxSeen":-1}');
  }
  function setReadState(moduleId, state) {
    localStorage.setItem(readKey(moduleId), JSON.stringify(state));
  }
  // Called after a failed test, so reading starts again at section 1 with timers.
  function resetReadState(moduleId) {
    localStorage.removeItem(readKey(moduleId));
  }

  // ----- Markdown splitting -----
  // Splits a module file into screens:
  //   screen 1 = text before the first "### " heading (the introduction)
  //   then one screen per "### " section, except "Check yourself".
  function splitSections(markdown) {
    var lines = markdown.replace(/\r\n/g, "\n").split("\n");
    var title = "";
    var sections = [];
    var current = { heading: "Introduction", lines: [] };

    lines.forEach(function (line) {
      if (/^# /.test(line) && !title) {
        title = line.replace(/^# /, "").trim();
      } else if (/^### /.test(line)) {
        sections.push(current);
        current = { heading: line.replace(/^### /, "").trim(), lines: [] };
      } else {
        current.lines.push(line);
      }
    });
    sections.push(current);

    return {
      title: title,
      sections: sections
        .map(function (s) { return { heading: s.heading, body: s.lines.join("\n").trim() }; })
        // Drop an empty introduction, and the "Check yourself" section (the test replaces it).
        .filter(function (s, i) {
          if (i === 0 && !s.body) return false;
          return s.heading.toLowerCase() !== "check yourself";
        })
    };
  }

  // Show a message in an element with id="message".
  function showMessage(text, isError) {
    var el = document.getElementById("message");
    if (!el) return;
    el.textContent = text || "";
    el.className = "message" + (isError ? " error" : "") + (text ? "" : " hidden");
  }

  return {
    requireLogin: requireLogin,
    param: param,
    escapeHtml: escapeHtml,
    loadManifest: loadManifest,
    isTrue: isTrue,
    moduleStatuses: moduleStatuses,
    getReadState: getReadState,
    setReadState: setReadState,
    resetReadState: resetReadState,
    splitSections: splitSections,
    showMessage: showMessage
  };
})();
