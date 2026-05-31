// Pick a caption file (.srt / .vtt / .txt) and parse it into cues.
//
// Uses a transient <input type=file> + File.text(), which behaves identically in
// the Tauri webview and a plain browser. We only ever read the file's *contents*
// (copied into the map), never its path — so, unlike the video picker, this needs
// no Rust command and adds no arbitrary-file-read surface to the desktop build.
//
// Resolves null when the dialog is dismissed, or [] when the file held no
// recognizable cues (so the caller can show a friendly message).

import { parseTranscript } from "./parse";
import type { TranscriptCue } from "../model/types";

export function importTranscriptFile(): Promise<TranscriptCue[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".srt,.vtt,.txt,text/plain,text/vtt";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      file
        .text()
        .then((text) => resolve(parseTranscript(text)))
        .catch(() => resolve([]));
    };
    input.click();
  });
}
