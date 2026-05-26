# Free Upload Manager

A fast, minimal and reliable file hosting frontend that uploads directly to [BuzzHeavier](https://buzzheavier.com)'s API — no file size limits.

## Features

* Upload any number of files, any size — no limits
* Optional note per upload, shown on the download page
* it [fucking works](motherfuckingwebsite.com)
* Cancel in-progress uploads
* Copy all download links at once
* Account system (ID-based, no email/password) — upload history saved locally
* Light/dark mode (follows system preference)
* 100% static — works on GitHub Pages

## Deploy to GitHub Pages

1. Create a new GitHub repository
2. Upload all files from this folder into the repository root
3. Go to **Settings → Pages**
4. Set source to **Deploy from a branch → main → / (root)**
5. Save — your site will be live at `https://<your-username>.github.io/<repo-name>/`

## How it works

Files are uploaded via `PUT https://w.buzzheavier.com/<filename>` directly from the browser.
Upload history is stored in `localStorage` — no backend needed.

## Project structure

```
index.html          — Main upload page
help/index.html     — Help / FAQ
auth/index.html     — Login / Signup
account/index.html  — Upload history
download/index.html — Download page
404.html            — 404 page
css/style.css       — Tailwind + theme variables
images/logo.png     — Logo
```

