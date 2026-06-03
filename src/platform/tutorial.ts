import { isTauri } from "./window";

// Opens the standalone quick-tour page (public/tutorial.html). It ships as a static
// file alongside the app, so the web build serves it at /tutorial.html and the
// desktop build bundles it.
//
// Web: navigate the current tab to it (the tour links back to "/" to return).
// Desktop: the Tauri webview can't host a second
// tab and cancels window.open / target=_blank to external URLs, so we hand the hosted
// copy to the user's default browser via the open_external Rust command (which reuses
// the `open` crate already pulled in for the sign-in flow).
const HOSTED_TUTORIAL = "https://notetakerui.web.app/tutorial.html";

export async function openTutorial(): Promise<void> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_external", { url: HOSTED_TUTORIAL });
    return;
  }
  window.location.assign("/tutorial.html");
}
