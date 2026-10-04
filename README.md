# College Problem Reporting System

Students report campus problems and track them with a complaint ID. Admins review, update status, add remarks and delete complaints.

## Run (no npm install needed)
1. Install Node.js 16 or newer
2. In this folder run: `node server.js` (or `npm start`)
3. Student page: http://localhost:3000
4. Admin page: http://localhost:3000/admin.html

## Admin password
Default is `admin123`. Change it before real use:
- Windows (PowerShell): `$env:ADMIN_PASSWORD="mysecret"; node server.js`
- Mac/Linux: `ADMIN_PASSWORD=mysecret node server.js`

## Files
- server.js          Backend and API (built-in Node modules only)
- problems.json      Data storage
- public/index.html  Student: report and track
- public/admin.html  Admin dashboard
- public/style.css   Shared styles (light and dark mode)

## Run on an Android phone (Termux)
1. Install Termux from F-Droid, then: `pkg install nodejs unzip`
2. `termux-setup-storage`, then `cd ~/storage/downloads`, unzip this project, `cd college-problem-system`
3. `node server.js` and open http://localhost:3000 in Chrome
4. Other phones on the same Wi-Fi use the "On your Wi-Fi/network" address printed by the server

## Notes
- Complaint IDs never repeat, even after deletions.
- Students track a complaint with the ID plus their roll number, so other people cannot read it by guessing IDs.
- After 8 wrong admin passwords from one device, admin login is blocked for 10 minutes.
- If problems.json is ever damaged, the server saves a copy as problems.json.damaged-... instead of erasing it.
- Hosting online behind a proxy: set TRUST_PROXY=1 and use a host with permanent disk storage (or set DATA_FILE to the disk path).
- To use on a college network, share your computer's IP, e.g. http://192.168.x.x:3000

## Install as an app (PWA)
The site is installable. Open it in Chrome on your phone (it needs HTTPS when hosted online; `localhost` also works):
1. Tap the menu (three dots) and choose "Install app" or "Add to Home screen"
2. It now opens full-screen from your home screen like a normal app, with its own icon
3. iPhone: Safari, Share button, "Add to Home Screen"
For other phones to install it, host the project online (Render/Railway) so it has an https:// address.
