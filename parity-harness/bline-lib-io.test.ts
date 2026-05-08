import { spawnSync } from "node:child_process";
import { chmodSync, existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  createConstraints,
  createEventTrigger,
  createPathModel,
  createRotationTarget,
  createTranslationTarget,
  createWaypoint,
  type RangedConstraint,
} from "../src/core/model/path";
import {
  createProjectPathDocument,
  createProjectWorkspaceDocument,
} from "../src/core/io/projectSchema";
import {
  serializeBLineProjectFolder,
  type ProjectFolderExport,
} from "../src/core/io/projectFolder";

interface ConstraintRangeReport {
  value: number;
  start_ordinal: number;
  end_ordinal: number;
}

interface ElementReport {
  type: string;
  t_ratio?: number;
  lib_key?: string;
  rotation_radians?: number;
  profiled_rotation?: boolean;
  translation_target?: {
    x_meters: number;
    y_meters: number;
    intermediate_handoff_radius_meters: number | null;
  };
  rotation_target?: {
    rotation_radians: number;
    t_ratio: number;
    profiled_rotation: boolean;
  };
}

interface PathReport {
  file_name: string;
  valid: boolean;
  end_translation_tolerance_meters: number;
  end_rotation_tolerance_deg: number;
  elements: ElementReport[];
  constraints: {
    max_velocity_meters_per_sec: ConstraintRangeReport[];
    max_acceleration_meters_per_sec2: ConstraintRangeReport[];
    max_velocity_deg_per_sec: ConstraintRangeReport[];
    max_acceleration_deg_per_sec2: ConstraintRangeReport[];
    end_translation_tolerance_meters: number | null;
    end_rotation_tolerance_deg: number | null;
  };
}

interface CompatibilityReport {
  globals: {
    default_max_velocity_meters_per_sec: number;
    default_max_acceleration_meters_per_sec2: number;
    default_intermediate_handoff_radius_meters: number;
    default_max_velocity_deg_per_sec: number;
    default_max_acceleration_deg_per_sec2: number;
    default_end_translation_tolerance_meters: number;
    default_end_rotation_tolerance_deg: number;
  };
  paths: PathReport[];
}

const defaultBLineLibDir = "/Users/edan/FRC/BLine-Lib";

describe("BLine-Lib IO compatibility", () => {
  it("loads BLine-Web exported autos folders through BLine-Lib JsonUtils", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "bline-web-lib-io-"));
    const autosDir = join(tempRoot, "autos");

    try {
      await writeAutosFolder(
        serializeBLineProjectFolder(createCompatibilityWorkspace()),
        autosDir,
      );
      const report = await runBLineLibValidation(autosDir, tempRoot);

      expect(report.globals).toEqual({
        default_max_velocity_meters_per_sec: 5.5,
        default_max_acceleration_meters_per_sec2: 11.2,
        default_intermediate_handoff_radius_meters: 0.27,
        default_max_velocity_deg_per_sec: 610,
        default_max_acceleration_deg_per_sec2: 1900,
        default_end_translation_tolerance_meters: 0.025,
        default_end_rotation_tolerance_deg: 1.8,
      });

      expect(report.paths.map((path) => path.file_name)).toEqual([
        "mixed_auto.json",
        "scalar_limits.json",
      ]);

      const mixed = requirePathReport(report, "mixed_auto.json");
      expect(mixed.valid).toBe(true);
      expect(mixed.elements.map((element) => element.type)).toEqual([
        "Waypoint",
        "EventTrigger",
        "RotationTarget",
        "TranslationTarget",
        "Waypoint",
      ]);
      expect(mixed.elements[0]?.translation_target).toMatchObject({
        x_meters: 1,
        y_meters: 2,
        intermediate_handoff_radius_meters: 0.31,
      });
      expect(mixed.elements[1]).toMatchObject({
        type: "EventTrigger",
        t_ratio: 0.25,
        lib_key: "intake",
      });
      expect(mixed.elements[2]).toMatchObject({
        type: "RotationTarget",
        t_ratio: 0.55,
        rotation_radians: 1.1,
        profiled_rotation: false,
      });
      expect(mixed.end_translation_tolerance_meters).toBeCloseTo(0.07);
      expect(mixed.end_rotation_tolerance_deg).toBeCloseTo(1.25);
      expect(mixed.constraints).toMatchObject({
        max_velocity_meters_per_sec: [
          { value: 2.2, start_ordinal: 0, end_ordinal: 1 },
        ],
        max_acceleration_meters_per_sec2: [
          { value: 3.4, start_ordinal: 1, end_ordinal: 2 },
        ],
        max_velocity_deg_per_sec: [
          { value: 520, start_ordinal: 0, end_ordinal: 1 },
        ],
        max_acceleration_deg_per_sec2: [
          { value: 1000, start_ordinal: 1, end_ordinal: 1 },
        ],
        end_translation_tolerance_meters: 0.07,
        end_rotation_tolerance_deg: 1.25,
      });

      const scalar = requirePathReport(report, "scalar_limits.json");
      expect(scalar.valid).toBe(true);
      expect(scalar.elements.map((element) => element.type)).toEqual([
        "Waypoint",
        "TranslationTarget",
        "RotationTarget",
        "Waypoint",
      ]);
      expect(scalar.constraints).toMatchObject({
        max_velocity_meters_per_sec: [
          { value: 3.3, start_ordinal: 0, end_ordinal: 2 },
        ],
        max_acceleration_meters_per_sec2: [
          { value: 4.4, start_ordinal: 0, end_ordinal: 2 },
        ],
        max_velocity_deg_per_sec: [
          { value: 500, start_ordinal: 0, end_ordinal: 2 },
        ],
        max_acceleration_deg_per_sec2: [
          { value: 900, start_ordinal: 0, end_ordinal: 2 },
        ],
        end_translation_tolerance_meters: 0.05,
        end_rotation_tolerance_deg: 2.5,
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }, 360_000);
});

