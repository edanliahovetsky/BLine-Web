/**
 * View actions any part of the editor can ask the canvas to perform without a
 * reference to it — for example a lesson step that wants the whole path in
 * view after it opens the inspector. The canvas applies a request once the
 * layout it triggers has settled.
 */
export type CanvasViewRequest = { kind: "frame-path" } | { kind: "fit-field" };

type Listener = (request: CanvasViewRequest) => void;

const listeners = new Set<Listener>();

export function requestCanvasView(request: CanvasViewRequest): void {
  for (const listener of listeners) listener(request);
}

export function subscribeCanvasViewRequests(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
