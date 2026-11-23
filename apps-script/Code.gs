/**
 * =============================================================
 * NABH Onboarding backend (Google Apps Script)
 *
 * Paste this whole file into Extensions > Apps Script of the
 * Google Sheet, run setup() once, then deploy as a web app.
 * See README.md for the steps.
 *
 * The answer key lives only in the Questions tab. Correct answers
 * and explanations are sent to the browser only after a test has
 * been submitted.
 * =============================================================
 */

// ---------- Tab names and their columns ----------
var TABS = {
  Users: ['name', 'pin', 'active'],
  Progress: ['name', 'moduleId', 'readComplete', 'passed', 'bestScorePct', 'attempts', 'lastUpdated'],
  Attempts: ['attemptId', 'name', 'moduleId', 'issuedAt', 'submittedAt', 'questionIds', 'answersGiven', 'correct', 'total', 'scorePct', 'result'],
  Questions: ['moduleId', 'questionId', 'question', 'optionA', 'optionB', 'optionC', 'optionD', 'correct', 'explanation'],
  Settings: ['key', 'value']
};

// Default values written to the Settings tab by setup().
var DEFAULT_SETTINGS = [
  ['passPercent', 85],
  ['adminEmail', 'hboy7114@gmail.com'],
  ['minSecondsPerSection', 20],
  // Time allowed for a test: this many seconds for each question.
  ['secondsPerQuestion', 60],
  // Usernames (comma separated) who may see every question of a passed
  // module, not only the ones they were asked. For a test account.
  ['seeAllQuestions', 'Tester'],
  // The GitHub Pages address of the site. The backend reads
  // content/modules.json from here to know titles, which modules are
  // published and how many questions each test has.
  ['siteUrl', 'https://suryanshhhh1.github.io/learning-desk/']
];

var SESSION_HOURS = 12;

// Extra seconds allowed after the timer ends, for a slow connection.
var GRACE_SECONDS = 30;

// Users, Settings and Questions rarely change, so they are kept in a
// cache for this many seconds. Edits in the Sheet show up within this time.
var SHEET_CACHE_SECONDS = 60;
var CACHED_TABS = { Users: true, Settings: true };

// Rows already read during this request, by tab name.
var ROWS = {};

// =============================================================
// Web app entry point
// =============================================================

