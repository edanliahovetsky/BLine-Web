import { expect, it } from "vitest";
import {
  createPathModel,
  createTranslationTarget,
} from "../../../src/core/model/path";
import { simulatePathWithTrace } from "../../../src/core/sim/simulatePath";
import {
  deformSimulationPreview,
  maximumPreviewSamples,
  prepareSimulationPreview,
} from "../../../src/canvas/simulationPreviewGeometry";

function path(
  points = [
    [0, 0],
    [4, 0],
    [8, 2],
  ],
) {
  return createPathModel({
    path_elements: points.map(([x_meters, y_meters]) =>
      createTranslationTarget({ x_meters, y_meters }),
    ),
  });
}

it("moves the trace and robot together without changing the source or solving again", () => {
  const source = path();
  const result = simulatePathWithTrace(source);
  const original = structuredClone(result);
  const prepared = prepareSimulationPreview(source, result);
  const preview = deformSimulationPreview(
    prepared,
    path([
      [2, -1],
      [6, -1],
      [10, 1],
    ]),
  );
  for (const [index, sample] of preview.trace.entries()) {
    const before = result.trace[index];
    expect(sample.x_m).toBeCloseTo(before.x_m + 2);
    expect(sample.y_m).toBeCloseTo(before.y_m - 1);
  }
  const end = preview.trace.at(-1)!;
  expect(preview.poses_by_time.get(end.time_s)).toEqual([
    end.x_m,
    end.y_m,
    end.theta_rad,
  ]);
  expect(new Set(preview.times_sorted).size).toBe(preview.times_sorted.length);
  expect(preview.total_time_s).toBe(result.total_time_s);
  expect(result).toEqual(original);
  expect(source).toEqual(path());
});

it("follows each new middle-anchor position while preserving both endpoints", () => {
  const source = path();
  const result = simulatePathWithTrace(source);
  const prepared = prepareSimulationPreview(source, result);
  const byTime = new Map(result.trace.map((sample) => [sample.time_s, sample]));
  for (const y of [0.1, 0.2, 0.3, 0.4, 0.5]) {
    const preview = deformSimulationPreview(
      prepared,
      path([
        [0, 0],
        [4, y],
        [8, 2],
      ]),
    );
    expect(preview.trace[0]).toEqual(result.trace[0]);
    expect(preview.trace.at(-1)).toEqual(result.trace.at(-1));
    const largestShift = Math.max(
      ...preview.trace.map(
        (sample) => sample.y_m - byTime.get(sample.time_s)!.y_m,
      ),
    );
    expect(largestShift).toBeGreaterThan(y * 0.9);
    expect(largestShift).toBeLessThanOrEqual(y + 1e-9);
  }
});

it("bounds per-frame samples on long traces and retains their first and last points", () => {
  const source = path();
  const result = simulatePathWithTrace(source);
  result.trace = Array.from({ length: 50_000 }, (_, index) => ({
    ...result.trace[index % result.trace.length],
    time_s: index * 0.02,
  }));
  const preview = deformSimulationPreview(
    prepareSimulationPreview(source, result),
    source,
  );
  expect(preview.trace).toHaveLength(maximumPreviewSamples);
  expect(preview.poses_by_time.size).toBe(maximumPreviewSamples);
  expect(preview.trace[0]).toEqual(result.trace[0]);
  expect(preview.trace.at(-1)).toEqual(result.trace.at(-1));
});

it("handles coincident anchors and declines a topology change safely", () => {
  const source = path([
    [0, 0],
    [0, 0],
    [4, 0],
  ]);
  const result = simulatePathWithTrace(source);
  const prepared = prepareSimulationPreview(source, result);
  const preview = deformSimulationPreview(
    prepared,
    path([
      [1, 1],
      [1, 1],
      [4, 0],
    ]),
  );
  expect(
    preview.trace.every(
      (sample) => Number.isFinite(sample.x_m) && Number.isFinite(sample.y_m),
    ),
  ).toBe(true);
  expect(deformSimulationPreview(prepared, path([[0, 0]]))).toBe(result);
});
