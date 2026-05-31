// Save text to a user-chosen file. Under Tauri the Rust side owns the native Save
// dialog and writes only to the path the user picks (so the webview never names a
// destination — see SEC-3); in the browser we trigger a download.

import { isTauri } from "./window";

export interface SaveFilter {
  name: string;
  extensions: string[];
}

export async function saveTextFile(
  suggestedName: string,
  contents: string,
  _filters?: SaveFilter[]
): Promise<boolean> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<boolean>("export_text_file", { contents, suggestedName });
  }

  const blob = new Blob([contents], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = suggestedName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
