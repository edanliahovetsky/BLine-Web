import { detectEnvironmentCapabilities } from "../env/capabilities";
import {
  startOfflineUpdateReloads,
  type OfflineUpdateOptions,
} from "./offlineUpdates";

/** Keep the offline copy current, reloading only when the editor says it is safe. */
export function registerOfflineApp(
  options: OfflineUpdateOptions,
): (() => void) | undefined {
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

  const release = document.querySelector<HTMLMetaElement>(
    'meta[name="bline-release"]',
  )?.content;
  const updates = release
    ? startOfflineUpdateReloads(release, options)
    : undefined;
  const reportRelease = () => {
    if (release)
      navigator.serviceWorker.controller?.postMessage({
        type: "BLINE_PAGE_RELEASE",
        release,
      });
  };
  navigator.serviceWorker.addEventListener("controllerchange", reportRelease);
  const receiveUpdate = (event: MessageEvent) => {
    if (
      event.source === navigator.serviceWorker.controller &&
      event.data?.type === "BLINE_UPDATE_READY" &&
      event.data.pageRelease === release &&
      /^[a-f0-9]{64}$/.test(event.data.release)
    ) {
      updates?.offer(event.data.release);
    }
  };
  navigator.serviceWorker.addEventListener("message", receiveUpdate);
  reportRelease();

  let disposed = false;
  let registration: ServiceWorkerRegistration | undefined;
  const register = () => {
    // Retry an interrupted first download when the connection comes back.
    if (disposed) return;
    reportRelease();
    if (
      registration?.active ||
      registration?.installing ||
      registration?.waiting
    ) {
      void registration.update().catch(() => undefined);
      return;
    }
    void navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, {
        scope: import.meta.env.BASE_URL,
        updateViaCache: "none",
      })
      .then((installed) => {
        registration = installed;
        if (disposed) return;
        reportRelease();
        // A same-URL register() can return an existing worker without checking
        // for new bytes. Do not rely on the browser's navigation update timing.
        if (installed.active) return installed.update();
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
  window.addEventListener("focus", register);
  const onVisible = () => {
    if (document.visibilityState === "visible") register();
  };
  document.addEventListener("visibilitychange", onVisible);
  const timer = window.setInterval(onVisible, 5 * 60_000);
  return () => {
    disposed = true;
    window.clearInterval(timer);
    window.removeEventListener("load", register);
    window.removeEventListener("online", register);
    window.removeEventListener("focus", register);
    document.removeEventListener("visibilitychange", onVisible);
    navigator.serviceWorker.removeEventListener(
      "controllerchange",
      reportRelease,
    );
    navigator.serviceWorker.removeEventListener("message", receiveUpdate);
    updates?.dispose();
  };
}