function createCompatibilityWorkspace() {
  return createProjectWorkspaceDocument({
    project_id: "compat-workspace",
    display_name: "Compatibility Workspace",
    config: {
      gui: {
        robot: {
          length_meters: 0.8255,
          width_meters: 0.9779,
        },
        protrusions: {
          enabled: true,
          distance_meters: 0.3,
          side: "front",
          default_state: "hidden",
          show_on_event_keys: ["intake", "deploy"],
          hide_on_event_keys: ["stow"],
        },
      },
      kinematic_constraints: {
        default_max_velocity_meters_per_sec: 5.5,
        default_max_acceleration_meters_per_sec2: 11.2,
        default_intermediate_handoff_radius_meters: 0.27,
        default_max_velocity_deg_per_sec: 610,
        default_max_acceleration_deg_per_sec2: 1900,
        default_end_translation_tolerance_meters: 0.025,
        default_end_rotation_tolerance_deg: 1.8,
      },
    },
    paths: [
      createProjectPathDocument({
        path_id: "mixed",
        display_name: "Mixed Auto",
        file_name: "mixed_auto.json",
        path: createPathModel({
          constraints: createConstraints({
            end_translation_tolerance_meters: 0.07,
            end_rotation_tolerance_deg: 1.25,
          }),
          path_elements: [
            createWaypoint({
              translation_target: createTranslationTarget({
                x_meters: 1,
                y_meters: 2,
                intermediate_handoff_radius_meters: 0.31,
              }),
              rotation_target: createRotationTarget({
                rotation_radians: 0.2,
                profiled_rotation: true,
              }),
            }),
            createEventTrigger({ t_ratio: 0.25, lib_key: "intake" }),
            createRotationTarget({
              rotation_radians: 1.1,
              t_ratio: 0.55,
              profiled_rotation: false,
            }),
            createTranslationTarget({
              x_meters: 2.4,
              y_meters: 2.8,
              intermediate_handoff_radius_meters: 0.4,
            }),
            createWaypoint({
              translation_target: createTranslationTarget({
                x_meters: 3.2,
                y_meters: 3,
                intermediate_handoff_radius_meters: 0.22,
              }),
              rotation_target: createRotationTarget({
                rotation_radians: 2.2,
                profiled_rotation: true,
              }),
            }),
          ],
          ranged_constraints: [
            ranged("max_velocity_meters_per_sec", 2.2, 1, 2),
            ranged("max_acceleration_meters_per_sec2", 3.4, 2, 3),
            ranged("max_velocity_deg_per_sec", 520, 1, 2),
            ranged("max_acceleration_deg_per_sec2", 1000, 2, 2),
          ],
        }),
      }),
      createProjectPathDocument({
        path_id: "scalar",
        display_name: "Scalar Limits",
        file_name: "scalar_limits.json",
        path: createPathModel({
          constraints: createConstraints({
            max_velocity_meters_per_sec: 3.3,
            max_acceleration_meters_per_sec2: 4.4,
            max_velocity_deg_per_sec: 500,
            max_acceleration_deg_per_sec2: 900,
            end_translation_tolerance_meters: 0.05,
            end_rotation_tolerance_deg: 2.5,
          }),
          path_elements: [
            createWaypoint({
              translation_target: createTranslationTarget({
                x_meters: 0,
                y_meters: 0,
              }),
              rotation_target: createRotationTarget({ rotation_radians: 0 }),
            }),
            createTranslationTarget({ x_meters: 1, y_meters: 0 }),
            createRotationTarget({ rotation_radians: 1.5, t_ratio: 0.5 }),
            createWaypoint({
              translation_target: createTranslationTarget({
                x_meters: 2,
                y_meters: 1,
              }),
              rotation_target: createRotationTarget({ rotation_radians: 3.14 }),
            }),
          ],
        }),
      }),
    ],
    active_path_id: "mixed",
  });
}

