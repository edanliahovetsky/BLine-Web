import field22 from "../assets/fields/field22.png?url&no-inline";
import field23 from "../assets/fields/field23.png?url&no-inline";
import field24 from "../assets/fields/field24.png?url&no-inline";
import field25 from "../assets/fields/field25.png?url&no-inline";
import field25Annotated from "../assets/fields/field25-annotated.png?url&no-inline";
import field26 from "../assets/fields/field26.png?url&no-inline";

const urls: Record<string, string> = {
  "/assets/fields/field22.png": field22,
  "/assets/fields/field23.png": field23,
  "/assets/fields/field24.png": field24,
  "/assets/fields/field25.png": field25,
  "/assets/fields/field25-annotated.png": field25Annotated,
  "/assets/fields/field26.png": field26,
};

/** Preserve logical model URLs; select immutable build assets only for rendering. */
export function fieldImageUrl(source: string): string {
  return urls[source] ?? source;
}
