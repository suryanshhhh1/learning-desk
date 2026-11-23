// =============================================================
// Mock backend, used only when APP_CONFIG.MOCK is true.
// It copies the rules of apps-script/Code.gs but keeps all data in
// this browser's localStorage, so the full flow can be tested
// without Google. Logins (test data only, not the real PINs): "Anushka" or "Tester", PIN "0000".
//
// To wipe all mock data, run in the browser console:
//   localStorage.removeItem("nabh.mock.db")
// =============================================================

window.MockBackend = (function () {
  var DB_KEY = "nabh.mock.db";

  // Same defaults as the Settings tab. Can be overridden for testing with
  //   localStorage.setItem("nabh.mock.settings", '{"minSecondsPerSection":3}')
  var DEFAULT_SETTINGS = { passPercent: 85, minSecondsPerSection: 20, adminEmail: "admin@example.com" };

  // A few sample questions per module (same as setup() in Code.gs).
  var QUESTIONS = [
    // moduleId, questionId, question, A, B, C, D, correct, explanation
    [1, "M1-Q01", "What is the difference between OPD and IPD?", "OPD patients go home the same day, IPD patients are admitted", "OPD is for emergencies, IPD is for surgery", "OPD is for children, IPD is for adults", "There is no difference", "A", "OPD is the Outpatient Department (visit and go home). IPD is the Inpatient Department (admitted patients)."],
    [1, "M1-Q02", "Which doctor is present in the hospital round the clock and attends first when a ward calls?", "Visiting consultant", "Pathologist", "RMO (Resident Medical Officer)", "Radiologist", "C", "The RMO is present round the clock and is the first doctor to attend a ward or emergency call."],
    [1, "M1-Q03", "Which department cleans and sterilises surgical instruments?", "MRD", "CSSD", "Radiology", "Pharmacy", "B", "CSSD is the Central Sterile Supply Department."],
    [2, "M2-Q01", "A patient visits a hospital three times in a year and is admitted once. How many UHIDs should the patient have?", "One", "Two", "Three", "Four", "A", "The UHID is given at the first registration and never changes. One patient, one UHID."],
    [2, "M2-Q02", "Which document does the TPA read first?", "Vitals chart", "Nursing notes", "Discharge summary", "Registration form", "C", "The TPA reads the discharge summary first. Its diagnosis, dates and procedure must match the bill and the case sheet."],
    [2, "M2-Q03", "What is a medico-legal case (MLC)?", "A case handled by the hospital's lawyer", "A case where the injury or illness may have a legal side, such as an accident or assault", "A minor laparoscopic case", "A case referred from another hospital", "B", "MLCs include road accidents, assault, burns and poisoning. The doctor records them in the MLC register and informs the police."],
    [3, "M3-Q01", "Which diagnosis is written in the discharge summary?", "The provisional diagnosis", "The patient's own complaint", "The final diagnosis", "The diagnosis from the previous visit", "C", "The final diagnosis is the confirmed condition. It goes into the discharge summary and is used by the insurer."],
    [3, "M3-Q02", "What does the ending -ectomy mean?", "Inflammation", "Removal by surgery", "Looking inside with a camera", "Repair or reshaping", "B", "-ectomy means removal by surgery, as in appendectomy."],
    [3, "M3-Q03", "What does K/C/O DM mean in a doctor's note?", "Known case of diabetes mellitus", "Complaints of dizziness", "Kidney condition observed", "Known cause of death", "A", "K/C/O means known case of, so the patient was already diagnosed with diabetes mellitus earlier."],
    [4, "M4-Q01", "What does TDS mean in a prescription?", "Once a day", "Twice a day", "Three times a day", "At bedtime", "C", "TDS (or TID) means three times a day."],
    [4, "M4-Q02", "Which route puts the medicine into the blood fastest?", "Intramuscular (IM)", "Intravenous (IV)", "Subcutaneous (SC)", "Oral (PO)", "B", "IV goes directly into a vein, so the medicine is in the blood at once."],
    [4, "M4-Q03", "Why are LASA medicines stored apart from each other?", "They must be kept in a fridge", "They are narcotic drugs", "Their names or packs look or sound alike and can be confused", "They expire quickly", "C", "LASA means Look Alike Sound Alike. Storing them apart and labelling them prevents mix-ups."],
    [5, "M5-Q01", "When is the 'time out' of the surgical safety checklist done?", "Before anaesthesia", "Before the first cut", "Before the patient leaves the OT", "At discharge", "B", "Sign in is before anaesthesia, time out is before the first cut, and sign out is before the patient leaves the OT."],
    [5, "M5-Q02", "A patient is awake during a caesarean section. Which anaesthesia was most likely used?", "General anaesthesia", "Local anaesthesia", "Spinal anaesthesia", "Sedation", "C", "Spinal anaesthesia numbs the body below the waist while the patient stays awake."],
    [5, "M5-Q03", "What is the difference between disinfection and sterilisation?", "They are the same", "Sterilisation kills all germs including spores, disinfection kills most germs", "Disinfection kills all germs, sterilisation kills most", "Sterilisation only removes visible dirt", "B", "Disinfection kills most germs. Sterilisation, for example by autoclave, kills all germs including spores."]
  ];

  function load() {
    var db = JSON.parse(localStorage.getItem(DB_KEY) || "null");
    if (!db) {
      db = { users: [{ name: "Anushka", pin: "0000", active: true }, { name: "Tester", pin: "0000", active: true }], tokens: {}, progress: [], attempts: [] };
    }
    return db;
  }
  function save(db) { localStorage.setItem(DB_KEY, JSON.stringify(db)); }

  function settings() {
    var override = JSON.parse(localStorage.getItem("nabh.mock.settings") || "{}");
    return Object.assign({}, DEFAULT_SETTINGS, override);
  }

  var manifestPromise = null;
  function manifest() {
    if (!manifestPromise) {
      manifestPromise = fetch("content/modules.json", { cache: "no-cache" }).then(function (r) { return r.json(); });
    }
    return manifestPromise;
  }

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function progressRow(db, name, moduleId) {
    var row = db.progress.find(function (p) { return p.name === name && p.moduleId === moduleId; });
    if (!row) {
      row = { name: name, moduleId: moduleId, readComplete: false, passed: false, bestScorePct: "", attempts: 0, lastUpdated: "" };
      db.progress.push(row);
    }
    return row;
  }

  // Same rule as Code.gs: module 1, or the previous module passed. Unpublished is always locked.
  function isUnlocked(db, name, mod) {
    if (!mod || !mod.published) return false;
    if (mod.id === 1) return true;
    var prev = db.progress.find(function (p) { return p.name === name && p.moduleId === mod.id - 1; });
    return !!(prev && prev.passed);
  }

  async function handle(req) {
    // Small delay so loading states are visible, like a real network call.
    await new Promise(function (r) { setTimeout(r, 150); });

    var db = load();
    var m = await manifest();
    var findModule = function (id) { return m.modules.find(function (x) { return x.id === Number(id); }); };

    if (req.action === "login") {
      var user = db.users.find(function (u) {
        return u.active && u.name.toLowerCase() === String(req.name || "").trim().toLowerCase() && u.pin === String(req.pin || "").trim();
      });
      if (!user) return { ok: false, error: "Username or PIN is not correct." };
      var token = "mock-" + Math.random().toString(36).slice(2);
      db.tokens[token] = { name: user.name, expires: Date.now() + 12 * 3600 * 1000 };
      save(db);
      return { ok: true, token: token, name: user.name };
    }

    var session = db.tokens[req.token];
    if (!session || session.expires < Date.now()) {
      return { ok: false, code: "AUTH", error: "Your session has expired. Please log in again." };
    }
    var name = session.name;

    if (req.action === "getProgress") {
      var s = settings();
      return {
        ok: true,
        name: name,
        progress: db.progress.filter(function (p) { return p.name === name; }),
        settings: { passPercent: s.passPercent, minSecondsPerSection: s.minSecondsPerSection }
      };
    }

    if (req.action === "markReadComplete") {
      var mod = findModule(req.moduleId);
      if (!isUnlocked(db, name, mod)) return { ok: false, code: "LOCKED", error: "This module is locked." };
      var row = progressRow(db, name, mod.id);
      row.readComplete = true;
      row.lastUpdated = new Date().toISOString();
      save(db);
      return { ok: true };
    }

    if (req.action === "startTest") {
      var mod2 = findModule(req.moduleId);
      if (!isUnlocked(db, name, mod2)) return { ok: false, code: "LOCKED", error: "This module is locked." };
      var row2 = progressRow(db, name, mod2.id);
      if (!row2.readComplete) return { ok: false, code: "NOT_READ", error: "Please finish reading the module before taking the test." };

      var bank = QUESTIONS.filter(function (q) { return q[0] === mod2.id; });
      if (bank.length === 0) return { ok: false, error: "There are no questions for this module yet." };
      var count = Math.min(mod2.questionsPerTest || 15, bank.length);
      // For testing the timer: localStorage "nabh.mock.secondsPerQuestion" overrides 60.
      var limit = count * (Number(localStorage.getItem("nabh.mock.secondsPerQuestion")) || 60);
      var leftOf = function (a) { return Math.floor(limit - (Date.now() - new Date(a.issuedAt).getTime()) / 1000); };
      var open = db.attempts.filter(function (a) { return a.name === name && a.moduleId === mod2.id && !a.submittedAt && leftOf(a) > 0; }).pop();
      var picked, attemptId, left;
      if (open) {
        attemptId = open.attemptId; left = leftOf(open);
        picked = open.questionIds.map(function (id) { return bank.find(function (q) { return q[1] === id; }); });
      } else {
        picked = shuffle(bank.slice()).slice(0, count);
        attemptId = "A" + Date.now(); left = limit;
        db.attempts.push({ attemptId: attemptId, name: name, moduleId: mod2.id, issuedAt: new Date().toISOString(), submittedAt: "", questionIds: picked.map(function (q) { return q[1]; }) });
        save(db);
      }

      return {
        ok: true,
        attemptId: attemptId,
        moduleId: mod2.id,
        timeLimitSeconds: limit,
        secondsLeft: left,
        questions: picked.map(function (q) {
          var opts = [{ key: "A", text: q[3] }, { key: "B", text: q[4] }, { key: "C", text: q[5] }, { key: "D", text: q[6] }];
          return { questionId: q[1], question: q[2], options: shuffle(opts) };
        })
      };
    }

    if (req.action === "reviewQuestions") {
      var p = db.progress.find(function (x) { return x.name === name && x.moduleId === Number(req.moduleId); });
      if (!p || !p.passed) return { ok: false, code: "LOCKED", error: "Pass this module's test to see its questions and answers." };
      return {
        ok: true,
        moduleId: Number(req.moduleId),
        questions: QUESTIONS.filter(function (q) {
          return q[0] === Number(req.moduleId) && db.attempts.some(function (a) {
            return a.name === name && a.moduleId === Number(req.moduleId) && a.submittedAt && a.questionIds.indexOf(q[1]) !== -1;
          });
        }).map(function (q) {
          return {
            questionId: q[1], question: q[2], explanation: q[8],
            options: ["A", "B", "C", "D"].map(function (k, i) { return { text: q[3 + i], correct: k === q[7] }; })
          };
        })
      };
    }

    if (req.action === "submitTest") {
      var att = db.attempts.find(function (a) { return a.attemptId === req.attemptId && a.name === name; });
      if (!att) return { ok: false, error: "Test attempt not found." };
      if (att.submittedAt) return { ok: false, code: "ALREADY_SUBMITTED", error: "This test has already been submitted." };

      var answers = req.answers || {};
      var review = att.questionIds.map(function (qid) {
        var q = QUESTIONS.find(function (x) { return x[1] === qid; });
        var given = answers[qid] || "";
        var letters = { A: q[3], B: q[4], C: q[5], D: q[6] };
        return { questionId: qid, question: q[2], yourAnswer: letters[given] || "(no answer)", correctAnswer: letters[q[7]], isCorrect: given === q[7], explanation: q[8] };
      });
      var correct = review.filter(function (r) { return r.isCorrect; }).length;
      var total = review.length;
      var s2 = settings();
      var passed = correct / total >= s2.passPercent / 100;
      var pct = Math.round((correct / total) * 100);

      att.submittedAt = new Date().toISOString();
      att.correct = correct; att.total = total; att.scorePct = pct; att.result = passed ? "PASS" : "FAIL";

      var row3 = progressRow(db, name, att.moduleId);
      row3.attempts = (row3.attempts || 0) + 1;
      row3.bestScorePct = Math.max(Number(row3.bestScorePct) || 0, pct);
      if (passed) row3.passed = true; else row3.readComplete = false;
      row3.lastUpdated = att.submittedAt;
      save(db);

      console.log("[mock] Result email would be sent to " + s2.adminEmail + ": NABH Onboarding: " + name + ", Module " + att.moduleId + ", " + pct + "% " + att.result);
      return { ok: true, correct: correct, total: total, scorePct: pct, passed: passed, attemptNumber: row3.attempts, review: review };
    }

    return { ok: false, error: "Unknown action: " + req.action };
  }

  return { handle: handle };
})();
