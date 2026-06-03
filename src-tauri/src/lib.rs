// Grant the asset protocol read access to a single user-picked video file.
// The static asset scope is empty, so the webview can only ever read files the
// user explicitly opened — nothing else on disk is reachable via asset://.
#[tauri::command]
fn allow_video_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    use tauri::Manager;
    app.asset_protocol_scope()
        .allow_file(&path)
        .map_err(|e| e.to_string())
}

// ---------- YouTube download → local cache (DC-3) ----------
// The note map only ever stores the YouTube URL (DC-3c). The downloaded file is a
// device-local, size-capped, evictable cache keyed by the 11-char video id; it is
// never synced, and each device re-downloads on demand. Security (DC-3b): we never
// build a shell string from the URL — the downloader is spawned with an argv array
// and the URL is passed after `--`, so it can't be read as a flag or interpreted by
// a shell; the URL is validated to be a real YouTube link first (so this command
// can't be turned into a generic file-fetch / SSRF primitive); and the downloader
// binary is checksum-verified against a pin before we ever execute it.

const YT_CACHE_CAP_BYTES: u64 = 4 * 1024 * 1024 * 1024; // 4 GiB on-disk cap

fn yt_is_video_id(s: &str) -> bool {
    s.len() == 11 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

// Extract the canonical 11-char video id from a YouTube URL (or a bare id). Returns
// None for any non-YouTube host, which is how the command refuses to fetch anything
// that isn't a YouTube video (DC-3b: validate it's a YouTube URL).
fn parse_youtube_id(input: &str) -> Option<String> {
    let s = input.trim();
    if yt_is_video_id(s) {
        return Some(s.to_string());
    }
    let rest = s
        .strip_prefix("https://")
        .or_else(|| s.strip_prefix("http://"))?;
    let (authority, after) = match rest.find('/') {
        Some(i) => (&rest[..i], &rest[i + 1..]),
        None => (rest, ""),
    };
    // Drop any userinfo and port, then lower-case the host.
    let host = authority
        .rsplit('@')
        .next()
        .unwrap_or(authority)
        .split(':')
        .next()
        .unwrap_or(authority)
        .to_ascii_lowercase();
    let (path, query) = match after.find('?') {
        Some(i) => (&after[..i], &after[i + 1..]),
        None => (after, ""),
    };
    if host == "youtu.be" {
        let id = path.split('/').next().unwrap_or("");
        return yt_is_video_id(id).then(|| id.to_string());
    }
    let host_ok = matches!(
        host.as_str(),
        "youtube.com"
            | "www.youtube.com"
            | "m.youtube.com"
            | "youtube-nocookie.com"
            | "www.youtube-nocookie.com"
    );
    if !host_ok {
        return None;
    }
    // watch?v=<id>
    let params = parse_query(query);
    if let Some(v) = params.get("v") {
        if yt_is_video_id(v) {
            return Some(v.clone());
        }
    }
    // /embed/<id>, /shorts/<id>, /v/<id>
    let segs: Vec<&str> = path.split('/').filter(|p| !p.is_empty()).collect();
    for (i, seg) in segs.iter().enumerate() {
        if matches!(*seg, "embed" | "shorts" | "v") {
            if let Some(id) = segs.get(i + 1) {
                if yt_is_video_id(id) {
                    return Some((*id).to_string());
                }
            }
        }
    }
    None
}

fn yt_cache_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    Ok(app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("yt-cache"))
}

// First non-empty file in the cache whose stem is exactly the video id, if any.
// The container extension is whatever the downloader chose; the id is the key.
fn yt_find_cached(dir: &std::path::Path, id: &str) -> Option<std::path::PathBuf> {
    let rd = std::fs::read_dir(dir).ok()?;
    for entry in rd.flatten() {
        let path = entry.path();
        if path.file_stem().and_then(|s| s.to_str()) == Some(id) {
            if let Ok(meta) = entry.metadata() {
                if meta.is_file() && meta.len() > 0 {
                    return Some(path);
                }
            }
        }
    }
    None
}

fn hex_sha256(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(bytes);
    let mut out = String::with_capacity(digest.len() * 2);
    for b in digest {
        use std::fmt::Write as _;
        let _ = write!(out, "{:02x}", b);
    }
    out
}

