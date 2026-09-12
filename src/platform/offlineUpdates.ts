export interface OfflineUpdateOptions {
  canReload(): boolean;
  prepareReload(): Promise<void>;
}

const RELOAD_ATTEMPT_KEY = "bline-web:offline-update-reload";
const IDLE_MS = 1000;

/** Each editor owns its reload decision; a worker never navigates other tabs. */
export function startOfflineUpdateReloads(
  pageRelease: string,
  options: OfflineUpdateOptions,
) {
  let pending: string | null = null;
  let lastActivity = Date.now();
  let preparing = false;
  let disposed = false;
  let composing = false;
  const pointers = new Set<number>();
  const keys = new Set<string>();
  const activity = (event: Event) => {
    lastActivity = Date.now();
    if (event instanceof PointerEvent) {
      if (event.type === "pointerdown") pointers.add(event.pointerId);
      else pointers.delete(event.pointerId);
    }
    if (event instanceof KeyboardEvent) {
      if (event.type === "keydown") keys.add(event.code);
      else keys.delete(event.code);
    }
    if (event.type === "compositionstart") composing = true;
    if (event.type === "compositionend") composing = false;
    if (event.type === "blur" && event.target === window) {
      pointers.clear();
      keys.clear();
    }
  };
  const events = [
    "pointerdown",
    "pointerup",
    "pointercancel",
    "keydown",
    "keyup",
    "input",
    "compositionstart",
    "compositionend",
    "focusin",
    "focusout",
    "blur",
  ];
  for (const type of events) window.addEventListener(type, activity, true);

  const safeToReload = () =>
    !disposed &&
    Date.now() - lastActivity >= IDLE_MS &&
    pointers.size === 0 &&
    keys.size === 0 &&
    !composing &&
    !document.activeElement?.closest(
      'input:not([type="button"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"]), textarea, select, [contenteditable="true"], [role="textbox"]',
    ) &&
    !document.querySelector('[aria-modal="true"], dialog[open]') &&
    options.canReload();

  const tryReload = async () => {
    if (!pending || preparing || !safeToReload()) return;
    const target = pending;
    const activityAtStart = lastActivity;
    preparing = true;
    try {
      // A rollback or failed navigation must not create an automatic reload loop.
      if (sessionStorage.getItem(RELOAD_ATTEMPT_KEY) === target) return;
      await options.prepareReload();
      if (
        pending !== target ||
        lastActivity !== activityAtStart ||
        !safeToReload()
      )
        return;
      sessionStorage.setItem(RELOAD_ATTEMPT_KEY, target);
      window.location.reload();
      pending = null;
    } catch {
      // Failed persistence (including User Data) leaves this editor open.
    } finally {
      preparing = false;
    }
  };
  const timer = window.setInterval(() => void tryReload(), 250);
  return {
    offer(release: string) {
      pending = release === pageRelease ? null : release;
    },
    dispose() {
      disposed = true;
      window.clearInterval(timer);
      for (const type of events)
        window.removeEventListener(type, activity, true);
    },
  };
}
