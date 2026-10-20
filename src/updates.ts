/**
 * Show a new version as soon as it is installed.
 *
 * The service worker takes over right away (skipWaiting + clientsClaim), but the page that is
 * already open keeps running the old code. An iPhone home-screen app is rarely closed, so without
 * this it can stay on an old version for days. When the new worker takes control we reload,
 * except while someone is typing something that is not saved yet: then we wait until they stop.
 */

let composing = false;

/** Typing that a reload would lose. The memo box saves its draft on every keystroke, so it is safe. */
function busy() {
  if (composing) return true; // IME text not committed yet
  const el = document.activeElement;
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return false;
  return el.id !== "memo" && el.value !== "";
}

function reloadWhenIdle() {
  const go = () => {
    if (busy() && document.visibilityState === "visible") return;
    document.removeEventListener("focusout", later);
    document.removeEventListener("visibilitychange", go);
    location.reload();
  };
  // focusout fires before focus moves on; check once it has settled
  const later = () => setTimeout(go, 0);
  if (!busy()) return go();
  document.addEventListener("focusout", later);
  document.addEventListener("visibilitychange", go);
}

export function watchForUpdates() {
  if (!("serviceWorker" in navigator)) return;
  const sw = navigator.serviceWorker;
  // first install: there was no old version on screen to replace
  const hadController = !!sw.controller;
  let reloading = false;
  sw.addEventListener("controllerchange", () => {
    if (!hadController || reloading) return;
    reloading = true;
    reloadWhenIdle();
  });
  document.addEventListener("compositionstart", () => (composing = true));
  document.addEventListener("compositionend", () => (composing = false));
  // a home-screen app comes back from the background without reloading: look for a new version then
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    sw.getRegistration()
      .then((r) => r?.update())
      .catch(() => {});
  });
}