// Locate the downloader binary: an explicit override (NOTETAKER_YTDLP), else a PATH
// search. We deliberately do NOT auto-update or fetch it — the operator installs and
// pins it (DC-3b: pin the binary).
fn resolve_ytdlp() -> Option<std::path::PathBuf> {
    if let Ok(p) = std::env::var("NOTETAKER_YTDLP") {
        let pb = std::path::PathBuf::from(p);
        if pb.is_file() {
            return Some(pb);
        }
    }
    let candidates: &[&str] = if cfg!(windows) {
        &["yt-dlp.exe", "yt-dlp"]
    } else {
        &["yt-dlp"]
    };
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        for name in candidates {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

// Checksum-verify the downloader before running it (DC-3b supply-chain guard). When
// a pin is configured (NOTETAKER_YTDLP_SHA256) a mismatch is fatal; when none is set
// we proceed but log a clear warning, since this is a personal build the operator
// controls — set the pin to harden a distributed build.
fn verify_ytdlp(path: &std::path::Path) -> Result<(), String> {
    let pin = std::env::var("NOTETAKER_YTDLP_SHA256")
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    if pin.is_empty() {
        log::warn!(
            "yt-dlp is not pinned (set NOTETAKER_YTDLP_SHA256 to enforce a checksum); running unverified binary at {path:?}"
        );
        return Ok(());
    }
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    let actual = hex_sha256(&bytes);
    if actual != pin {
        return Err(format!(
            "downloader checksum mismatch (expected {pin}, got {actual}) — refusing to run"
        ));
    }
    Ok(())
}

// ---------- ffmpeg: optional, unlocks >720p merged downloads ----------
// YouTube only serves ≤720p as a single pre-muxed file; 1080p comes as separate
// video + audio streams that must be merged, which yt-dlp does with ffmpeg. ffmpeg
// is therefore optional: without it we fetch the best progressive ≤720p copy; with
// it we fetch up to 1080p and merge to mp4. We never bundle it or install it
// silently — the UI tells the user it's needed and we fetch it only when they
// explicitly accept (the download_ffmpeg command below).

// The latest "essentials" Windows build. gyan.dev is the build host recommended by
// ffmpeg.org; the URL always points at the current release and is fetched over TLS.
#[cfg(windows)]
const FFMPEG_WIN_URL: &str = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";

// Where our downloaded ffmpeg lives: app-data/bin (persistent — unlike the yt cache,
// we don't want it evicted). ffmpeg.exe and ffprobe.exe sit side by side here.
fn ffmpeg_bin_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app_data(app)?.join("bin"))
}

