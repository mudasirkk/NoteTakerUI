/*
 * Tutorial theme toggle.
 *
 * Shares the app's exact preference key (notetaker:pref:theme) so that on the
 * web build — where the tutorial is served from the same origin as the app —
 * the two stay in lockstep, including live cross-tab updates via the `storage`
 * event. On desktop the OS browser opens the hosted tutorial from a different
 * origin than the Tauri app, so the preference is independent there and simply
 * defaults to the OS color scheme ("system").
 *
 * This file is loaded as a blocking <script> in <head> (no defer) so the saved
 * theme is applied before the body paints — no flash of the wrong theme. It is
 * an external file because Firebase Hosting's CSP forbids inline scripts.
 */
(function () {
  var KEY = "notetaker:pref:theme";
  var ORDER = ["system", "light", "dark"];
  var ICON = { system: "◐", light: "☀", dark: "☾" }; // ◐ ☀ ☾
  var LABEL = { system: "Auto", light: "Light", dark: "Dark" };

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw === null) return "system";
      var v = JSON.parse(raw);
      return v === "light" || v === "dark" ? v : "system";
    } catch (e) {
      return "system";
    }
  }

  function apply(pref) {
    var root = document.documentElement;
    if (pref === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", pref);
  }

  // Pre-paint: the script is blocking in <head>, so this runs before the body.
  apply(load());

  function wire() {
    var btn = document.getElementById("themeToggle");
    if (!btn) return;
    var ic = btn.querySelector(".theme-ic");
    var lb = btn.querySelector(".theme-label");

    function render() {
      var cur = load();
      if (ic) ic.textContent = ICON[cur];
      if (lb) lb.textContent = LABEL[cur];
      btn.setAttribute("aria-label", "Theme: " + LABEL[cur] + ". Click to change.");
    }

    btn.addEventListener("click", function () {
      var next = ORDER[(ORDER.indexOf(load()) + 1) % ORDER.length];
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch (e) {}
      apply(next);
      render();
    });

    // Keep in sync when the app (or another tutorial tab) changes the theme.
    window.addEventListener("storage", function (e) {
      if (e.key === KEY) {
        apply(load());
        render();
      }
    });

    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
})();
