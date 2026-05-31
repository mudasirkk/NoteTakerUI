# NoteTaker

> Keyboard-first, always-on-top note-taking overlay for lectures and video classes.

NoteTaker is a small desktop app that floats above your video so you can take
structured notes without ever leaving the keyboard. Every note is **stamped to the
moment you wrote it** — click a timestamp later to jump the video right back there.
Review your notes as a nested **outline** or as a **mind-map**, and (optionally) sign
in with Google to keep the same library in sync across every device.

[![CI](https://github.com/mudasirkk/NoteTakerUI/actions/workflows/ci.yml/badge.svg)](https://github.com/mudasirkk/NoteTakerUI/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-24C8DB.svg)](https://tauri.app)

---

## Features

- **Outline capture, keyboard-first** — type to take notes; `Enter` starts a sibling,
  `Tab` indents. Shape the structure as you listen, hands never leaving the keys.
- **Timestamped notes & click-to-seek** — notes are stamped to the playback moment.
  Click a stamp to seek the video back to exactly where that idea came up.
- **Mind-map view** — press `Ctrl+M` for a force-laid-out map of your notes, and drag
  between nodes to draw cross-links between related ideas.
- **Multiple sources** — a YouTube link, a local video file, or just a plain session
  timer when there's no video at all.
- **Transcript import** — drop in an `.srt` / `.vtt`, browse it in a live drawer, and
  click any cue to seek or pull it into your notes.
- **Cross-device sync (optional)** — sign in with Google and your maps live in your
  account, available on every device you sign in on.
- **Local YouTube playback (optional, advanced)** — when a video refuses to embed,
  NoteTaker can download it and play it as a local file so click-to-seek still works.
- **Always-on-top & pinnable**, **undo / redo**, a **maps library**, **dark / light /
  system themes**, and a global show/hide hotkey (`Ctrl+Alt+N`).
- **Offline-first** — everything is saved locally first; sync (when enabled) flushes
  in the background and reconciles on reconnect.

---

## Run it

### Option 1 — Download a prebuilt installer (easiest)

Grab the installer for your OS from the [**Releases**](https://github.com/mudasirkk/NoteTakerUI/releases)
page and run it. (Releases are produced automatically from version tags — see
[Releasing](#releasing-for-maintainers) — so this option lights up once the first
tag is pushed.)

### Option 2 — Build from source

**Prerequisites**

- [Node.js](https://nodejs.org) 18+ and npm
- [Rust](https://rustup.rs) (stable toolchain)
- Tauri 2 system dependencies for your OS — see the
  [Tauri prerequisites guide](https://tauri.app/start/prerequisites/)

```bash
git clone https://github.com/mudasirkk/NoteTakerUI.git
cd NoteTakerUI
npm install

# Desktop app (Tauri):
npm run tauri dev      # run in development
npm run tauri build    # produce an installer in src-tauri/target/release/bundle/

# Or run the plain web build in a browser (no desktop features):
npm run dev
```

---

## Configuration

**NoteTaker runs 100% locally with zero setup** — notes are saved on your device and
nothing leaves it. Google sign-in and cloud sync are entirely optional and switched
on with environment variables. Copy the template to get started:

```bash
cp .env.example .env.local
```

> `.env.local` is git-ignored and never committed.

### Cloud sync + Google sign-in (optional)

1. Create a project in the [Firebase console](https://console.firebase.google.com).
2. Under **Authentication → Sign-in method**, enable **Google**.
3. Create a **Cloud Firestore** database.
4. Deploy the owner-only security rules shipped in this repo:
   ```bash
   firebase deploy --only firestore:rules
   ```
5. Copy your Firebase **web** config into `.env.local`:
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_APP_ID`

   These are web-config values, **not secrets** — they are meant to ship to the
   client. Access to your notes is controlled by `firestore.rules`, not by hiding
   these keys.

### Desktop (Tauri) Google sign-in

The browser build uses Google's popup flow. The desktop app can't use popups, so it
runs a system-browser **loopback OAuth** flow that needs a Google **Desktop app**
OAuth client (Google Cloud Console → APIs & Services → Credentials). Add to
`.env.local`:

- `VITE_GOOGLE_DESKTOP_CLIENT_ID`
- `VITE_GOOGLE_DESKTOP_CLIENT_SECRET`

### Local YouTube playback (optional, advanced)

When a video can't be embedded, NoteTaker can download it with
[`yt-dlp`](https://github.com/yt-dlp/yt-dlp) and play it locally so click-to-seek
keeps working. It is configured with:

- `NOTETAKER_YTDLP` — path to the `yt-dlp` binary (otherwise it's looked up on `PATH`)
- `NOTETAKER_YTDLP_SHA256` — pin the binary's SHA-256 checksum; a mismatch aborts the
  download (a supply-chain safeguard)

Downloads are confined to a capped, evictable on-disk cache keyed by video id. Only
the **URL** is ever stored in a map — video files are never uploaded to your account.

> ⚠️ **Note:** downloading content from YouTube may violate YouTube's Terms of
> Service. This feature is intended for content you own or have the right to
> download, and you are responsible for how you use it. It is off unless you
> configure `yt-dlp` as above.

---

## Keyboard shortcuts

| Combo | Action |
| --- | --- |
| `Enter` | New sibling below |
| `Tab` / `⇧Tab` | Indent / outdent |
| `⇧Enter` | Soft line break |
| `⌫` | Delete empty node |
| `Ctrl+⇧⌫` | Delete note & children |
| `Ctrl+T` | Insert / refresh timestamp |
| `Ctrl+Z` / `Ctrl+⇧Z` | Undo / redo |
| `Ctrl+↑` / `Ctrl+↓` | Move among siblings |
| `↑` / `↓` | Move focus between notes |
| `Ctrl+P` | Jump palette |
| `Ctrl+K` | Command palette |
| `Ctrl+O` | Switch maps |
| `Ctrl+]` / `Ctrl+[` | Zoom into note / out |
| `Ctrl+.` / `Ctrl+,` | Collapse / expand subtree |
| `Ctrl+Space` | Play / pause *(with a seekable video)* |
| `Ctrl+←` / `Ctrl+→` | Rewind / forward |
| `Ctrl+⇧<` / `Ctrl+⇧>` | Slower / faster |
| `Ctrl+M` | Toggle Outline / Map |
| `Ctrl+S` | Save |
| `?` | Keyboard shortcuts overlay |
| `Ctrl+Alt+N` | Show / hide window (global) |

Press `?` in the app for the live, always-current list.

---

## How your data is stored

- **Local-only mode** — each map is a JSON file in the app's per-user data directory,
  with an index sidecar. Nothing is sent anywhere.
- **Signed in** — maps live in Firestore under `users/<your-uid>/maps/<id>`, guarded by
  `firestore.rules` so only you can read or write them. The first time you sign in,
  any existing local maps are migrated into your account. Edits made offline are
  queued and reconciled on reconnect; conflicting edits fork to a kept-both copy
  rather than silently overwriting.

---

## Tech stack

[Tauri 2](https://tauri.app) (Rust shell) · [React 18](https://react.dev) · TypeScript ·
[Zustand](https://github.com/pmndrs/zustand) · [Vite](https://vitejs.dev) ·
[Firebase](https://firebase.google.com) (Auth + Firestore) ·
[React Flow](https://reactflow.dev) for the map.

```
src/            React app (outline, map, auth, state, keyboard)
src-tauri/      Rust shell — window, OAuth loopback, file I/O, yt-dlp download
firestore.rules Owner-only Firestore security rules
.env.example    Configuration template
```

---

## Releasing (for maintainers)

Pushing a version tag triggers the [release workflow](.github/workflows/release.yml),
which builds installers for Windows, macOS (Intel + Apple Silicon) and Linux and
attaches them to a **draft** GitHub Release for you to review and publish:

```bash
git tag v0.1.0
git push origin v0.1.0
```

To bake Firebase + Google sign-in into the released binaries, add the `VITE_*` values
from your `.env.local` as repository **Secrets** (Settings → Secrets and variables →
Actions). Without them, the released installers run in local-only mode.

---

## License

[MIT](LICENSE) © Mudasir Khan