// Locate ffmpeg: an explicit override (NOTETAKER_FFMPEG), then our own downloaded
// copy under app-data/bin, then a PATH search. Returns the binary path; its parent
// dir is what we hand yt-dlp via --ffmpeg-location (so it finds ffprobe too).
fn resolve_ffmpeg(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    if let Ok(p) = std::env::var("NOTETAKER_FFMPEG") {
        let pb = std::path::PathBuf::from(p);
        if pb.is_file() {
            return Some(pb);
        }
    }
    let exe = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
    if let Ok(dir) = ffmpeg_bin_dir(app) {
        let candidate = dir.join(exe);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(exe);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

// Whether ffmpeg is available right now. The UI calls this before a download to
// decide whether to offer the (consent-gated) install or go straight to HD.
#[tauri::command]
fn ffmpeg_available(app: tauri::AppHandle) -> bool {
    resolve_ffmpeg(&app).is_some()
}

// Download ffmpeg into app-data/bin on the user's explicit acceptance. Idempotent:
// if ffmpeg is already resolvable (downloaded before, on PATH, or pinned via env)
// it's a no-op. Windows only for now — elsewhere we point the user at their package
// manager rather than guess a binary distribution.
fn run_download_ffmpeg(app: tauri::AppHandle) -> Result<(), String> {
    if resolve_ffmpeg(&app).is_some() {
        return Ok(());
    }

    #[cfg(not(windows))]
    {
        let _ = &app;
        return Err("Automatic ffmpeg install is only supported on Windows here. Please \
            install ffmpeg with your package manager (e.g. `brew install ffmpeg` or \
            `sudo apt install ffmpeg`) and restart NoteTaker."
            .to_string());
    }

    #[cfg(windows)]
    {
        let dir = ffmpeg_bin_dir(&app)?;
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

        // ureq's native-tls backend isn't auto-wired by the feature flag — the bare
        // helpers ship no TLS connector. Build it explicitly (see run_google_oauth).
        let tls = native_tls::TlsConnector::new().map_err(|e| e.to_string())?;
        let agent = ureq::AgentBuilder::new()
            .tls_connector(std::sync::Arc::new(tls))
            .build();

        // Pull the (~40 MB) zip fully into memory. into_reader() is unbounded, unlike
        // into_string()'s ~10 MB cap, so it's the right call for a binary payload.
        use std::io::Read as _;
        let resp = agent
            .get(FFMPEG_WIN_URL)
            .call()
            .map_err(|e| format!("couldn't download ffmpeg: {e}"))?;
        let mut bytes: Vec<u8> = Vec::new();
        resp.into_reader()
            .read_to_end(&mut bytes)
            .map_err(|e| format!("couldn't read the ffmpeg download: {e}"))?;

        // Best-effort supply-chain guard, mirroring verify_ytdlp: gyan publishes a
        // .sha256 sidecar. When we can fetch and parse it a mismatch is fatal; if it's
        // unavailable we still proceed (the bytes came over TLS from the pinned host)
        // but log it, so a sidecar format change can't break the install outright.
        match agent.get(&format!("{FFMPEG_WIN_URL}.sha256")).call() {
            Ok(sum_resp) => {
                let sum_text = sum_resp.into_string().unwrap_or_default();
                let expected = sum_text
                    .split_whitespace()
                    .next()
                    .unwrap_or("")
                    .to_ascii_lowercase();
                if expected.len() == 64 {
                    let actual = hex_sha256(&bytes);
                    if actual != expected {
                        return Err(format!(
                            "ffmpeg checksum mismatch (expected {expected}, got {actual}) — refusing to install"
                        ));
                    }
                } else {
                    log::warn!("ffmpeg checksum sidecar was unparseable; proceeding unverified");
                }
            }
            Err(e) => log::warn!("couldn't fetch ffmpeg checksum sidecar ({e}); proceeding unverified"),
        }

        // Extract only ffmpeg.exe / ffprobe.exe. We write to fixed names we control in
        // our own dir (never the archive-supplied path), so a crafted entry name can't
        // escape via path traversal (zip-slip).
        let reader = std::io::Cursor::new(bytes);
        let mut archive =
            zip::ZipArchive::new(reader).map_err(|e| format!("ffmpeg archive unreadable: {e}"))?;
        let mut got_ffmpeg = false;
        for i in 0..archive.len() {
            let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
            if !entry.is_file() {
                continue;
            }
            let base = entry
                .name()
                .rsplit(['/', '\\'])
                .next()
                .unwrap_or("")
                .to_ascii_lowercase();
            let dest = match base.as_str() {
                "ffmpeg.exe" => dir.join("ffmpeg.exe"),
                "ffprobe.exe" => dir.join("ffprobe.exe"),
                _ => continue,
            };
            let tmp = dest.with_extension("part");
            let mut out = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
            drop(out);
            std::fs::rename(&tmp, &dest).map_err(|e| e.to_string())?;
            if base == "ffmpeg.exe" {
                got_ffmpeg = true;
            }
        }
        if !got_ffmpeg {
            return Err("ffmpeg.exe was not found inside the downloaded archive".to_string());
        }
        Ok(())
    }
}

// Off the async runtime: the fetch + unzip is blocking and can take a while.
#[tauri::command]
async fn download_ffmpeg(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || run_download_ffmpeg(app))
        .await
        .map_err(|e| e.to_string())?
}

// ---------- YouTube cookies (optional, for signed-in / higher-quality formats) ----------
// YouTube now gates most >720p formats behind sign-in + PO tokens (the SABR
// experiment), so a logged-out yt-dlp often only sees 360p. Handing it a cookies.txt
// the user exported from their signed-in browser lets it fetch what that account can
// see. We keep a copy in app-data and pass it via --cookies. The file holds the
// user's auth cookies, so we never log its contents; the picker is opened here in
// Rust (SEC-3) — the webview supplies no path.

fn yt_cookies_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app_data(app)?.join("yt-cookies.txt"))
}

// Locate the cookies file: an explicit override (NOTETAKER_YT_COOKIES), else the copy
// the user imported. None when cookies haven't been configured.
fn resolve_cookies(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    if let Ok(p) = std::env::var("NOTETAKER_YT_COOKIES") {
        let pb = std::path::PathBuf::from(p);
        if pb.is_file() {
            return Some(pb);
        }
    }
    let p = yt_cookies_path(app).ok()?;
    p.is_file().then_some(p)
}

// Whether a cookies file is configured (the UI reflects this).
#[tauri::command]
fn youtube_cookies_status(app: tauri::AppHandle) -> bool {
    resolve_cookies(&app).is_some()
}

// Forget the imported cookies file.
#[tauri::command]
fn clear_youtube_cookies(app: tauri::AppHandle) -> Result<(), String> {
    let path = yt_cookies_path(&app)?;
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// Let the user pick a cookies.txt; copy it into app-data for yt-dlp to use. Returns
// false if they cancel. async so the blocking native dialog runs off the main thread
// (mirrors export_text_file).
#[tauri::command]
async fn set_youtube_cookies(app: tauri::AppHandle) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;
    let picked = app
        .dialog()
        .file()
        .add_filter("Cookies file (cookies.txt)", &["txt"])
        .blocking_pick_file();
    let Some(file_path) = picked else {
        return Ok(false); // cancelled
    };
    let src = file_path.into_path().map_err(|e| e.to_string())?;
    let dest = yt_cookies_path(&app)?;
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::copy(&src, &dest).map_err(|e| e.to_string())?;
    Ok(true)
}

