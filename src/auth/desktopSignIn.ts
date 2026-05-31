// Desktop (Tauri) Google sign-in. The heavy lifting — opening the system
// browser, catching the loopback redirect, and the PKCE token exchange — happens
// in Rust (see src-tauri/src/lib.rs `desktop_google_sign_in`). Here we just pass
// the OAuth client credentials and hand back the resulting Google id_token.

export async function signInDesktopGoogle(): Promise<string> {
  const clientId = import.meta.env.VITE_GOOGLE_DESKTOP_CLIENT_ID;
  const clientSecret = import.meta.env.VITE_GOOGLE_DESKTOP_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      'Desktop sign-in needs VITE_GOOGLE_DESKTOP_CLIENT_ID and ' +
        'VITE_GOOGLE_DESKTOP_CLIENT_SECRET in .env.local (a Google "Desktop app" OAuth client).'
    );
  }
  const { invoke } = await import("@tauri-apps/api/core");
  // Pass both camelCase and snake_case keys: Tauri v2 maps camelCase (JS) to
  // snake_case (Rust), but sending both is harmless (extra keys are ignored) and
  // immunizes this untested-on-this-machine path against that convention.
  return invoke<string>("desktop_google_sign_in", {
    clientId,
    clientSecret,
    client_id: clientId,
    client_secret: clientSecret,
  });
}
