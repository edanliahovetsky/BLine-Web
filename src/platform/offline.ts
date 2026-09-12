import { detectEnvironmentCapabilities } from "../env/capabilities";

/** Keep the browser app available offline without interrupting an editor session. */
export function registerOfflineApp(): void {
  if (
    detectEnvironmentCapabilities().shell !== "browser-web" ||
    !window.isSecureContext ||
    !("serviceWorker" in navigator)
  ) {
    return;
  }

  if (import.meta.env.DEV) {
    if (["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) {
      // The dev server also replaces /sw.js: this guard alone cannot escape
      // an old worker that intercepts the HTML before Vite's code runs.
      void navigator.serviceWorker
        .getRegistration(import.meta.env.BASE_URL)
        .then(async (registration) => {
          const worker = registration?.active ?? registration?.waiting;
          if (
            worker?.scriptURL ===
            new URL(`${import.meta.env.BASE_URL}sw.js`, location.href).href
          ) {
            await registration!.update().catch(() => undefined);
            await registration!.unregister();
          }
        })
        .catch(() => undefined);
    }
    return;
  }

  const reportRelease = () => {
    const release = document.querySelector<HTMLMetaElement>(
      'meta[name="bline-release"]',
    )?.content;
    if (release)
      navigator.serviceWorker.controller?.postMessage({
        type: "BLINE_PAGE_RELEASE",
        release,
      });
  };
  navigator.serviceWorker.addEventListener("controllerchange", reportRelease);
  reportRelease();

  const register = () => {
    // Registering again also checks for updates, including retrying an
    // interrupted first download when the connection comes back.
    void navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, {
        scope: import.meta.env.BASE_URL,
        updateViaCache: "none",
      })
      .catch(() => {
        // An offline visit or unavailable storage must not prevent editing.
        // The last successfully installed version remains in control.
      });
  };

  if (document.readyState === "complete") {
    register();
  } else {
    window.addEventListener("load", register, { once: true });
  }
  window.addEventListener("online", register);
}
