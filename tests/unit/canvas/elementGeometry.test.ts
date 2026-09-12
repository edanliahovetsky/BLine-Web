import { describe, expect, it } from "vitest";
import {
  footprintOutlineCommands,
  hitTestRobotFrontFace,
  robotFrontPoint,
} from "../../../src/canvas/elementGeometry";

describe("Open Edge interaction geometry", () => {
  it.each([0, Math.PI / 4, Math.PI / 2, -Math.PI * 0.8])(
    "covers the full front face at heading %s without stealing the center or back",
    (heading) => {
      const center = { x: 200, y: 300 };
      const pointer = (x: number, y: number) => ({
        x: center.x + x * Math.cos(heading) + y * Math.sin(heading),
        y: center.y - x * Math.sin(heading) + y * Math.cos(heading),
      });
      for (const y of [-20, -12, 0, 12, 20]) {
        expect(
          hitTestRobotFrontFace(center, pointer(40, y), 80, 40, heading),
        ).toBe(true);
      }
      for (const [x, y] of [
        [0, 0],
        [-40, 0],
        [0, 20],
        [40, 30],
        [60, 0],
      ]) {
        expect(
          hitTestRobotFrontFace(center, pointer(x, y), 80, 40, heading),
        ).toBe(false);
      }
      const front = robotFrontPoint(center, 80, heading);
      expect(front.x).toBeCloseTo(pointer(40, 0).x);
      expect(front.y).toBeCloseTo(pointer(40, 0).y);
      const insetFront = robotFrontPoint(center, 80, heading, 1.2);
      expect(insetFront.x).toBeCloseTo(pointer(38.8, 0).x);
      expect(insetFront.y).toBeCloseTo(pointer(38.8, 0).y);
    },
  );

  it("keeps the center draggable for tiny footprints", () => {
    const center = { x: 0, y: 0 };
    expect(hitTestRobotFrontFace(center, center, 4, 4, 0)).toBe(false);
    expect(hitTestRobotFrontFace(center, { x: 2, y: 0 }, 4, 4, 0)).toBe(true);
    expect(hitTestRobotFrontFace(center, center, 0, 0, 0)).toBe(false);
  });

  it("keeps outlines inside rectangular bounds and leaves the front opening clear", () => {
    const commands = footprintOutlineCommands(
      { x: -40, y: -20, width: 80, height: 40 },
      3,
      6,
    );
    expect(commands[0]).toEqual(["M", 40, -6]);
    expect(commands.at(-1)).toEqual(["L", 40, 6]);
    const coordinates = commands.flatMap(([, ...values]) => values);
    for (let i = 0; i < coordinates.length; i += 2) {
      expect(Math.abs(coordinates[i])).toBeLessThanOrEqual(40);
      expect(Math.abs(coordinates[i + 1])).toBeLessThanOrEqual(20);
    }
    expect(
      footprintOutlineCommands({ x: 0, y: 0, width: 0, height: 0 }, 3, 6),
    ).toEqual([]);
  });
});