function doPost(e) {
  var result;
  ROWS = {};
  try {
    var req = JSON.parse(e.postData.contents);
    result = route(req);
  } catch (err) {
    result = { ok: false, error: 'Server error: ' + err.message };
  }
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// A simple page so opening the web app URL in a browser shows it is running.
function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, message: 'NABH Onboarding backend is running.' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function route(req) {
  if (req.action === 'login') return login(req);

  var name = checkToken(req.token);
  if (!name) return { ok: false, code: 'AUTH', error: 'Your session has expired. Please log in again.' };

  switch (req.action) {
    case 'getProgress': return getProgress(name);
    case 'markReadComplete': return withLock(function () { return markReadComplete(name, Number(req.moduleId)); });
    case 'startTest': return withLock(function () { return startTest(name, Number(req.moduleId)); });
    case 'submitTest': return withLock(function () { return submitTest(name, String(req.attemptId), req.answers || {}); });
    case 'reviewQuestions': return reviewQuestions(name, Number(req.moduleId));
    default: return { ok: false, error: 'Unknown action: ' + req.action };
  }
}

// =============================================================
// Actions
// =============================================================

function login(req) {
  var name = String(req.name || '').trim().toLowerCase();
  var pin = String(req.pin || '').trim();
  var user = readRows('Users').filter(function (u) {
    return String(u.name).trim().toLowerCase() === name &&
      String(u.pin).trim() === pin &&
      isTrue(u.active);
  })[0];
  if (!user) return { ok: false, error: 'Username or PIN is not correct.' };

  // Sessions are kept in Script Properties because CacheService
  // cannot hold items for longer than 6 hours.
  var props = PropertiesService.getScriptProperties();
  cleanExpiredTokens(props);
  var token = Utilities.getUuid();
  props.setProperty('token_' + token, JSON.stringify({
    name: String(user.name).trim(),
    pinHash: pinHash(user.pin),   // a changed PIN ends this session
    expires: Date.now() + SESSION_HOURS * 3600 * 1000
  }));
  // Send progress along with the login so the dashboard needs no second request.
  var result = getProgress(String(user.name).trim());
  result.token = token;
  return result;
}

function getProgress(name) {
  var s = getSettings();
  var rows = readRows('Progress').filter(function (p) { return sameName(p.name, name); }).map(function (p) {
    return {
      moduleId: Number(p.moduleId),
      readComplete: isTrue(p.readComplete),
      passed: isTrue(p.passed),
      bestScorePct: p.bestScorePct,
      attempts: Number(p.attempts) || 0
    };
  });
  return {
    ok: true,
    name: name,
    progress: rows,
    settings: { passPercent: Number(s.passPercent), minSecondsPerSection: Number(s.minSecondsPerSection) }
  };
}

function markReadComplete(name, moduleId) {
  var mod = getModule(moduleId);
  if (!isUnlocked(name, mod)) return { ok: false, code: 'LOCKED', error: 'This module is locked.' };
  updateProgress(name, moduleId, { readComplete: true });
  return { ok: true };
}

function startTest(name, moduleId) {
  var mod = getModule(moduleId);
  if (!isUnlocked(name, mod)) return { ok: false, code: 'LOCKED', error: 'This module is locked.' };
  var progress = findProgress(name, moduleId);
  if (!progress || !isTrue(progress.readComplete)) {
    return { ok: false, code: 'NOT_READ', error: 'Please finish reading the module before taking the test.' };
  }

  var bank = questionsFor(moduleId);
  if (bank.length === 0) return { ok: false, error: 'There are no questions for this module yet.' };
  var count = Math.min(Number(mod.questionsPerTest) || 15, bank.length);
  var limit = timeLimitSeconds(count);

  var mine = readRows('Attempts').filter(function (a) { return sameName(a.name, name) && Number(a.moduleId) === moduleId; });

  // A test that was started and not submitted, with time left, carries on
  // with the same questions and the same clock (for example after a reload).
  var open = mine.filter(function (a) {
    return !a.submittedAt && secondsLeft(a.issuedAt, limit) > 0;
  }).pop();

  var attemptId, picked, left;
  if (open) {
    attemptId = String(open.attemptId);
    var byId = {};
    bank.forEach(function (q) { byId[String(q.questionId)] = q; });
    picked = String(open.questionIds).split(',').map(function (id) { return byId[id]; }).filter(Boolean);
    left = secondsLeft(open.issuedAt, limit);
  } else {
    // Questions this user has seen fewer times come first, so a second or
    // third attempt gets questions they have not had before.
    var seen = {};
    mine.forEach(function (a) {
      String(a.questionIds).split(',').forEach(function (id) { seen[id] = (seen[id] || 0) + 1; });
    });
    picked = shuffle(bank)
      .sort(function (a, b) { return (seen[String(a.questionId)] || 0) - (seen[String(b.questionId)] || 0); })
      .slice(0, count);
    picked = shuffle(picked);

    attemptId = 'A' + new Date().getTime() + '-' + Math.floor(Math.random() * 1000);
    appendRow('Attempts', {
      attemptId: attemptId,
      name: name,
      moduleId: moduleId,
      issuedAt: new Date(),
      submittedAt: '',
      questionIds: picked.map(function (q) { return q.questionId; }).join(','),
      answersGiven: '', correct: '', total: '', scorePct: '', result: ''
    });
    left = limit;
  }

  // Send questions and shuffled options. No correct answer, no explanation.
  var questions = picked.map(function (q) {
    var options = ['A', 'B', 'C', 'D']
      .filter(function (k) { return String(q['option' + k]).trim() !== ''; })
      .map(function (k) { return { key: k, text: String(q['option' + k]) }; });
    return { questionId: String(q.questionId), question: String(q.question), options: shuffle(options) };
  });
  return { ok: true, attemptId: attemptId, moduleId: moduleId, questions: questions, timeLimitSeconds: limit, secondsLeft: left };
}

function submitTest(name, attemptId, answers) {
  var sheet = getSheet('Attempts');
  var attempts = readRows('Attempts');
  var att = attempts.filter(function (a) { return String(a.attemptId) === attemptId && sameName(a.name, name); })[0];
  if (!att) return { ok: false, error: 'Test attempt not found.' };
  if (att.submittedAt !== '' && att.submittedAt !== null) {
    return { ok: false, code: 'ALREADY_SUBMITTED', error: 'This test has already been submitted.' };
  }

  var moduleId = Number(att.moduleId);
  var mod = getModule(moduleId) || { id: moduleId, title: '' };
  var settings = getSettings();
  var passPercent = Number(settings.passPercent) || 85;

  // Grade on the server.
  var bankById = {};
  questionsFor(moduleId).forEach(function (q) { bankById[String(q.questionId)] = q; });
  var ids = String(att.questionIds).split(',').filter(String);

  var review = ids.map(function (id) {
    var q = bankById[id] || {};
    var given = String(answers[id] || '').toUpperCase();
    var correctKey = String(q.correct || '').trim().toUpperCase();
    return {
      questionId: id,
      question: String(q.question || '(question removed)'),
      yourAnswerKey: given,
      yourAnswer: given ? String(q['option' + given] || '') : '(no answer)',
      correctAnswer: String(q['option' + correctKey] || ''),
      isCorrect: given !== '' && given === correctKey,
      explanation: String(q.explanation || '')
    };
  });

  var correct = review.filter(function (r) { return r.isCorrect; }).length;
  var total = review.length;
  // Answers that arrive after the time limit (plus a short grace) do not pass.
  var late = secondsLeft(att.issuedAt, timeLimitSeconds(ids.length)) < -GRACE_SECONDS;
  var passed = !late && total > 0 && correct / total >= passPercent / 100;
  var scorePct = total ? Math.round((correct / total) * 100) : 0;
  var submittedAt = new Date();

  // Write the result into the Attempt row.
  var givenMap = {};
  review.forEach(function (r) { givenMap[r.questionId] = r.yourAnswerKey; });
  var cols = TABS.Attempts;
  var rowNum = att._row;
  sheet.getRange(rowNum, cols.indexOf('submittedAt') + 1).setValue(submittedAt);
  sheet.getRange(rowNum, cols.indexOf('answersGiven') + 1, 1, 5).setValues([[
    JSON.stringify(givenMap), correct, total, scorePct, passed ? 'PASS' : (late ? 'FAIL (late)' : 'FAIL')
  ]]);

  // Update progress. A fail means the module has to be read again.
  var prev = findProgress(name, moduleId) || {};
  var attemptNumber = (Number(prev.attempts) || 0) + 1;
  var change = {
    attempts: attemptNumber,
    bestScorePct: Math.max(Number(prev.bestScorePct) || 0, scorePct)
  };
  if (passed) change.passed = true; else change.readComplete = false;
  updateProgress(name, moduleId, change);

  // Email the admin. A mail problem must not lose the result, so errors are only logged.
  try {
    sendResultEmail(settings, name, mod, correct, total, scorePct, passed, attemptNumber, att.issuedAt, submittedAt, review);
  } catch (err) {
    console.error('Email failed: ' + err.message);
  }

  return {
    ok: true,
    correct: correct,
    total: total,
    scorePct: scorePct,
    passed: passed,
    moduleId: moduleId,
    late: late,
    attemptNumber: attemptNumber,
    review: review.map(function (r) {
      return {
        questionId: r.questionId, question: r.question, yourAnswer: r.yourAnswer,
        correctAnswer: r.correctAnswer, isCorrect: r.isCorrect, explanation: r.explanation
      };
    })
  };
}

// The questions of a module this person was asked, with the correct answers and explanations.
// Only for a module this user has passed, so the answer key stays hidden
// until then.
function reviewQuestions(name, moduleId) {
  var progress = findProgress(name, moduleId);
  if (!progress || !isTrue(progress.passed)) {
    return { ok: false, code: 'LOCKED', error: 'Pass this module\'s test to see its questions and answers.' };
  }
  // Only the questions this person was actually given, across all of
  // their submitted attempts, so the rest of the bank stays unseen.
  var asked = {};
  readRows('Attempts').forEach(function (a) {
    if (!sameName(a.name, name) || Number(a.moduleId) !== moduleId || !a.submittedAt) return;
    String(a.questionIds).split(',').forEach(function (id) { if (id) asked[id] = true; });
  });
  // Users listed in the seeAllQuestions setting (comma separated) see the whole bank.
  var seeAll = String(getSettings().seeAllQuestions || '').split(',').some(function (n) { return n.trim() && sameName(n, name); });
  var questions = questionsFor(moduleId)
    .filter(function (q) { return seeAll || asked[String(q.questionId)]; })
    .map(function (q) {
      var key = String(q.correct || '').trim().toUpperCase();
      return {
        questionId: String(q.questionId),
        question: String(q.question),
        options: ['A', 'B', 'C', 'D']
          .filter(function (k) { return String(q['option' + k]).trim() !== ''; })
          .map(function (k) { return { text: String(q['option' + k]), correct: k === key }; }),
        explanation: String(q.explanation || '')
      };
    });
  questions.sort(function (a, b) { return a.questionId.localeCompare(b.questionId, 'en', { numeric: true }); });
  return { ok: true, moduleId: moduleId, questions: questions };
}

// =============================================================
// Result email
// =============================================================

function sendResultEmail(settings, name, mod, correct, total, scorePct, passed, attemptNumber, issuedAt, submittedAt, review) {
  var to = String(settings.adminEmail || '').trim();
  if (!to) return;
  var result = passed ? 'PASS' : 'FAIL';
  var subject = 'NABH Onboarding: ' + name + ', Module ' + mod.id + ', ' + scorePct + '% ' + result;

  var seconds = issuedAt instanceof Date ? Math.round((submittedAt - issuedAt) / 1000) : null;
  var timeTaken = seconds === null ? 'unknown' : Math.floor(seconds / 60) + ' min ' + (seconds % 60) + ' sec';

  var lines = [
    'Name: ' + name,
    'Module: ' + mod.id + (mod.title ? ', ' + mod.title : ''),
    'Score: ' + correct + ' out of ' + total + ' (' + scorePct + '%)',
    'Result: ' + result,
    'Attempt number: ' + attemptNumber,
    'Time taken: ' + timeTaken,
    ''
  ];

  var wrong = review.filter(function (r) { return !r.isCorrect; });
  if (wrong.length === 0) {
    lines.push('All questions were answered correctly.');
  } else {
    lines.push('Questions answered wrongly (' + wrong.length + '):');
    wrong.forEach(function (r, i) {
      lines.push('');
      lines.push((i + 1) + '. ' + r.question);
      lines.push('   Her answer: ' + r.yourAnswer);
      lines.push('   Correct answer: ' + r.correctAnswer);
    });
  }

  MailApp.sendEmail(to, subject, lines.join('\n'));
}

// =============================================================
// Rules
// =============================================================

// Module 1 is unlocked. Any other module is unlocked when the previous
// module is passed. An unpublished module is always locked.
function isUnlocked(name, mod) {
  if (!mod || !mod.published) return false;
  if (Number(mod.id) === 1) return true;
  var prev = findProgress(name, Number(mod.id) - 1);
  return !!(prev && isTrue(prev.passed));
}

// Read content/modules.json from the website. Cached for 5 minutes.
function getModules() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('modules');
  if (cached) return JSON.parse(cached);

  var siteUrl = String(getSettings().siteUrl || '').trim();
  if (!siteUrl) throw new Error('siteUrl is missing in the Settings tab.');
  if (siteUrl.slice(-1) !== '/') siteUrl += '/';
  var res = UrlFetchApp.fetch(siteUrl + 'content/modules.json?t=' + new Date().getTime(), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('Could not read modules.json from ' + siteUrl);
  var modules = JSON.parse(res.getContentText()).modules;
  cache.put('modules', JSON.stringify(modules), 300);
  return modules;
}

function getModule(moduleId) {
  return getModules().filter(function (m) { return Number(m.id) === moduleId; })[0] || null;
}

// =============================================================
// Sessions
// =============================================================

function checkToken(token) {
  if (!token) return null;
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty('token_' + token);
  if (!raw) return null;
  var data = JSON.parse(raw);
  // End the session if it expired, the user was turned off, or the PIN changed.
  var user = readRows('Users').filter(function (u) { return sameName(u.name, data.name); })[0];
  if (data.expires < Date.now() || !user || !isTrue(user.active) || data.pinHash !== pinHash(user.pin)) {
    props.deleteProperty('token_' + token);
    return null;
  }
  return data.name;
}

// One-way fingerprint of a PIN, so the PIN itself is not kept in the session.
function pinHash(pin) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(pin).trim());
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function cleanExpiredTokens(props) {
  var all = props.getProperties();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('token_') !== 0) return;
    try {
      if (JSON.parse(all[k]).expires < Date.now()) props.deleteProperty(k);
    } catch (e) {
      props.deleteProperty(k);
    }
  });
}

