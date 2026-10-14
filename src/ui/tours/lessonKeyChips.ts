/** Lesson text marks event keys with backticks: "Set Lib Key to `stopIntake`." */
export type LessonTextPart =
  | { kind: "text"; text: string }
  | { kind: "key"; key: string };

export function lessonTextParts(text: string): LessonTextPart[] {
  return text
    .split(/(`[^`]+`)/)
    .filter(Boolean)
    .map((part) =>
      part.startsWith("`") && part.endsWith("`") && part.length > 2
        ? { kind: "key", key: part.slice(1, -1) }
        : { kind: "text", text: part },
    );
}

/** Lesson text without its chip markup, for labels and word counts. */
export function plainLessonText(text: string): string {
  return text.replace(/`([^`]+)`/g, "$1");
}

const keyFieldSelector = [
  'input[aria-label="Lib Key"]',
  'input[aria-label="New Lib Key"]',
  'input[aria-label="Replacement Lib Key"]',
  'input[placeholder="Lib Key"]',
].join(", ");

export function isEventKeyField(
  element: Element | null,
): element is HTMLInputElement {
  return (
    element instanceof HTMLInputElement &&
    !element.disabled &&
    element.matches(keyFieldSelector)
  );
}

let lastKeyField: HTMLInputElement | null = null;

/** Remember the key field a learner last used so a chip click can fill it. */
export function trackEventKeyFields(root: Document = document): () => void {
  const remember = (event: FocusEvent) => {
    if (isEventKeyField(event.target as Element | null))
      lastKeyField = event.target as HTMLInputElement;
  };
  root.addEventListener("focusin", remember, true);
  return () => {
    root.removeEventListener("focusin", remember, true);
    lastKeyField = null;
  };
}

/**
 * The field a chip fills: the focused key field, else the one used last, else
 * the selected event's Lib Key in the inspector.
 */
export function eventKeyFieldForChip(
  root: Document = document,
): HTMLInputElement | null {
  if (isEventKeyField(root.activeElement)) return root.activeElement;
  if (lastKeyField?.isConnected && isEventKeyField(lastKeyField))
    return lastKeyField;
  const inspector = root.querySelector(
    '[data-testid="property-editor"] input[aria-label="Lib Key"]',
  );
  return isEventKeyField(inspector) ? inspector : null;
}

/** Type a key into a React-controlled field as if the learner had typed it. */
export function insertEventKey(field: HTMLInputElement, key: string): void {
  field.focus();
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setValue?.call(field, key);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}
