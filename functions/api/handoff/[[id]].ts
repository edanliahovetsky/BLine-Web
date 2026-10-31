import {
  handleHandoffRequest,
  retiredBLineOrigins,
  type HandoffDatabase,
} from "../../../service/handoff/relay";

interface HandoffContext {
  request: Request;
  env: { HANDOFF_DB?: HandoffDatabase };
  params: { id?: string | string[] };
}

/** Cloudflare Pages route for /api/handoff and /api/handoff/:id. */
export function onRequest(context: HandoffContext): Promise<Response> {
  const segments = context.params.id;
  // A bare /api/handoff arrives as no segments: an empty array or undefined.
  const id =
    (Array.isArray(segments) ? segments.join("/") : segments) || undefined;
  return handleHandoffRequest(context.request, context.env.HANDOFF_DB, id, {
    allowedSourceOrigins: retiredBLineOrigins,
  });
}