// Evict least-recently-downloaded files until the cache fits the cap (DC-3c). Never
// removes `keep` (the file we just produced). Best-effort: any error is ignored so
// eviction can't fail an otherwise-successful download.
fn yt_evict(dir: &std::path::Path, keep: &std::path::Path) {
    let mut files: Vec<(std::path::PathBuf, u64, std::time::SystemTime)> = Vec::new();
    let mut total: u64 = 0;
    if let Ok(rd) = std::fs::read_dir(dir) {
        for entry in rd.flatten() {
            if let Ok(meta) = entry.metadata() {
                if meta.is_file() {
                    let mtime = meta.modified().unwrap_or(std::time::UNIX_EPOCH);
                    total = total.saturating_add(meta.len());
                    files.push((entry.path(), meta.len(), mtime));
                }
            }
        }
    }
    if total <= YT_CACHE_CAP_BYTES {
        return;
    }
    files.sort_by_key(|(_, _, mtime)| *mtime); // oldest first
    for (path, len, _) in files {
        if total <= YT_CACHE_CAP_BYTES {
            break;
        }
        if path == keep {
            continue;
        }
        if std::fs::remove_file(&path).is_ok() {
            total = total.saturating_sub(len);
        }
    }
}

// Return the cached local path for a URL if it's already been downloaded on this
// device, without downloading. Lets the UI play a previously-fetched copy (with
// seeking) the moment a map opens.
#[tauri::command]
fn youtube_cached_path(app: tauri::AppHandle, url: String) -> Result<Option<String>, String> {
    use tauri::Manager;
    let id = parse_youtube_id(&url).ok_or_else(|| "not a recognized YouTube URL".to_string())?;
    let dir = yt_cache_dir(&app)?;
    match yt_find_cached(&dir, &id) {
        Some(path) => {
            app.asset_protocol_scope()
                .allow_file(&path)
                .map_err(|e| e.to_string())?;
            Ok(Some(path.to_string_lossy().to_string()))
        }
        None => Ok(None),
    }
}

fn run_youtube_download(app: tauri::AppHandle, url: String, force: bool) -> Result<String, String> {
    use tauri::Manager;
    let id = parse_youtube_id(&url).ok_or_else(|| "not a recognized YouTube URL".to_string())?;
    let dir = yt_cache_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    if force {
        // Re-download requested (e.g. after importing cookies or installing ffmpeg):
        // drop the existing copy and any leftover fragments for this id so we fetch
        // fresh at the best quality the current setup allows, rather than reuse cache.
        if let Ok(rd) = std::fs::read_dir(&dir) {
            let prefix = format!("{id}.");
            for entry in rd.flatten() {
                if entry.file_name().to_string_lossy().starts_with(&prefix) {
                    let _ = std::fs::remove_file(entry.path());
                }
            }
        }
    } else if let Some(path) = yt_find_cached(&dir, &id) {
        // Cache hit → reuse it; no second download (DC-3c).
        app.asset_protocol_scope()
            .allow_file(&path)
            .map_err(|e| e.to_string())?;
        return Ok(path.to_string_lossy().to_string());
    }

    let ytdlp = resolve_ytdlp().ok_or_else(|| {
        "yt-dlp was not found. Install it and put it on PATH, or set NOTETAKER_YTDLP to its full path.".to_string()
    })?;
    verify_ytdlp(&ytdlp)?;

    // Deterministic output keyed by the validated id; %(ext)s lets the downloader
    // pick the real container so we never mislabel it. The id is [A-Za-z0-9_-]{11},
    // so the template can't escape the cache dir (DC-3b: confine output).
    let out_template = dir.join(format!("{id}.%(ext)s"));

    let mut cmd = std::process::Command::new(&ytdlp);
    cmd.arg("--no-playlist").arg("--no-part").arg("--no-mtime");
    match resolve_ffmpeg(&app) {
        // ffmpeg present: take the best video up to 1080p plus the best audio (two
        // DASH streams) and merge them to mp4. The soft `<=?1080` prefers ≤1080p but
        // won't fail if only higher rungs exist; the trailing /best[ext=mp4]/best keep
        // a single-file fallback. --ffmpeg-location gets the dir (so ffprobe is found).
        Some(ff) => {
            cmd.arg("-f")
                .arg("bestvideo[ext=mp4][height<=?1080]+bestaudio[ext=m4a]/bestvideo[height<=?1080]+bestaudio/best[ext=mp4]/best")
                .arg("--merge-output-format")
                .arg("mp4")
                .arg("--ffmpeg-location")
                .arg(ff.parent().unwrap_or(ff.as_path()));
        }
        // No ffmpeg: the best single pre-muxed file. YouTube caps these near 720p, but
        // it needs no merge step, so high-quality stays strictly opt-in (needs ffmpeg).
        None => {
            cmd.arg("-f")
                .arg("best[ext=mp4][height<=?720]/best[ext=mp4]/mp4/best");
        }
    }
    // If the user has imported a cookies.txt, pass it so yt-dlp can fetch
    // signed-in / higher-quality formats that YouTube otherwise gates behind
    // an account (sidesteps the Windows browser-cookie decryption failures).
    // The path is a controlled app-data file; its contents are never logged.
    if let Some(cookies) = resolve_cookies(&app) {
        cmd.arg("--cookies").arg(cookies);
    }
    cmd.arg("-o")
        .arg(&out_template)
        .arg("--") // end of options: the URL after this can never be read as a flag
        .arg(&url); // a single argv element — never shell-interpolated (DC-3b)
    // Don't flash a console window on Windows for each download.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let output = cmd
        .output()
        .map_err(|e| format!("failed to launch downloader: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let msg = stderr
            .trim()
            .lines()
            .last()
            .unwrap_or("unknown error")
            .to_string();
        return Err(format!("download failed: {msg}"));
    }

    let path = yt_find_cached(&dir, &id)
        .ok_or_else(|| "download reported success but produced no file".to_string())?;
    yt_evict(&dir, &path);
    app.asset_protocol_scope()
        .allow_file(&path)
        .map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

// Download a (typically embed-blocked) YouTube video into the local cache and return
// its on-disk path. Runs off the async runtime because it shells out and can take a
// while; mirrors the desktop_google_sign_in spawn_blocking pattern.
#[tauri::command]
async fn download_youtube(
    app: tauri::AppHandle,
    url: String,
    force: Option<bool>,
) -> Result<String, String> {
    let force = force.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || run_youtube_download(app, url, force))
        .await
        .map_err(|e| e.to_string())?
}

// On-disk note storage for the desktop build. Each map is one pretty-printed
// JSON file under <app-data>/maps/<id>.json; the browser build keeps using
// localStorage (see fileStore.ts).
fn app_data(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    app.path().app_data_dir().map_err(|e| e.to_string())
}

fn maps_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app_data(app)?.join("maps"))
}

