import { describe, expect, it } from "vitest";
import {
  lessonTextParts,
  plainLessonText,
} from "../../../src/ui/tours/lessonKeyChips";

describe("lesson key chips", () => {
  it("splits backticked event keys from the surrounding copy", () => {
    expect(lessonTextParts("Add `stopIntake` at 0.6")).toEqual([
      { kind: "text", text: "Add " },
      { kind: "key", key: "stopIntake" },
      { kind: "text", text: " at 0.6" },
    ]);
    expect(lessonTextParts("No keys here")).toEqual([
      { kind: "text", text: "No keys here" },
    ]);
    expect(plainLessonText("Set `a` and `b`.")).toBe("Set a and b.");
  });
});
