export function stringifyBLineJson(value: unknown): string {
  return writeJsonValue(value, 0);
}

function writeJsonValue(value: unknown, depth: number, key?: string): string {
  if (value === null || value === undefined) {
    return "null";
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    return formatJsonNumber(value, shouldFormatNumberAsFloat(key));
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]";
    }

    const nextDepth = depth + 1;
    const items = value
      .map((item) => `${indent(nextDepth)}${writeJsonValue(item, nextDepth)}`)
      .join(",\n");
    return `[\n${items}\n${indent(depth)}]`;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, entryValue]) => entryValue !== undefined,
    );
    if (entries.length === 0) {
      return "{}";
    }

    const nextDepth = depth + 1;
    const items = entries
      .map(
        ([entryKey, entryValue]) =>
          `${indent(nextDepth)}${JSON.stringify(entryKey)}: ${writeJsonValue(
            entryValue,
            nextDepth,
            entryKey,
          )}`,
      )
      .join(",\n");
    return `{\n${items}\n${indent(depth)}}`;
  }

  return "null";
}

function formatJsonNumber(value: number, forceFloat: boolean): string {
  if (!Number.isFinite(value)) {
    return "null";
  }

  if (!forceFloat) {
    return JSON.stringify(value) ?? "null";
  }

  const rounded = roundToBLinePrecision(value);
  return trimFixedDecimal(rounded.toFixed(blineDecimalPlaces));
}

function roundToBLinePrecision(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const rounded =
    (Math.round((Math.abs(value) + Number.EPSILON) * blineScale) / blineScale) *
    sign;
  return Object.is(rounded, -0) || rounded === 0 ? 0 : rounded;
}

function trimFixedDecimal(value: string): string {
  const trimmed = value.replace(/(\.\d*?)0+$/, "$1");
  return trimmed.endsWith(".") ? `${trimmed}0` : trimmed;
}

function shouldFormatNumberAsFloat(key: string | undefined): boolean {
  return key !== undefined && !integerKeys.has(key);
}

const integerKeys = new Set([
  "schema_version",
  "project_schema_version",
  "bline_project_schema_version",
  "bundle_schema_version",
  "start_ordinal",
  "end_ordinal",
]);

const blineDecimalPlaces = 5;
const blineScale = 10 ** blineDecimalPlaces;

function indent(depth: number): string {
  return "  ".repeat(depth);
}