// Map ids are generated client-side as UUIDs. Validate strictly so a crafted id
// can never escape the maps/ directory.
fn map_path(app: &tauri::AppHandle, id: &str) -> Result<std::path::PathBuf, String> {
    if id.is_empty()
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("invalid map id".into());
    }
    Ok(maps_dir(app)?.join(format!("{id}.json")))
}

// --- Switcher index (FUN-6) -------------------------------------------------
// The map switcher only needs id/title/updatedAt/rev/source, but the maps
// themselves can be large (transcript-laden). Rather than read every file in
// full to list them, we maintain a tiny sidecar index, maps/index.json
// ({ id: { id, title, updatedAt, rev, source } }), updated on every save/delete
// and rebuilt by a one-time directory scan if it's ever missing or corrupt.
fn index_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(maps_dir(app)?.join("index.json"))
}

// Extract the switcher metadata from a full map JSON. Returns None when the
// contents aren't a JSON object (a corrupt file is simply left out of the index).
fn meta_from_contents(id: &str, contents: &str) -> Option<serde_json::Value> {
    let parsed: serde_json::Value = serde_json::from_str(contents).ok()?;
    if !parsed.is_object() {
        return None;
    }
    let str_field = |k: &str| {
        parsed
            .get(k)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string()
    };
    Some(serde_json::json!({
        "id": id,
        "title": str_field("title"),
        "updatedAt": str_field("updatedAt"),
        "rev": parsed.get("rev").and_then(|v| v.as_i64()).unwrap_or(0),
        "source": parsed.get("source").cloned().unwrap_or(serde_json::Value::Null),
    }))
}

// Read the index object, or None if it's missing or unparseable (→ rebuild).
fn read_index(
    app: &tauri::AppHandle,
) -> Result<Option<serde_json::Map<String, serde_json::Value>>, String> {
    let path = index_path(app)?;
    match std::fs::read_to_string(&path) {
        Ok(s) => match serde_json::from_str::<serde_json::Value>(&s) {
            Ok(serde_json::Value::Object(m)) => Ok(Some(m)),
            _ => Ok(None),
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn write_index(
    app: &tauri::AppHandle,
    idx: &serde_json::Map<String, serde_json::Value>,
) -> Result<(), String> {
    let path = index_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let body = serde_json::to_string(&serde_json::Value::Object(idx.clone()))
        .map_err(|e| e.to_string())?;
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, body).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(())
}

// Scan maps/*.json once and (re)build the index, persisting it best-effort.
fn rebuild_index(
    app: &tauri::AppHandle,
) -> Result<serde_json::Map<String, serde_json::Value>, String> {
    let dir = maps_dir(app)?;
    let mut idx = serde_json::Map::new();
    let rd = match std::fs::read_dir(&dir) {
        Ok(rd) => rd,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(idx),
        Err(e) => return Err(e.to_string()),
    };
    for entry in rd.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
        if stem.is_empty() || stem == "index" {
            continue; // the index file itself is not a map
        }
        if let Ok(s) = std::fs::read_to_string(&path) {
            if let Some(meta) = meta_from_contents(stem, &s) {
                idx.insert(stem.to_string(), meta);
            }
        }
    }
    let _ = write_index(app, &idx);
    Ok(idx)
}

// Write atomically: a dropped write (crash mid-save) can never leave a
// half-written file — we write a temp file, then rename it into place.
#[tauri::command]
fn save_map(app: tauri::AppHandle, id: String, contents: String) -> Result<(), String> {
    let path = map_path(&app, &id)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, &contents).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    // Keep the switcher index in step (FUN-6). Best-effort: a failure here must
    // not fail the save — list_maps self-heals by rebuilding. If the index is
    // missing/corrupt we rebuild from disk (which already includes this write)
    // so we never clobber other maps' entries with a one-entry index.
    if let Some(meta) = meta_from_contents(&id, &contents) {
        let mut idx = match read_index(&app) {
            Ok(Some(m)) => m,
            _ => rebuild_index(&app).unwrap_or_default(),
        };
        idx.insert(id.clone(), meta);
        let _ = write_index(&app, &idx);
    }
    Ok(())
}