// =============================================================
// Sheet helpers
// =============================================================

function getSheet(tab) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(tab);
  if (!sheet) {
    sheet = ss.insertSheet(tab);
    sheet.getRange(1, 1, 1, TABS[tab].length).setValues([TABS[tab]]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// Returns the rows of a tab as objects keyed by column name.
// Each object also has _row, its row number in the sheet.
function readRows(tab) {
  if (ROWS[tab]) return ROWS[tab];
  var cache = CACHED_TABS[tab] ? CacheService.getScriptCache() : null;
  if (cache) {
    var hit = cache.get('rows_' + tab);
    if (hit) return (ROWS[tab] = JSON.parse(hit));
  }
  var sheet = getSheet(tab);
  var values = sheet.getDataRange().getValues();
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    if (values[i].join('') === '') continue; // skip empty rows
    var obj = { _row: i + 1 };
    headers.forEach(function (h, j) { obj[h] = values[i][j]; });
    rows.push(obj);
  }
  if (cache) {
    // Dates do not survive the cache, but these tabs only hold text and numbers.
    try { cache.put('rows_' + tab, JSON.stringify(rows), SHEET_CACHE_SECONDS); } catch (e) { /* too large to cache */ }
  }
  ROWS[tab] = rows;
  return rows;
}

// The question bank of one module. Cached per module, because the whole
// bank is too large for one cache entry.
function questionsFor(moduleId) {
  var cache = CacheService.getScriptCache();
  var key = 'q_' + moduleId;
  var hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  var bank = readRows('Questions').filter(function (q) { return Number(q.moduleId) === moduleId && q.questionId; });
  try { cache.put(key, JSON.stringify(bank), SHEET_CACHE_SECONDS); } catch (e) { /* too large to cache */ }
  return bank;
}

function appendRow(tab, obj) {
  delete ROWS[tab];
  getSheet(tab).appendRow(TABS[tab].map(function (c) { return obj[c] === undefined ? '' : obj[c]; }));
}

function getSettings() {
  var s = {};
  readRows('Settings').forEach(function (r) { s[String(r.key).trim()] = r.value; });
  return s;
}

function findProgress(name, moduleId) {
  return readRows('Progress').filter(function (p) {
    return sameName(p.name, name) && Number(p.moduleId) === moduleId;
  })[0] || null;
}

// Update (or create) the Progress row for one user and module.
function updateProgress(name, moduleId, change) {
  var sheet = getSheet('Progress');
  delete ROWS.Progress;
  var cols = TABS.Progress;
  var row = findProgress(name, moduleId);
  var current = row || { name: name, moduleId: moduleId, readComplete: false, passed: false, bestScorePct: '', attempts: 0 };
  Object.keys(change).forEach(function (k) { current[k] = change[k]; });
  current.lastUpdated = new Date();
  var values = cols.map(function (c) { return current[c] === undefined ? '' : current[c]; });
  if (row) {
    sheet.getRange(row._row, 1, 1, cols.length).setValues([values]);
  } else {
    sheet.appendRow(values);
  }
  delete ROWS.Progress;
}

// =============================================================
// Small utilities
// =============================================================

function withLock(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: 'The server is busy. Please try again.' };
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function isTrue(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }

function sameName(a, b) { return String(a).trim().toLowerCase() === String(b).trim().toLowerCase(); }

function timeLimitSeconds(questionCount) {
  var per = Number(getSettings().secondsPerQuestion);
  if (!(per > 0)) per = 60;
  return Math.round(per * questionCount);
}

// Seconds left on a test issued at issuedAt; negative once time is up.
function secondsLeft(issuedAt, limit) {
  var start = new Date(issuedAt).getTime();
  if (isNaN(start)) return -Infinity;
  return Math.floor(limit - (Date.now() - start) / 1000);
}

function shuffle(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

// =============================================================
// setup(): run once from the Apps Script editor.
// Creates the tabs, the user, the settings and sample questions.
// Safe to run again: it does not add duplicates.
// =============================================================

function setup() {
  // Start from the Sheet itself, not from cached copies.
  var keys = ['modules', 'rows_Users', 'rows_Settings'];
  for (var m = 1; m <= 50; m++) keys.push('q_' + m);
  CacheService.getScriptCache().removeAll(keys);
  Object.keys(TABS).forEach(getSheet);

  // PINs must be stored as text, otherwise 0000 becomes 0.
  getSheet('Users').getRange('B:B').setNumberFormat('@');

  if (readRows('Users').length === 0) {
    // The leading apostrophe keeps 0000 as text instead of the number 0.
    appendRow('Users', { name: 'Anushka', pin: "'0000", active: true });
  }

  var existingKeys = readRows('Settings').map(function (r) { return String(r.key); });
  DEFAULT_SETTINGS.forEach(function (kv) {
    if (existingKeys.indexOf(kv[0]) === -1) appendRow('Settings', { key: kv[0], value: kv[1] });
  });

  var existingIds = readRows('Questions').map(function (q) { return String(q.questionId); });
  SAMPLE_QUESTIONS.forEach(function (q) {
    if (existingIds.indexOf(q[1]) !== -1) return;
    appendRow('Questions', {
      moduleId: q[0], questionId: q[1], question: q[2],
      optionA: q[3], optionB: q[4], optionC: q[5], optionD: q[6],
      correct: q[7], explanation: q[8]
    });
  });

  // Remove the empty default "Sheet1" if it is still there.
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);

  // Touch the services once so their permissions are requested now.
  MailApp.getRemainingDailyQuota();
  try {
    getModules();
    console.log('Setup done. modules.json was read from the website.');
  } catch (err) {
    // Fine if GitHub Pages is not switched on yet. Check siteUrl in Settings later.
    console.log('Setup done, but modules.json could not be read yet: ' + err.message);
  }
}

// Sample questions: 3 per module. Add the real question bank in the Questions tab.
// moduleId, questionId, question, optionA, optionB, optionC, optionD, correct, explanation
var SAMPLE_QUESTIONS = [
  [1, 'M1-Q01', 'What is the difference between OPD and IPD?', 'OPD patients go home the same day, IPD patients are admitted', 'OPD is for emergencies, IPD is for surgery', 'OPD is for children, IPD is for adults', 'There is no difference', 'A', 'OPD is the Outpatient Department (visit and go home). IPD is the Inpatient Department (admitted patients).'],
  [1, 'M1-Q02', 'Which doctor is present in the hospital round the clock and attends first when a ward calls?', 'Visiting consultant', 'Pathologist', 'RMO (Resident Medical Officer)', 'Radiologist', 'C', 'The RMO is present round the clock and is the first doctor to attend a ward or emergency call.'],
  [1, 'M1-Q03', 'Which department cleans and sterilises surgical instruments?', 'MRD', 'CSSD', 'Radiology', 'Pharmacy', 'B', 'CSSD is the Central Sterile Supply Department.'],
  [2, 'M2-Q01', 'A patient visits a hospital three times in a year and is admitted once. How many UHIDs should the patient have?', 'One', 'Two', 'Three', 'Four', 'A', 'The UHID is given at the first registration and never changes. One patient, one UHID.'],
  [2, 'M2-Q02', 'Which document does the TPA read first?', 'Vitals chart', 'Nursing notes', 'Discharge summary', 'Registration form', 'C', 'The TPA reads the discharge summary first. Its diagnosis, dates and procedure must match the bill and the case sheet.'],
  [2, 'M2-Q03', 'What is a medico-legal case (MLC)?', "A case handled by the hospital's lawyer", 'A case where the injury or illness may have a legal side, such as an accident or assault', 'A minor laparoscopic case', 'A case referred from another hospital', 'B', 'MLCs include road accidents, assault, burns and poisoning. The doctor records them in the MLC register and informs the police.'],
  [3, 'M3-Q01', 'Which diagnosis is written in the discharge summary?', 'The provisional diagnosis', "The patient's own complaint", 'The final diagnosis', 'The diagnosis from the previous visit', 'C', 'The final diagnosis is the confirmed condition. It goes into the discharge summary and is used by the insurer.'],
  [3, 'M3-Q02', 'What does the ending -ectomy mean?', 'Inflammation', 'Removal by surgery', 'Looking inside with a camera', 'Repair or reshaping', 'B', '-ectomy means removal by surgery, as in appendectomy.'],
  [3, 'M3-Q03', "What does K/C/O DM mean in a doctor's note?", 'Known case of diabetes mellitus', 'Complaints of dizziness', 'Kidney condition observed', 'Known cause of death', 'A', 'K/C/O means known case of, so the patient was already diagnosed with diabetes mellitus earlier.'],
  [4, 'M4-Q01', 'What does TDS mean in a prescription?', 'Once a day', 'Twice a day', 'Three times a day', 'At bedtime', 'C', 'TDS (or TID) means three times a day.'],
  [4, 'M4-Q02', 'Which route puts the medicine into the blood fastest?', 'Intramuscular (IM)', 'Intravenous (IV)', 'Subcutaneous (SC)', 'Oral (PO)', 'B', 'IV goes directly into a vein, so the medicine is in the blood at once.'],
  [4, 'M4-Q03', 'Why are LASA medicines stored apart from each other?', 'They must be kept in a fridge', 'They are narcotic drugs', 'Their names or packs look or sound alike and can be confused', 'They expire quickly', 'C', 'LASA means Look Alike Sound Alike. Storing them apart and labelling them prevents mix-ups.'],
  [5, 'M5-Q01', "When is the 'time out' of the surgical safety checklist done?", 'Before anaesthesia', 'Before the first cut', 'Before the patient leaves the OT', 'At discharge', 'B', 'Sign in is before anaesthesia, time out is before the first cut, and sign out is before the patient leaves the OT.'],
  [5, 'M5-Q02', 'A patient is awake during a caesarean section. Which anaesthesia was most likely used?', 'General anaesthesia', 'Local anaesthesia', 'Spinal anaesthesia', 'Sedation', 'C', 'Spinal anaesthesia numbs the body below the waist while the patient stays awake.'],
  [5, 'M5-Q03', 'What is the difference between disinfection and sterilisation?', 'They are the same', 'Sterilisation kills all germs including spores, disinfection kills most germs', 'Disinfection kills all germs, sterilisation kills most', 'Sterilisation only removes visible dirt', 'B', 'Disinfection kills most germs. Sterilisation, for example by autoclave, kills all germs including spores.']
];
