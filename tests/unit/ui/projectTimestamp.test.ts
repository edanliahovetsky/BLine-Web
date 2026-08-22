import { describe, expect, it } from "vitest";
import { parseProjectTimestamp } from "../../../src/ui/app/projectTimestamp";

describe("Project timestamp parsing", () => {
  it("accepts browser ISO timestamps", () => {
    expect(
      parseProjectTimestamp("2026-08-22T14:30:00.000Z")?.toISOString(),
    ).toBe("2026-08-22T14:30:00.000Z");
  });

  it("accepts desktop epoch-millisecond timestamps", () => {
    expect(parseProjectTimestamp("1787409000000")?.toISOString()).toBe(
      "2026-08-22T14:30:00.000Z",
    );
  });

  it("rejects invalid timestamps", () => {
    expect(parseProjectTimestamp("not-a-timestamp")).toBeNull();
  });
});