#[tauri::command]
fn load_map(app: tauri::AppHandle, id: String) -> Result<Option<String>, String> {
    let path = map_path(&app, &id)?;
    match std::fs::read_to_string(&path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

// Return one compact metadata JSON per saved map, read from the sidecar index
// rather than the map bodies (FUN-6). The index is rebuilt by a single directory
// scan if it's missing or corrupt, so the first call after an upgrade self-heals.
#[tauri::command]
fn list_maps(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let idx = match read_index(&app)? {
        Some(m) => m,
        None => rebuild_index(&app)?,
    };
    let mut out = Vec::with_capacity(idx.len());
    for meta in idx.values() {
        if let Ok(s) = serde_json::to_string(meta) {
            out.push(s);
        }
    }
    Ok(out)
}

#[tauri::command]
fn delete_map(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let path = map_path(&app, &id)?;
    match std::fs::remove_file(&path) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.to_string()),
    }
    // Drop it from the switcher index too (FUN-6); best-effort.
    if let Ok(Some(mut idx)) = read_index(&app) {
        if idx.remove(&id).is_some() {
            let _ = write_index(&app, &idx);
        }
    }
    Ok(())
}

// One-time migration of the Phase-2 single-file <app-data>/map.json into the
// new maps/ directory. The frontend reads it once, re-saves it under maps/,
// then deletes it.
fn legacy_map_file(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app_data(app)?.join("map.json"))
}

