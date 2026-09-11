import { detectEnvironmentCapabilities } from "../env/capabilities";

/** Keep the browser app available offline without interrupting an editor session. */
export function registerOfflineApp(): void {
  if (
    !import.meta.env.PROD ||
    detectEnvironmentCapabilities().shell !== "browser-web" ||
    !window.isSecureContext ||
    !("serviceWorker" in navigator)
  ) {
    return;
  }

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