function ranged(
  key: RangedConstraint["key"],
  value: number,
  start_ordinal: number,
  end_ordinal: number,
): RangedConstraint {
  return { key, value, start_ordinal, end_ordinal };
}

async function writeAutosFolder(
  folder: ProjectFolderExport,
  autosDir: string,
): Promise<void> {
  for (const file of folder.files) {
    const outputPath = join(autosDir, file.relativePath);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, await file.blob.text(), "utf8");
  }
}

async function runBLineLibValidation(
  autosDir: string,
  tempRoot: string,
): Promise<CompatibilityReport> {
  const blineLibDir = resolve(
    process.env.BLINE_LIB_DIR?.trim() || defaultBLineLibDir,
  );
  const gradleWrapper = join(
    blineLibDir,
    process.platform === "win32" ? "gradlew.bat" : "gradlew",
  );

  if (!existsSync(gradleWrapper)) {
    throw new Error(
      [
        `BLine-Lib Gradle wrapper was not found at ${gradleWrapper}.`,
        "Set BLINE_LIB_DIR to a BLine-Lib checkout, or let CI checkout edanliahovetsky/BLine-Lib into .ci/BLine-Lib.",
      ].join(" "),
    );
  }

  if (process.platform !== "win32") {
    chmodSync(gradleWrapper, 0o755);
  }

  const initScriptPath = join(tempRoot, "bline-lib-io.init.gradle");
  const reportPath = join(tempRoot, "bline-lib-io-report.json");
  await writeFile(initScriptPath, gradleInitScript(), "utf8");

  const result = spawnSync(
    gradleWrapper,
    [
      "--no-daemon",
      "-q",
      "-I",
      initScriptPath,
      "validateBLineWebAutos",
      `-PautosDir=${autosDir}`,
      `-PcompatReport=${reportPath}`,
    ],
    {
      cwd: blineLibDir,
      encoding: "utf8",
      timeout: 300_000,
    },
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      [
        "BLine-Lib IO compatibility validation failed.",
        result.stdout.trim(),
        result.stderr.trim(),
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  return JSON.parse(await readFile(reportPath, "utf8")) as CompatibilityReport;
}

function gradleInitScript(): string {
  return `
import groovy.json.JsonOutput
import java.net.URLClassLoader

allprojects { p ->
  p.afterEvaluate {
    p.tasks.register('validateBLineWebAutos') {
      dependsOn p.tasks.named('testClasses')
      doLast {
        def autosDir = new File(p.findProperty('autosDir') as String)
        def pathsDir = new File(autosDir, 'paths')
        def reportPath = new File(p.findProperty('compatReport') as String)

        if (!autosDir.isDirectory()) {
          throw new GradleException('Missing autos folder: ' + autosDir)
        }
        if (!pathsDir.isDirectory()) {
          throw new GradleException('Missing autos paths folder: ' + pathsDir)
        }

        def urls = p.sourceSets.test.runtimeClasspath.files.collect { it.toURI().toURL() } as URL[]
        def classLoader = new URLClassLoader(urls, ClassLoader.getSystemClassLoader())
        def jsonUtils = Class.forName('frc.robot.lib.BLine.JsonUtils', true, classLoader)
        def loadGlobalConstraints = jsonUtils.getMethod('loadGlobalConstraints', File.class)
        def loadPath = jsonUtils.getMethod('loadPath', File.class, String.class)

        def optionalValue = { optional -> optional.isPresent() ? optional.get() : null }
        def rangeReport = { optional ->
          optional.isPresent()
            ? optional.get().collect { range ->
                [
                  value: range.value(),
                  start_ordinal: range.startOrdinal(),
                  end_ordinal: range.endOrdinal()
                ]
              }
            : []
        }
        def translationReport = { target ->
          [
            x_meters: target.translation().getX(),
            y_meters: target.translation().getY(),
            intermediate_handoff_radius_meters: optionalValue(target.intermediateHandoffRadiusMeters())
          ]
        }
        def rotationReport = { target ->
          [
            rotation_radians: target.rotation().getRadians(),
            t_ratio: target.t_ratio(),
            profiled_rotation: target.profiledRotation()
          ]
        }
        def elementReport
        elementReport = { element ->
          def type = element.getClass().getSimpleName()
          if (type == 'Waypoint') {
            return [
              type: type,
              translation_target: translationReport(element.translationTarget()),
              rotation_target: rotationReport(element.rotationTarget())
            ]
          }
          if (type == 'TranslationTarget') {
            def report = translationReport(element)
            report.type = type
            return report
          }
          if (type == 'RotationTarget') {
            def report = rotationReport(element)
            report.type = type
            return report
          }
          if (type == 'EventTrigger') {
            return [
              type: type,
              t_ratio: element.t_ratio(),
              lib_key: element.libKey()
            ]
          }
          return [type: type]
        }

        def globals = loadGlobalConstraints.invoke(null, autosDir)
        def pathFiles = pathsDir.listFiles()
          .findAll { it.isFile() && it.name.toLowerCase().endsWith('.json') }
          .sort { it.name }

        def report = [
          globals: [
            default_max_velocity_meters_per_sec: globals.getMaxVelocityMetersPerSec(),
            default_max_acceleration_meters_per_sec2: globals.getMaxAccelerationMetersPerSec2(),
            default_intermediate_handoff_radius_meters: globals.getIntermediateHandoffRadiusMeters(),
            default_max_velocity_deg_per_sec: globals.getMaxVelocityDegPerSec(),
            default_max_acceleration_deg_per_sec2: globals.getMaxAccelerationDegPerSec2(),
            default_end_translation_tolerance_meters: globals.getEndTranslationToleranceMeters(),
            default_end_rotation_tolerance_deg: globals.getEndRotationToleranceDeg()
          ],
          paths: pathFiles.collect { file ->
            def path = loadPath.invoke(null, autosDir, file.name)
            def constraints = path.getPathConstraints()
            [
              file_name: file.name,
              valid: path.isValid(),
              end_translation_tolerance_meters: path.getEndTranslationToleranceMeters(),
              end_rotation_tolerance_deg: path.getEndRotationToleranceDeg(),
              elements: path.getPathElements().collect { elementReport(it) },
              constraints: [
                max_velocity_meters_per_sec: rangeReport(constraints.getMaxVelocityMetersPerSec()),
                max_acceleration_meters_per_sec2: rangeReport(constraints.getMaxAccelerationMetersPerSec2()),
                max_velocity_deg_per_sec: rangeReport(constraints.getMaxVelocityDegPerSec()),
                max_acceleration_deg_per_sec2: rangeReport(constraints.getMaxAccelerationDegPerSec2()),
                end_translation_tolerance_meters: optionalValue(constraints.getEndTranslationToleranceMeters()),
                end_rotation_tolerance_deg: optionalValue(constraints.getEndRotationToleranceDeg())
              ]
            ]
          }
        ]

        if (report.paths.isEmpty()) {
          throw new GradleException('No path JSON files loaded from: ' + pathsDir)
        }

        reportPath.parentFile.mkdirs()
        reportPath.text = JsonOutput.prettyPrint(JsonOutput.toJson(report))
      }
    }
  }
}
`;
}

function requirePathReport(
  report: CompatibilityReport,
  fileName: string,
): PathReport {
  const path = report.paths.find(
    (candidate) => candidate.file_name === fileName,
  );
  if (!path) {
    throw new Error(`Missing BLine-Lib compatibility report for ${fileName}`);
  }
  return path;
}
