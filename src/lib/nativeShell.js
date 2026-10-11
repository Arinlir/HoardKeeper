// Phone-app-only wiring that a browser tab gets from the browser itself.
// Loaded by main.jsx only when running inside Capacitor, so none of it (or
// @capacitor/app) is fetched by the web app.

// Android's back button. A browser tab would walk its history; this app
// doesn't keep one (it's a single page with overlays), so without this the
// back button would close the whole app from inside any dialog. Instead it
// does what Escape does on a desktop — close whatever is on top:
//   1. the live scanner, if it's up;
//   2. any open dialog / full-screen panel, or the Life Counter (both already
//      close on Escape);
//   3. otherwise, send the app to the background, as Android users expect
//      from the back button on an app's home screen.
export function decideBack(doc) {
  if (doc.documentElement.classList.contains("bw-scanning")) return "scanner";
  if (doc.querySelector('[data-role="modal-backdrop"], [data-bw-back]')) return "escape";
  return "background";
}

export async function installNativeShell() {
  const { App } = await import("@capacitor/app");
  App.addListener("backButton", () => {
    const what = decideBack(document);
    if (what === "scanner") {
      window.dispatchEvent(new Event("bw-scanner-back"));
    } else if (what === "escape") {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    } else {
      App.minimizeApp();
    }
  });
  document.documentElement.classList.add("bw-native");
}
