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
      ([, entryValue]) => entryValue !== undefined
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
            entryKey
          )}`
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

  const encoded = JSON.stringify(value) ?? "null";
  if (!forceFloat || encoded.includes(".") || /e/i.test(encoded)) {
    return encoded;
  }

  return Object.is(value, -0) ? "-0.0" : `${encoded}.0`;
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
  "end_ordinal"
]);

function indent(depth: number): string {
  return "  ".repeat(depth);
}
