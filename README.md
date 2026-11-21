# Learning Desk

A small training site. The first program is **NABH Onboarding**. The site name and program name are set in `content/modules.json` (`siteTitle` and `programTitle`). Anushka reads each module one section at a time, then takes a test. The next module opens only after she passes. Her progress is saved in a Google Sheet, and the admin gets an email with her marks after every test.

- **Website:** the files in this repository, served free by GitHub Pages.
- **Backend:** a Google Sheet with an Apps Script (`apps-script/Code.gs`). It keeps users, progress, test attempts and the question bank, and sends the result emails.
- **Content:** one markdown file per module in `content/`.

---

## 1. Switch on GitHub Pages

1. Open the repository on GitHub: https://github.com/suryanshhhh1/learning-desk
2. Click **Settings**, then **Pages** in the left menu.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
4. Set **Branch** to **main** and the folder to **/ (root)**. Click **Save**.
5. Wait one or two minutes and refresh. The site link appears at the top of the page:
   **https://suryanshhhh1.github.io/learning-desk/**

Until step 3 below is done the site runs in test mode (`MOCK = true`), where everything is stored only in your browser.

## 2. Create the Google Sheet and backend

1. Go to https://sheets.google.com and create a blank spreadsheet. Name it, for example, `NABH Onboarding`.
2. In the sheet, open **Extensions > Apps Script**.
3. Delete the sample code in `Code.gs`, then paste the whole content of `apps-script/Code.gs` from this repository. Click the save icon.
4. In the function menu at the top, choose **setup** and click **Run**.
5. Google asks for permissions. Click **Review permissions**, choose your account, then **Advanced > Go to (project name) (unsafe)** and **Allow**. This warning is normal for your own scripts. The script needs to edit this sheet, send email as you and read `modules.json` from the website.
6. Go back to the sheet. You now have the tabs **Users, Progress, Attempts, Questions, Settings**, with Anushka (PIN `0000`), the default settings and 3 sample questions for each of modules 1 to 5.

## 3. Deploy the backend and connect the site

1. In Apps Script, click **Deploy > New deployment**.
2. Click the gear icon next to **Select type** and choose **Web app**.
3. Set **Execute as: Me** and **Who has access: Anyone**. Click **Deploy**.
4. Copy the **Web app URL**. It ends in `/exec`.
5. In this repository open `js/config.js` (on GitHub, click the file, then the pencil icon to edit).
6. Paste the URL in place of `PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE`, and change `MOCK: true` to `MOCK: false`. Commit the change.
7. After a minute or two, open the site and log in as Anushka with PIN `0000`.

**If you change `Code.gs` later**, paste the new code, then use **Deploy > Manage deployments**, click the pencil icon, choose **Version: New version** and **Deploy**. This keeps the same URL. Using "New deployment" gives a new URL, which you would have to paste into `config.js` again.

## 4. Change her PIN, the pass mark or the admin email

Everything is in the Google Sheet, so no code changes are needed.

- **PIN:** in the **Users** tab, change the value in the `pin` column. Change `0000` before she starts.
- **Pass mark:** in the **Settings** tab, change `passPercent` (default 85).
- **Admin email:** in the **Settings** tab, change `adminEmail`.
- **Wait time per screen:** each screen waits 1 second for every 4 words on it. `minSecondsPerSection` in the **Settings** tab (default 20) is the shortest wait for any screen. The 4 words per second is `WORDS_PER_SECOND` in `js/config.js`.
- **Turn off a user:** set `active` to `FALSE` in the **Users** tab.

Leave `siteUrl` in Settings as it is. The backend uses it to read `content/modules.json`.

## 5. Add or edit a module

1. **Text:** edit `content/module-NN.md` on GitHub (pencil icon) and commit. For a new module, create the file, for example `content/module-06.md`.
   - The first line is `# Module 6: What NABH Is`.
   - Text before the first `### ` heading is the introduction (screen 1).
   - Each `### ` heading starts a new screen.
   - A section titled `### Check yourself` is not shown, because the test replaces it.
   - Tables in normal markdown format are supported.
2. **Publish:** in `content/modules.json`, find the module, set `"file": "module-06.md"` and `"published": true`. `questionsPerTest` sets how many questions each test has.
3. **Questions:** in the **Questions** tab, add one row per question:
   - `moduleId`: the module number, e.g. `6`
   - `questionId`: any unique code, e.g. `M6-Q01`
   - `question`, `optionA` to `optionD`: the question and the four answers
   - `correct`: the letter of the right answer, `A`, `B`, `C` or `D`
   - `explanation`: shown to her after she submits

Each test picks `questionsPerTest` questions at random from the bank. If the bank has fewer, all of them are used. Options are shuffled every time. Changes on GitHub take a minute or two to show on the site, and the backend reads `modules.json` again every 5 minutes.

## 6. Reset her progress for a module

In the **Progress** tab, find the row with her name and the module number:

- **Make her read and test again:** set `readComplete` and `passed` to `FALSE`.
- **Start the module from scratch:** delete the row.

Later modules unlock based on `passed` of the module before them, so if you reset module 3, modules 4 onward lock again until she passes module 3. The **Attempts** tab keeps the full history of every test and is not affected.

---

## Testing without Google (mock mode)

With `MOCK: true` in `js/config.js`, or whenever the site is opened from `localhost`, it uses a fake backend in the browser (`js/mock.js`) with sample questions. Log in as `Anushka` or `Tester` with PIN `0000` (test data only; real PINs live only in the Sheet). Result emails are printed to the browser console instead of being sent.

To try it on your own computer, run this in the repository folder and open http://localhost:8000:

```bash
python3 -m http.server 8000
```

To clear the mock data, run `localStorage.clear()` in the browser console.

## Files

| File | What it is |
| --- | --- |
| `index.html` | Login and dashboard |
| `module.html` | Reading view, one section per screen |
| `test.html` | Test and result |
| `css/style.css` | All styling |
| `js/config.js` | API URL and mock switch |
| `js/api.js` | All calls to the backend |
| `js/app.js` | Shared logic: module status, splitting markdown into screens |
| `js/mock.js` | Fake backend for testing |
| `lib/marked.min.js` | Markdown renderer (stored here, no CDN) |
| `content/modules.json` | List of all 14 modules |
| `content/module-01.md` ... | Module text |
| `apps-script/Code.gs` | Backend, pasted into Apps Script |
