import { describe, expect, it } from "vitest";
import {
  createEventTrigger,
  createPathModel,
  createTranslationTarget,
} from "../../../src/core/model/path";
import type { SimulationTraceSample } from "../../../src/core/sim/types";
import { simulationEventPulseAtTime } from "../../../src/canvas/simulationEventPulse";

describe("simulation event pulse", () => {
  it("peaks as the robot crosses an event and fades shortly afterward", () => {
    const path = createPathModel({
      path_elements: [
        createTranslationTarget({ x_meters: 0, y_meters: 0 }),
        createEventTrigger({ t_ratio: 0.5, lib_key: "intake" }),
        createTranslationTarget({ x_meters: 4, y_meters: 0 }),
      ],
    });
    const trace = [sample(0, 0), sample(1, 2), sample(2, 4)];

    expect(simulationEventPulseAtTime(path, trace, 0.8)).toBe(0);
    expect(simulationEventPulseAtTime(path, trace, 1)).toBe(1);
    expect(simulationEventPulseAtTime(path, trace, 1.21)).toBeCloseTo(0.5);
    expect(simulationEventPulseAtTime(path, trace, 1.43)).toBe(0);
  });

  it("stays inactive when the path has no event triggers", () => {
    const path = createPathModel({
      path_elements: [
        createTranslationTarget({ x_meters: 0, y_meters: 0 }),
        createTranslationTarget({ x_meters: 4, y_meters: 0 }),
      ],
    });

    expect(
      simulationEventPulseAtTime(
        path,
        [sample(0, 0), sample(2, 4)],
        1,
      ),
    ).toBe(0);
  });
});

function sample(timeS: number, globalS: number): SimulationTraceSample {
  return {
    time_s: timeS,
    x_m: globalS,
    y_m: 0,
    theta_rad: 0,
    segment_index: 0,
    target_anchor_ordinal_1b: 2,
    global_s_m: globalS,
    segment_s_m: globalS,
    vx_mps: 0,
    vy_mps: 0,
    omega_radps: 0,
    speed_mps: 0,
    ax_mps2: 0,
    ay_mps2: 0,
    acceleration_mps2: 0,
    snapped_position: false,
    snapped_rotation: false,
  };
}