#[tauri::command]
fn load_legacy_map(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = legacy_map_file(&app)?;
    match std::fs::read_to_string(&path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn delete_legacy_map(app: tauri::AppHandle) -> Result<(), String> {
    let path = legacy_map_file(&app)?;
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// Export text (the Markdown export) to a user-chosen file. The native Save dialog
// is opened *here in Rust* and the file is written only to the path the user picks
// in this same call — the webview supplies the contents and a suggested file name,
// never a destination. That closes SEC-3: there is no caller-controlled path, so
// the command can't be turned into an arbitrary-write primitive by injected script.
// Returns false when the user cancels the dialog.
//
// `async` so the command runs off the main thread; blocking_save_file dispatches
// the dialog to the main thread and waits, which is only safe when the caller is
// not itself the main thread.
#[tauri::command]
async fn export_text_file(
    app: tauri::AppHandle,
    contents: String,
    suggested_name: String,
) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;
    let picked = app
        .dialog()
        .file()
        .set_file_name(suggested_name)
        .add_filter("Markdown", &["md"])
        .blocking_save_file();
    let Some(file_path) = picked else {
        return Ok(false); // user cancelled
    };
    let path = file_path.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, contents).map_err(|e| e.to_string())?;
    Ok(true)
}

// ---------- Desktop Google sign-in (loopback OAuth + PKCE) ----------
// Firebase's popup sign-in can't run inside the Tauri webview, so on desktop we
// use the installed-app OAuth flow: open the system browser to Google's consent
// screen, catch the redirect on a localhost loopback port, exchange the code
// (with PKCE) for an id_token, and return it to the frontend — which then calls
// signInWithCredential. Credentials come from a Google "Desktop app" OAuth client
// (its secret is not confidential in this flow, per Google's native-app guidance).

fn b64url(bytes: &[u8]) -> String {
    use base64::Engine as _;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn random_token(byte_len: usize) -> Result<String, String> {
    let mut buf = vec![0u8; byte_len];
    getrandom::getrandom(&mut buf).map_err(|e| e.to_string())?;
    Ok(b64url(&buf))
}

fn pkce_challenge(verifier: &str) -> String {
    use sha2::{Digest, Sha256};
    b64url(&Sha256::digest(verifier.as_bytes()))
}

fn parse_query(query: &str) -> std::collections::HashMap<String, String> {
    let mut out = std::collections::HashMap::new();
    for pair in query.split('&') {
        if pair.is_empty() {
            continue;
        }
        let mut it = pair.splitn(2, '=');
        let k = it.next().unwrap_or("");
        let v = it.next().unwrap_or("");
        let kd = urlencoding::decode(k)
            .map(|c| c.into_owned())
            .unwrap_or_else(|_| k.to_string());
        let vd = urlencoding::decode(v)
            .map(|c| c.into_owned())
            .unwrap_or_else(|_| v.to_string());
        out.insert(kd, vd);
    }
    out
}

fn http_reply(stream: &mut std::net::TcpStream, body: &str) {
    use std::io::Write;
    let resp = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(resp.as_bytes());
    let _ = stream.flush();
}

// Block until Google redirects to the loopback with ?code=...&state=..., serving
// a small "you can close this tab" page. Times out so a thread can't hang forever.
fn wait_for_code(listener: std::net::TcpListener) -> Result<(String, String), String> {
    use std::io::{BufRead, BufReader};
    use std::time::{Duration, Instant};

    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(180);
    // Deliberately does NOT claim "signed in": this page is served the moment the
    // redirect arrives, BEFORE the token exchange and well before the app confirms
    // authentication. Claiming success here (the old copy) contradicted the app
    // when sign-in then failed. The app owns the real success/failure message.
    let ok_html = "<!doctype html><meta charset=utf-8><title>NoteTaker</title><body style=\"font-family:system-ui;max-width:32rem;margin:14vh auto;padding:0 24px;line-height:1.5;color:#211c16\"><h2 style=\"font-weight:600\">Almost done&hellip;</h2><p>You can close this tab and return to NoteTaker. The app will confirm once you're signed in.</p>";

    loop {
        match listener.accept() {
            Ok((mut stream, _)) => {
                stream.set_nonblocking(false).ok();
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .ok();
                let mut line = String::new();
                {
                    let mut reader = BufReader::new(&stream);
                    let _ = reader.read_line(&mut line);
                }
                // Request line looks like: "GET /?code=...&state=... HTTP/1.1"
                let target = line.split_whitespace().nth(1).unwrap_or("");
                let query = target.splitn(2, '?').nth(1).unwrap_or("");
                let params = parse_query(query);
                if let Some(err) = params.get("error") {
                    http_reply(
                        &mut stream,
                        "<!doctype html><meta charset=utf-8><title>NoteTaker</title><body style=\"font-family:system-ui;max-width:32rem;margin:14vh auto;padding:0 24px;line-height:1.5;color:#211c16\"><h2 style=\"font-weight:600\">Sign-in cancelled</h2><p>You can close this tab and return to NoteTaker to try again.</p>",
                    );
                    return Err(format!("google returned error: {err}"));
                }
                match (params.get("code"), params.get("state")) {
                    (Some(code), Some(state)) => {
                        http_reply(&mut stream, ok_html);
                        return Ok((code.clone(), state.clone()));
                    }
                    _ => {
                        // Stray request (e.g. /favicon.ico) — answer and keep waiting.
                        http_reply(&mut stream, "<!doctype html><meta charset=utf-8><body>Waiting…");
                    }
                }
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                if Instant::now() > deadline {
                    return Err("sign-in timed out".into());
                }
                std::thread::sleep(Duration::from_millis(120));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
}

fn run_google_oauth(client_id: String, client_secret: String) -> Result<String, String> {
    use std::net::TcpListener;

    let verifier = random_token(32)?;
    let challenge = pkce_challenge(&verifier);
    let state = random_token(16)?;

    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect_uri = format!("http://127.0.0.1:{port}");

    let auth_url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id={cid}&redirect_uri={ru}&scope={scope}&code_challenge={ch}&code_challenge_method=S256&state={st}&prompt=select_account",
        cid = urlencoding::encode(&client_id),
        ru = urlencoding::encode(&redirect_uri),
        scope = urlencoding::encode("openid email profile"),
        ch = urlencoding::encode(&challenge),
        st = urlencoding::encode(&state),
    );

    open::that(&auth_url).map_err(|e| format!("couldn't open browser: {e}"))?;

    let (code, got_state) = wait_for_code(listener)?;
    if got_state != state {
        return Err("state mismatch (possible CSRF)".into());
    }

    // ureq's native-tls backend must be attached to an Agent explicitly: the bare
    // ureq::post helper builds a default agent with no TLS connector, which fails at
    // runtime with "no TLS backend is configured". Wire the platform connector
    // (SChannel on Windows, OpenSSL on Linux, Secure Transport on macOS) here.
    let tls = native_tls::TlsConnector::new().map_err(|e| e.to_string())?;
    let agent = ureq::AgentBuilder::new()
        .tls_connector(std::sync::Arc::new(tls))
        .build();
    let resp = agent.post("https://oauth2.googleapis.com/token").send_form(&[
        ("client_id", client_id.as_str()),
        ("client_secret", client_secret.as_str()),
        ("code", code.as_str()),
        ("code_verifier", verifier.as_str()),
        ("grant_type", "authorization_code"),
        ("redirect_uri", redirect_uri.as_str()),
    ]);
    let resp = match resp {
        Ok(r) => r,
        Err(ureq::Error::Status(status, r)) => {
            let body = r.into_string().unwrap_or_default();
            return Err(format!("token exchange failed ({status}): {body}"));
        }
        Err(e) => return Err(e.to_string()),
    };
    let json: serde_json::Value = resp.into_json().map_err(|e| e.to_string())?;
    json.get("id_token")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "token response had no id_token".to_string())
}

// Runs the blocking OAuth dance off the async runtime so the UI stays responsive
// while the user signs in (which can take a while in the browser).
#[tauri::command]
async fn desktop_google_sign_in(
    client_id: String,
    client_secret: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || run_google_oauth(client_id, client_secret))
        .await
        .map_err(|e| e.to_string())?
}

// Size the window to a large fraction of the primary monitor (≈60% wide × 90%
// tall — comfortably at least half the screen) and snap it to the right edge:
// video on the left, notes on the right. From here the user can freely resize and
// move it (the window is `resizable`). Best-effort: if the monitor can't be read,
// the config's default size is kept. All math is in physical pixels (so it matches
// monitor.size()), avoiding scale-factor confusion.
fn size_window_default(win: &tauri::WebviewWindow) {
    if let Ok(Some(monitor)) = win.primary_monitor() {
        let screen = monitor.size();
        let w = ((screen.width as f64) * 0.6).round() as u32;
        let h = ((screen.height as f64) * 0.9).round() as u32;
        let _ = win.set_size(tauri::PhysicalSize::new(w, h));
        let x = (screen.width as i32 - w as i32).max(0);
        let _ = win.set_position(tauri::PhysicalPosition::new(x, 0));
    }
}

// Open an external URL in the user's default browser. The webview cancels
// window.open / target=_blank to external URLs, so UI "open in browser" actions
// (e.g. the quick-tour link) route through here. Restricted to http(s) so a stray
// call can't hand the OS opener an arbitrary scheme; reuses the `open` crate already
// pulled in for the sign-in flow.
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("refusing to open a non-http(s) url".into());
    }
    open::that(url).map_err(|e| format!("couldn't open browser: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            allow_video_path,
            download_youtube,
            youtube_cached_path,
            ffmpeg_available,
            download_ffmpeg,
            youtube_cookies_status,
            clear_youtube_cookies,
            set_youtube_cookies,
            save_map,
            load_map,
            list_maps,
            delete_map,
            load_legacy_map,
            delete_legacy_map,
            export_text_file,
            desktop_google_sign_in,
            open_external
        ]);

    // Global show/hide hotkey (Ctrl+Alt+N) — desktop only.
    #[cfg(desktop)]
    {
        use tauri::Manager;
        use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState};

        let toggle = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyN);
        let toggle_for_handler = toggle.clone();

        builder = builder.plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed && shortcut == &toggle_for_handler {
                        if let Some(win) = app.get_webview_window("main") {
                            match win.is_visible() {
                                Ok(true) => {
                                    let _ = win.hide();
                                }
                                _ => {
                                    let _ = win.show();
                                    let _ = win.set_focus();
                                }
                            }
                        }
                    }
                })
                .build(),
        );

        // Remember the window's size, position, and maximized state between launches
        // (UX-4). We persist only those three flags — notably NOT visibility — so the
        // global show/hide hotkey can never leave the app starting up hidden after a
        // quit, and our custom (decorationless) titlebar is untouched.
        use tauri_plugin_window_state::StateFlags;
        builder = builder.plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED)
                .build(),
        );

        builder = builder.setup(move |app| {
            use tauri_plugin_global_shortcut::GlobalShortcutExt;

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Register the global toggle hotkey.
            app.global_shortcut().register(toggle)?;

            // First launch only: size to ~60% of the screen and snap to the right
            // edge (see helper). On every later launch the window-state plugin has
            // already restored the geometry the user last chose, so re-snapping here
            // would fight them (the old UX-4 bug). A marker file in app-data records
            // that the one-time snap has run.
            if let Some(win) = app.get_webview_window("main") {
                let marker = app_data(app.handle()).map(|d| d.join(".geometry-initialized"));
                let first_run = marker.as_ref().map(|m| !m.exists()).unwrap_or(false);
                if first_run {
                    size_window_default(&win);
                    if let Ok(m) = &marker {
                        if let Some(parent) = m.parent() {
                            let _ = std::fs::create_dir_all(parent);
                        }
                        let _ = std::fs::write(m, b"1");
                    }
                }
            }

            Ok(())
        });
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
