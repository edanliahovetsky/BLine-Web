import {
  Application,
  Container,
  Graphics,
  Sprite,
  Texture,
  type Renderer,
} from "pixi.js";
import type {
  LinkedTargetKind,
  ProjectConfig,
} from "../../core/io/projectSchema";
import type {
  FieldImageKind,
  ResolvedFieldDefinition,
} from "../../core/field/fieldConfig";
import type { CurveAuthoringPreview } from "../curveAuthoring";
import { fieldImageUrl } from "../../platform/fieldImageUrl";
import {
  isEventTrigger,
  isRotationTarget,
  isTranslationTarget,
  isWaypoint,
  type PathModel,
  type PathElement,
} from "../../core/model/path";
import {
  anchorHandoffRadii,
  defaultHandoffRadiusMeters,
  type AnchorRadiusState,
} from "../../core/model/handoffRadii";
import type { SelectedRangedConstraint } from "../../state/selectionStore";
import { elementCircleRadiusMeters, elementOutlineMeters } from "../constants";
import {
  firstDomainIndexForConstraintRange,
  pathIndexesForConstraintRange,
} from "../constraintRange";
import { elementColors, handoffRingColors } from "../elementStyle";
import {
  clipStagePolyline,
  getElementHeadingRadians,
  getElementPosition,
  getRenderableElementPositions,
  fieldImageStageRect,
  isStagePointWithinCanvas,
  modelToStagePoint,
  type CanvasSize,
  type FieldViewport,
  type PositionOverrides,
  type RotationOverrides,
  type StagePoint,
} from "../geometry";
import { handoffRingRadiusPx } from "../handoffRadiusInteraction";
import {
  centeredRobotBounds,
  robotProtrusionBounds,
  robotProtrusionOutlineGeometry,
  robotSizeFromConfig,
  robotSizeToPixels,
  strokedRectInsideBounds,
  type RobotLocalBounds,
  type RobotProtrusionPathCommand,
  type RobotSizeMeters,
} from "../robotFootprint";
import {
  elementFootprintMetrics,
  eventMarkerMetrics,
  footprintOutlineCommands,
  robotFrontPoint,
  translationMarkerMetrics,
} from "../elementGeometry";
import { buildElementProtrusionVisibilityByIndex } from "../protrusionVisibility";
import type { SimResult } from "../../core/sim";
import type { SimulationTraceSample } from "../../core/sim/types";

export interface PixiRenderInput {
  stageSize: CanvasSize;
  viewport: FieldViewport;
  field: ResolvedFieldDefinition;
  path: PathModel | null;
  overlayPaths: PixiPathOverlay[];
  hoveredOverlayPathId: string | null;
  selectedElementIndex: number | null;
  selectedRangedConstraint: SelectedRangedConstraint | null;
  positionPreview: PositionOverrides;
  rotationPreview: RotationOverrides;
  selectedPulse: number;
  hideSelectionOutline?: boolean;
  simulationResult: SimResult | null;
  simulationTrace: readonly SimulationTraceSample[] | null;
  trajectoryMaxSpeedMps: number;
  simulationTimeS: number;
  simulationPlaying: boolean;
  simulationEventPulse: number;
  config: ProjectConfig | null;
  curvePreview: CurveAuthoringPreview | null;
  linkedTargets?: readonly PixiLinkedTargetOverlay[];
  selectedLinkedTargetId?: string | null;
  hoveredRotationIndex?: number | null;
  hoveredLinkedTargetRotationId?: string | null;
}

export interface PixiPathOverlay {
  pathId: string;
  displayName: string;
  path: PathModel;
}

export interface PixiLinkedTargetOverlay {
  target_id: string;
  display_name: string;
  kind: LinkedTargetKind;
  x_meters: number;
  y_meters: number;
  rotation_radians?: number | null;
  locked?: boolean;
  compatible?: boolean;
}

export interface PixiCanvasMetrics {
  canvasHeight: number;
  canvasWidth: number;
  cssHeight: number;
  cssWidth: number;
  ratio: number;
  renderer: string;
  renderCount: number;
  fieldDrawCount: number;
  overlayDrawCount: number;
}

interface RenderedSimulationRobot {
  lengthMeters: number;
  widthMeters: number;
  protrusionVisible: boolean;
  timeSeconds: number;
}

export interface PixiDebugApi {
  canvasMetrics(): PixiCanvasMetrics;
  fieldState(): {
    id: string;
    label: string;
    kind: FieldImageKind;
    imageLoaded: boolean;
    lengthMeters: number;
    widthMeters: number;
  };
  nodePosition(testId: string): StagePoint | null;
  simulationTrace(): readonly SimulationTraceSample[] | null;
  simulationRobot(): Readonly<RenderedSimulationRobot> | null;
}

export interface PixiDebugWindow extends Window {
  __blinePixiDebug?: PixiDebugApi;
}

export class PixiPathRenderer {
  private renderedSimulationRobot: RenderedSimulationRobot | null = null;
  private readonly app: Application<Renderer<HTMLCanvasElement>>;
  private readonly root = new Container();
  private readonly fieldGraphics = new Graphics();
  private readonly fieldSprite: Sprite;
  private readonly field: ResolvedFieldDefinition;
  private readonly overlayGraphics = new Graphics();
  private readonly pathGraphics = new Graphics();
  private readonly trajectoryGraphics = new Graphics();
  private readonly curvePreviewGraphics = new Graphics();
  private readonly constraintGraphics = new Graphics();
  private readonly nodeGraphics = new Graphics();
  private readonly linkedTargetGraphics = new Graphics();
  private readonly simulationGraphics = new Graphics();
  private readonly debugNodes = new Map<string, StagePoint>();
  // Viewports and overlay path arrays are immutable render inputs.
  private drawnFieldViewport: FieldViewport | null = null;
  private drawnOverlayViewport: FieldViewport | null = null;
  private drawnOverlayStageSize: CanvasSize | null = null;
  private drawnOverlayPaths: readonly PixiPathOverlay[] | null = null;
  private drawnHoveredOverlayPathId: string | null = null;
  private currentSimulationTrace: readonly SimulationTraceSample[] | null =
    null;
  private renderCount = 0;
  private fieldDrawCount = 0;
  private overlayDrawCount = 0;

  private constructor(
    app: Application<Renderer<HTMLCanvasElement>>,
    field: ResolvedFieldDefinition,
    fieldTexture: Texture | null,
  ) {
    this.app = app;
    // React handles canvas interaction; keep Pixi's default cursor from
    // overwriting the CSS rotation, placement, and pan cursors.
    this.app.renderer.events.cursorStyles.default = () => {};
    this.field = field;
    this.fieldSprite = new Sprite(fieldTexture ?? Texture.EMPTY);
    this.app.canvas.dataset.testid = "path-stage-pixi-canvas";
    this.app.canvas.dataset.rendererInstanceId = String(
      nextRendererInstanceId++,
    );
    this.app.canvas.setAttribute("aria-hidden", "true");
    this.app.stage.addChild(this.root);
    this.root.addChild(
      this.fieldGraphics,
      this.fieldSprite,
      this.overlayGraphics,
      this.pathGraphics,
      this.trajectoryGraphics,
      this.curvePreviewGraphics,
      this.nodeGraphics,
      // Keep the selected range highlight above the first path element.
      this.constraintGraphics,
      this.linkedTargetGraphics,
      this.simulationGraphics,
    );
  }

  static async create(
    stageSize: CanvasSize,
    field: ResolvedFieldDefinition,
  ): Promise<PixiPathRenderer> {
    const resolution = getPixiResolution();
    const app = new Application<Renderer<HTMLCanvasElement>>();
    await app.init({
      width: Math.max(1, stageSize.width),
      height: Math.max(1, stageSize.height),
      preference: ["webgl"],
      autoDensity: true,
      resolution,
      antialias: true,
      autoStart: false,
      backgroundAlpha: 0,
      clearBeforeRender: true,
      powerPreference: "high-performance",
    });
    app.ticker.stop();
    const texture =
      field.kind === "image" && field.image_src
        ? await loadFieldTexture(fieldImageUrl(field.image_src))
        : null;
    return new PixiPathRenderer(app, field, texture);
  }

  get canvas(): HTMLCanvasElement {
    return this.app.canvas;
  }

  update(input: PixiRenderInput): void {
    this.currentSimulationTrace = input.simulationTrace;
    this.resize(input.stageSize);
    this.debugNodes.clear();
    if (this.drawnFieldViewport !== input.viewport) {
      this.drawField(input.viewport);
      this.drawnFieldViewport = input.viewport;
    }
    if (
      this.drawnOverlayViewport !== input.viewport ||
      this.drawnOverlayStageSize?.width !== input.stageSize.width ||
      this.drawnOverlayStageSize?.height !== input.stageSize.height ||
      this.drawnOverlayPaths !== input.overlayPaths ||
      this.drawnHoveredOverlayPathId !== input.hoveredOverlayPathId
    ) {
      this.drawOverlayPaths(input);
      this.drawnOverlayViewport = input.viewport;
      // Ghost paths clip to canvas bounds even when the viewport is unchanged.
      this.drawnOverlayStageSize = { ...input.stageSize };
      this.drawnOverlayPaths = input.overlayPaths;
      this.drawnHoveredOverlayPathId = input.hoveredOverlayPathId;
    }
    this.drawPath(input);
    this.drawTrajectory(input);
    this.drawCurvePreview(input);
    this.drawConstraintHighlights(input);
    this.drawNodes(input);
    this.drawLinkedTargets(input);
    this.recordRotationHandles(input);
    this.drawSimulation(input);
    this.render();
  }

  getDebugApi(): PixiDebugApi {
    return {
      canvasMetrics: () => this.canvasMetrics(),
      fieldState: () => ({
        id: this.field.id,
        label: this.field.label,
        kind: this.field.kind,
        lengthMeters: this.field.geometry.length_meters,
        widthMeters: this.field.geometry.width_meters,
        imageLoaded:
          this.field.kind === "image" &&
          this.fieldSprite.texture !== Texture.EMPTY,
      }),
      nodePosition: (testId) => this.debugNodes.get(testId) ?? null,
      simulationTrace: () => this.currentSimulationTrace,
      simulationRobot: () => this.renderedSimulationRobot,
    };
  }

  destroy(): void {
    this.app.destroy({ removeView: true }, { children: true });
  }

  private resize(stageSize: CanvasSize): void {
    const width = Math.max(1, stageSize.width);
    const height = Math.max(1, stageSize.height);
    const resolution = getPixiResolution();
    if (
      this.app.renderer.screen.width !== width ||
      this.app.renderer.screen.height !== height ||
      this.app.renderer.resolution !== resolution
    ) {
      this.app.renderer.resize(width, height, resolution);
    }
  }

  private render(): void {
    this.app.render();
    this.renderCount += 1;
  }

  private canvasMetrics(): PixiCanvasMetrics {
    const rect = this.canvas.getBoundingClientRect();
    return {
      canvasHeight: this.canvas.height,
      canvasWidth: this.canvas.width,
      cssHeight: rect.height,
      cssWidth: rect.width,
      ratio:
        rect.width > 0
          ? Number((this.canvas.width / rect.width).toFixed(2))
          : 0,
      renderer: this.app.renderer.name,
      renderCount: this.renderCount,
      fieldDrawCount: this.fieldDrawCount,
      overlayDrawCount: this.overlayDrawCount,
    };
  }

  private drawField(viewport: FieldViewport): void {
    this.fieldDrawCount += 1;
    this.fieldGraphics
      .clear()
      .rect(viewport.x, viewport.y, viewport.width, viewport.height)
      .fill({ color: 0x101416 });

    if (this.field.kind === "grid") {
      this.fieldSprite.visible = false;
      this.drawBlankGrid(viewport);
      return;
    }

    if (
      this.fieldSprite.texture.width > 0 &&
      this.fieldSprite.texture.height > 0
    ) {
      const rect = fieldImageStageRect(viewport);
      this.fieldSprite.visible = true;
      // Field geometry defines the image's calibrated coordinate rectangle.
      // Drawing into that exact rectangle keeps paths and pixels aligned even
      // when an uncalibrated upload has a different source aspect ratio.
      this.fieldSprite.x = rect.x;
      this.fieldSprite.y = rect.y;
      this.fieldSprite.width = rect.width;
      this.fieldSprite.height = rect.height;
    } else {
      this.fieldSprite.visible = false;
    }
  }

  private drawBlankGrid(viewport: FieldViewport): void {
    const graphics = this.fieldGraphics;
    graphics
      .rect(viewport.x, viewport.y, viewport.width, viewport.height)
      .fill({ color: 0x10161d });

    const minorStepMeters = 0.5;
    const majorEvery = 1;
    const epsilon = 0.0001;

    for (let index = 1; ; index += 1) {
      const xMeters = index * minorStepMeters;
      if (xMeters >= viewport.field.length_meters - epsilon) {
        break;
      }
      const x = viewport.x + xMeters * viewport.scale;
      const major = isWholeMultiple(xMeters, majorEvery, epsilon);
      graphics
        .moveTo(x, viewport.y)
        .lineTo(x, viewport.y + viewport.height)
        .stroke({
          color: major ? 0x8ea0b2 : 0x344453,
          width: major ? 1.5 : 0.75,
          alpha: major ? 0.7 : 0.58,
        });
    }

    for (let index = 1; ; index += 1) {
      const yMeters = index * minorStepMeters;
      if (yMeters >= viewport.field.width_meters - epsilon) {
        break;
      }
      const y = viewport.y + yMeters * viewport.scale;
      const major = isWholeMultiple(yMeters, majorEvery, epsilon);
      graphics
        .moveTo(viewport.x, y)
        .lineTo(viewport.x + viewport.width, y)
        .stroke({
          color: major ? 0x8ea0b2 : 0x344453,
          width: major ? 1.5 : 0.75,
          alpha: major ? 0.7 : 0.58,
        });
    }

    graphics
      .rect(viewport.x, viewport.y, viewport.width, viewport.height)
      .stroke({ color: 0x657789, width: 2, alpha: 0.72 });
  }

  private drawPath(input: PixiRenderInput): void {
    const graphics = this.pathGraphics.clear();
    const elements = input.path?.path_elements;
    if (!elements) {
      return;
    }

    const points = getRenderableElementPositions(
      elements,
      input.positionPreview,
    ).map(({ position }) => modelToStagePoint(position, input.viewport));
    if (points.length < 2) {
      return;
    }

    drawClippedPolyline(graphics, points, input.stageSize, {
      color: 0x05090c,
      width: 8,
      alpha: 0.82,
    });
    drawClippedPolyline(graphics, points, input.stageSize, {
      color: 0xd7dde3,
      width: 2.75,
      alpha: 0.94,
    });
  }

  private drawOverlayPaths(input: PixiRenderInput): void {
    this.overlayDrawCount += 1;
    const graphics = this.overlayGraphics.clear();
    for (const overlay of input.overlayPaths) {
      const points = getRenderableElementPositions(
        overlay.path.path_elements,
      ).map(({ position }) => modelToStagePoint(position, input.viewport));
      if (points.length < 2) {
        continue;
      }

      const hovered = overlay.pathId === input.hoveredOverlayPathId;
      drawClippedPolyline(graphics, points, input.stageSize, {
        color: 0x071016,
        width: hovered ? 11 : 8,
        alpha: hovered ? 0.7 : 0.46,
      });
      drawClippedPolyline(graphics, points, input.stageSize, {
        color: hovered ? 0x62d6ff : 0x7d8c98,
        width: hovered ? 3.4 : 2.4,
        alpha: hovered ? 0.9 : 0.56,
      });
    }
  }

  private drawTrajectory(input: PixiRenderInput): void {
    const graphics = this.trajectoryGraphics.clear();
    const trace = input.simulationTrace;

    if (trace && trace.length >= 2 && input.path) {
      const maxSpeed = Math.max(0.1, input.trajectoryMaxSpeedMps);
      const points: Array<{ x: number; y: number; bucket: number }> = [];
      let lastPoint: StagePoint | null = null;
      for (const sample of trace) {
        if (sample.time_s > input.simulationTimeS) {
          break;
        }
        const point = modelToStagePoint(
          { x_meters: sample.x_m, y_meters: sample.y_m },
          input.viewport,
        );
        if (
          lastPoint &&
          Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y) <
            trajectoryMinSegmentPx
        ) {
          continue;
        }
        const ratio = Math.max(0, Math.min(1, sample.speed_mps / maxSpeed));
        points.push({
          x: point.x,
          y: point.y,
          bucket: Math.min(
            trajectorySpeedBuckets - 1,
            Math.floor(ratio * trajectorySpeedBuckets),
          ),
        });
        lastPoint = point;
      }

      if (points.length >= 2) {
        drawPolyline(
          graphics,
          points.flatMap((point) => [point.x, point.y]),
          { color: 0x05080b, width: 7.5, alpha: 0.55 },
        );

        let runStart = 0;
        for (let index = 1; index <= points.length; index += 1) {
          if (
            index !== points.length &&
            points[index].bucket === points[runStart].bucket
          ) {
            continue;
          }
          const run = points.slice(
            runStart,
            Math.min(index + 1, points.length),
          );
          drawPolyline(
            graphics,
            run.flatMap((point) => [point.x, point.y]),
            {
              color: trajectorySpeedColor(
                points[runStart].bucket / (trajectorySpeedBuckets - 1),
              ),
              width: 3.2,
              alpha: 0.95,
            },
          );
          runStart = index;
        }
      }
    }
  }

  private drawCurvePreview(input: PixiRenderInput): void {
    const graphics = this.curvePreviewGraphics.clear();
    const preview = input.curvePreview;
    if (!preview) {
      return;
    }

    const rawPoints = preview.rawPoints.flatMap((position) => {
      const point = modelToStagePoint(position, input.viewport);
      return [point.x, point.y];
    });
    const targetPoints = preview.targetPoints.flatMap((position) => {
      const point = modelToStagePoint(position, input.viewport);
      return [point.x, point.y];
    });

    if (rawPoints.length >= 4) {
      drawPolyline(graphics, rawPoints, {
        color: 0x05080b,
        width: 7,
        alpha: 0.72,
      });
      drawPolyline(graphics, rawPoints, {
        color: 0x51d6ff,
        width: 2.5,
        alpha: 0.74,
      });
    }

    if (targetPoints.length >= 4) {
      drawPolyline(graphics, targetPoints, {
        color: 0x05080b,
        width: 9,
        alpha: 0.8,
      });
      drawPolyline(graphics, targetPoints, {
        color: 0xffc857,
        width: 3.25,
        alpha: 0.96,
      });
    }

    for (const position of preview.targetPoints) {
      const point = modelToStagePoint(position, input.viewport);
      graphics
        .circle(point.x, point.y, 7)
        .fill({ color: 0x11171c, alpha: 0.96 })
        .stroke({ color: 0xffc857, width: 2 });
      graphics
        .circle(point.x, point.y, 2.4)
        .fill({ color: 0xfff8dc, alpha: 0.98 });
    }
  }

  private drawConstraintHighlights(input: PixiRenderInput): void {
    const graphics = this.constraintGraphics.clear();
    const { config, path, selectedRangedConstraint } = input;
    if (!path || !config || !selectedRangedConstraint) {
      return;
    }

    const selectedConstraint =
      path.ranged_constraints[selectedRangedConstraint.index];
    if (
      !selectedConstraint ||
      selectedConstraint.key !== selectedRangedConstraint.key
    ) {
      return;
    }

    const constraint = {
      ...selectedConstraint,
      start_ordinal: selectedRangedConstraint.startOrdinal,
      end_ordinal: selectedRangedConstraint.endOrdinal,
    };
    const elements = path.path_elements;
    const covered = pathIndexesForConstraintRange(elements, constraint).flatMap(
      (index) => {
        const position = getElementPosition(
          elements,
          index,
          input.positionPreview,
        );
        return position ? [modelToStagePoint(position, input.viewport)] : [];
      },
    );
    if (covered.length >= 2) {
      drawClippedPolyline(graphics, covered, input.stageSize, {
        color: constraintHighlightColor,
        width: 4,
        alpha: 0.96,
      });
    }

    const firstDomainIndex = firstDomainIndexForConstraintRange(
      elements,
      constraint,
    );
    const firstPosition =
      firstDomainIndex === null
        ? null
        : getElementPosition(elements, firstDomainIndex, input.positionPreview);
    if (firstDomainIndex === null || !firstPosition) {
      return;
    }

    const element = elements[firstDomainIndex];
    const point = modelToStagePoint(firstPosition, input.viewport);
    const headingRadians = getElementHeadingRadians(
      elements,
      firstDomainIndex,
      input.rotationPreview,
      input.positionPreview,
    );
    const robotSize = robotSizeFromConfig(config);
    drawConstraintStartHighlight(
      graphics,
      element,
      point,
      headingRadians,
      robotSize,
      input.viewport.scale,
    );
  }

  private drawNodes(input: PixiRenderInput): void {
    const graphics = this.nodeGraphics.clear();
    const { config, path } = input;
    if (!path || !config) {
      return;
    }

    const elements = path.path_elements;
    const handoffRadiusByElementIndex = new Map(
      anchorHandoffRadii(elements, defaultHandoffRadiusMeters(config)).map(
        (radius) => [radius.elementIndex, radius],
      ),
    );
    const robotSize = robotSizeFromConfig(config);
    const protrusions = config.gui.protrusions;
    const protrusionVisibilityByIndex = buildElementProtrusionVisibilityByIndex(
      elements,
      config,
      input.positionPreview,
    );
    const renderedNodes = elements.flatMap((element, index) => {
      const position = getElementPosition(
        elements,
        index,
        input.positionPreview,
      );
      return position ? [{ element, index, position }] : [];
    });
    const orderedNodes =
      input.selectedElementIndex === null
        ? renderedNodes
        : [
            ...renderedNodes.filter(
              ({ index }) => index !== input.selectedElementIndex,
            ),
            ...renderedNodes.filter(
              ({ index }) => index === input.selectedElementIndex,
            ),
          ];
    const hasSelection = input.selectedElementIndex !== null;

    for (const { element, index, position } of orderedNodes) {
      const point = modelToStagePoint(position, input.viewport);
      const handoffRadius = handoffRadiusByElementIndex.get(index);
      const node: DrawNodeInput = {
        element,
        index,
        point,
        selected: input.selectedElementIndex === index,
        hideSelectionOutline: input.hideSelectionOutline ?? false,
        dimmed: hasSelection && input.selectedElementIndex !== index,
        selectedPulse: input.selectedPulse,
        rotationHovered: input.hoveredRotationIndex === index,
        headingRadians: getElementHeadingRadians(
          elements,
          index,
          input.rotationPreview,
          input.positionPreview,
        ),
        handoffRadiusMeters:
          handoffRadius && !handoffRadius.inert
            ? handoffRadius.effectiveValueMeters
            : null,
        handoffRadiusState:
          handoffRadius && !handoffRadius.inert ? handoffRadius.state : null,
        robotSizeMeters: robotSize,
        metersToPixels: input.viewport.scale,
        protrusionVisible:
          Boolean(protrusions.enabled) &&
          Boolean(protrusionVisibilityByIndex.get(index)) &&
          protrusions.distance_meters > 0 &&
          protrusions.side !== "none",
        protrusionDistanceMeters: protrusions.distance_meters,
        protrusionSide: protrusions.side,
      };
      if (
        !isStagePointWithinCanvas(
          point,
          input.stageSize,
          nodeVisibilityMargin(node),
        )
      ) {
        continue;
      }
      this.debugNodes.set(`path-element-node-${index}`, point);
      if (isWaypoint(element) || isRotationTarget(element)) {
        this.debugNodes.set(
          `path-element-front-${index}`,
          robotFrontPoint(
            point,
            robotSize.lengthMeters * input.viewport.scale,
            getElementHeadingRadians(
              elements,
              index,
              input.rotationPreview,
              input.positionPreview,
            ) ?? 0,
            frontOutlineInset(
              robotSize,
              input.viewport.scale,
              input.hoveredRotationIndex === index,
              isWaypoint(element),
            ),
          ),
        );
      }
      drawPathElementNode(graphics, node);
    }
  }

  private drawLinkedTargets(input: PixiRenderInput): void {
    const graphics = this.linkedTargetGraphics.clear();
    const targets = input.linkedTargets ?? [];
    if (targets.length === 0) {
      return;
    }

    const selectedTargetId = input.selectedLinkedTargetId ?? null;
    const hasSelection = selectedTargetId !== null;
    const robotSize = robotSizeFromConfig(input.config);
    const orderedTargets =
      selectedTargetId === null
        ? targets
        : [
            ...targets.filter(
              (target) => target.target_id !== selectedTargetId,
            ),
            ...targets.filter(
              (target) => target.target_id === selectedTargetId,
            ),
          ];

    for (const [index, target] of orderedTargets.entries()) {
      const point = modelToStagePoint(
        {
          x_meters: target.x_meters,
          y_meters: target.y_meters,
        },
        input.viewport,
      );
      const selected = target.target_id === selectedTargetId;
      this.debugNodes.set(`linked-target-${target.target_id}`, point);
      if (target.kind === "waypoint") {
        this.debugNodes.set(
          `linked-target-front-${target.target_id}`,
          robotFrontPoint(
            point,
            robotSize.lengthMeters * input.viewport.scale,
            target.rotation_radians ?? 0,
            frontOutlineInset(
              robotSize,
              input.viewport.scale,
              input.hoveredLinkedTargetRotationId === target.target_id,
              true,
            ),
          ),
        );
      }
      drawPathElementNode(graphics, {
        element: linkedTargetToPathElement(target),
        index,
        point,
        selected,
        hideSelectionOutline: input.hideSelectionOutline ?? false,
        dimmed: target.compatible === false || (hasSelection && !selected),
        selectedPulse: input.selectedPulse,
        rotationHovered:
          input.hoveredLinkedTargetRotationId === target.target_id,
        headingRadians:
          target.kind === "waypoint" ? (target.rotation_radians ?? 0) : 0,
        handoffRadiusMeters: null,
        handoffRadiusState: null,
        robotSizeMeters: robotSize,
        metersToPixels: input.viewport.scale,
        protrusionVisible: false,
        protrusionDistanceMeters: 0,
        protrusionSide: "none",
      });
    }
  }

  private recordRotationHandles(input: PixiRenderInput): void {
    const record = (nodeId: string, frontId: string, handleId: string) => {
      const center = this.debugNodes.get(nodeId);
      const front = this.debugNodes.get(frontId);
      if (center && front) {
        this.debugNodes.set(`${handleId}-root`, center);
        this.debugNodes.set(handleId, front);
      }
    };
    if (input.selectedElementIndex !== null) {
      record(
        `path-element-node-${input.selectedElementIndex}`,
        `path-element-front-${input.selectedElementIndex}`,
        "rotation-handle",
      );
    }
    if (input.selectedLinkedTargetId) {
      record(
        `linked-target-${input.selectedLinkedTargetId}`,
        `linked-target-front-${input.selectedLinkedTargetId}`,
        "linked-target-rotation-handle",
      );
    }
  }

  private drawSimulation(input: PixiRenderInput): void {
    this.renderedSimulationRobot = null;
    const graphics = this.simulationGraphics.clear();
    const result = input.simulationResult;
    if (!result || result.times_sorted.length === 0) {
      return;
    }

    const pose = poseAtOrBefore(result, input.simulationTimeS);
    const robotVisible =
      input.simulationPlaying || input.simulationTimeS > 1e-6;
    if (!robotVisible || !pose) {
      return;
    }

    const robotPoint = modelToStagePoint(
      { x_meters: pose[0], y_meters: pose[1] },
      input.viewport,
    );
    const robotSize = robotSizeFromConfig(input.config);
    const { lengthPx, widthPx } = robotSizeToPixels(
      robotSize,
      input.viewport.scale,
    );
    const protrusions = input.config?.gui.protrusions;
    const timelineProtrusionVisible = protrusionVisibleAtOrBefore(
      result,
      input.simulationTimeS,
    );
    const protrusionVisible =
      Boolean(protrusions?.enabled) &&
      (timelineProtrusionVisible ?? protrusions?.default_state === "shown") &&
      (protrusions?.distance_meters ?? 0) > 0 &&
      protrusions?.side !== "none";
    this.renderedSimulationRobot = {
      lengthMeters: input.config?.gui.robot.length_meters ?? 0.8,
      widthMeters: input.config?.gui.robot.width_meters ?? 0.8,
      protrusionVisible,
      timeSeconds: input.simulationTimeS,
    };
    this.debugNodes.set("simulation-robot", robotPoint);
    drawSimulationRobot(
      graphics,
      lengthPx,
      widthPx,
      { x: robotPoint.x, y: robotPoint.y, rotation: -pose[2] },
      input.simulationEventPulse,
      protrusionVisible,
      (protrusions?.distance_meters ?? 0) * input.viewport.scale,
      protrusions?.side ?? "none",
    );
  }
}

function linkedTargetToPathElement(
  target: PixiLinkedTargetOverlay,
): PathElement {
  if (target.kind === "translation") {
    return {
      type: "translation",
      x_meters: target.x_meters,
      y_meters: target.y_meters,
      intermediate_handoff_radius_meters: null,
    };
  }

  return {
    type: "waypoint",
    translation_target: {
      type: "translation",
      x_meters: target.x_meters,
      y_meters: target.y_meters,
      intermediate_handoff_radius_meters: null,
    },
    rotation_target: {
      type: "rotation",
      rotation_radians: target.rotation_radians ?? 0,
      t_ratio: 0,
      profiled_rotation: true,
      legacy_position: null,
      legacy_converted: false,
    },
  };
}

interface DrawNodeInput {
  element: PathElement;
  index: number;
  point: StagePoint;
  selected: boolean;
  hideSelectionOutline: boolean;
  dimmed: boolean;
  selectedPulse: number;
  rotationHovered: boolean;
  headingRadians: number | null;
  handoffRadiusMeters: number | null;
  handoffRadiusState: AnchorRadiusState | null;
  robotSizeMeters: RobotSizeMeters;
  metersToPixels: number;
  protrusionVisible: boolean;
  protrusionDistanceMeters: number;
  protrusionSide: "front" | "back" | "left" | "right" | "none";
}

interface LocalTransform {
  x: number;
  y: number;
  rotation: number;
}

function drawHandoffRadiusRing(
  graphics: Graphics,
  point: StagePoint,
  input: {
    radiusPx: number;
    state: AnchorRadiusState;
    selected: boolean;
    opacity: number;
  },
): void {
  const color = handoffRingColors[input.state];
  const alpha = (input.selected ? 0.98 : 0.82) * input.opacity;
  const width =
    (input.state === "manual" ? 1.9 : 1.45) + (input.selected ? 0.45 : 0);
  const shadowStyle = {
    color: 0x05080b,
    width: width + 2.55,
    alpha: 0.82 * input.opacity,
  };
  const ringStyle = { color, width, alpha };

  if (input.state === "manual") {
    graphics
      .circle(point.x, point.y, input.radiusPx)
      .stroke(shadowStyle)
      .circle(point.x, point.y, input.radiusPx)
      .stroke(ringStyle);
    return;
  }

  drawDashedCircle(graphics, point.x, point.y, input.radiusPx, shadowStyle);
  drawDashedCircle(graphics, point.x, point.y, input.radiusPx, ringStyle);
}

/** Conservative bounds include all visible marks, even when the center is offscreen. */
function nodeVisibilityMargin(input: DrawNodeInput): number {
  const scale = input.metersToPixels;
  let radius: number;
  if (isWaypoint(input.element) || isRotationTarget(input.element)) {
    const width = input.robotSizeMeters.lengthMeters * scale;
    const height = input.robotSizeMeters.widthMeters * scale;
    const bounds = robotVisualBounds(
      width,
      height,
      input.protrusionVisible,
      Math.max(0, input.protrusionDistanceMeters) * scale,
      input.protrusionSide,
    );
    const padding =
      Math.max(6, elementFootprintMetrics(width, height).frontRadius + 2) + 2;
    // A circle around the farthest local corner covers every heading.
    radius = Math.hypot(
      Math.max(Math.abs(bounds.x), Math.abs(bounds.x + bounds.width)) + padding,
      Math.max(Math.abs(bounds.y), Math.abs(bounds.y + bounds.height)) +
        padding,
    );
  } else if (isTranslationTarget(input.element)) {
    const marker = translationMarkerMetrics(scale);
    radius = marker.outerRadius + marker.selectionPadding + 3;
  } else {
    radius = Math.hypot(Math.abs(eventTriggerPoints(scale, 0)[0]) + 5, 7) + 2;
  }
  return Math.max(
    radius,
    input.handoffRadiusMeters && input.handoffRadiusState
      ? handoffRingRadiusPx(input.handoffRadiusMeters, scale) + 3
      : 0,
  );
}

function drawPathElementNode(graphics: Graphics, input: DrawNodeInput): void {
  const opacity = input.dimmed ? 0.58 : 1;
  const showSelectionOutline = input.selected && !input.hideSelectionOutline;
  const selectionOpacity = (0.46 + input.selectedPulse * 0.34) * opacity;
  const point = input.point;
  const width = input.robotSizeMeters.lengthMeters * input.metersToPixels;
  const height = input.robotSizeMeters.widthMeters * input.metersToPixels;
  const metrics = elementFootprintMetrics(width, height);
  const protrusionDistancePx =
    Math.max(0, input.protrusionDistanceMeters) * input.metersToPixels;
  const showProtrusion =
    input.protrusionVisible &&
    protrusionDistancePx > 0 &&
    input.protrusionSide !== "none";
  const transform = {
    x: point.x,
    y: point.y,
    rotation: toStageRadians(input.headingRadians),
  };

  if (input.handoffRadiusMeters && input.handoffRadiusState) {
    drawHandoffRadiusRing(graphics, point, {
      radiusPx: handoffRingRadiusPx(
        input.handoffRadiusMeters,
        input.metersToPixels,
      ),
      state: input.handoffRadiusState,
      selected: input.selected,
      opacity,
    });
  }

  if (isTranslationTarget(input.element)) {
    const { radius, borderWidth, outerRadius, selectionPadding } =
      translationMarkerMetrics(input.metersToPixels);
    if (showSelectionOutline) {
      // Translation targets alone use a circular selection outline.
      graphics.circle(point.x, point.y, outerRadius + selectionPadding).stroke({
        color: selectionBackingColor,
        width: selectionStrokeWidthPx + 2,
        alpha: 0.9,
      });
      graphics.circle(point.x, point.y, outerRadius + selectionPadding).stroke({
        color: elementColors.selected,
        width: selectionStrokeWidthPx,
        alpha: selectionOpacity,
      });
    }
    drawOutlinedDot(
      graphics,
      point,
      outerRadius,
      elementColors.translation,
      opacity,
      borderWidth,
    );
    graphics
      .circle(point.x, point.y, radius * 0.32)
      .fill({ color: 0x11151a, alpha: 0.35 * opacity });
    return;
  }

  if (isWaypoint(input.element) || isRotationTarget(input.element)) {
    if (showSelectionOutline) {
      drawSelectionFootprint(
        graphics,
        transform,
        width,
        height,
        Math.max(6, metrics.frontRadius + 2),
        showProtrusion,
        protrusionDistancePx,
        input.protrusionSide,
        selectionOpacity,
      );
    }
    drawRobotFootprint(
      graphics,
      transform,
      width,
      height,
      isWaypoint(input.element)
        ? elementColors.waypoint
        : elementColors.rotation,
      isWaypoint(input.element)
        ? waypointOutlineWidth(input.metersToPixels)
        : metrics.strokeWidth,
      isWaypoint(input.element) ? "waypoint" : "rotation",
      showProtrusion,
      protrusionDistancePx,
      input.protrusionSide,
      opacity,
      input.rotationHovered,
    );
    return;
  }

  if (isEventTrigger(input.element)) {
    const marker = eventMarkerMetrics(input.metersToPixels);
    const points = eventTriggerPoints(input.metersToPixels, 0);
    const { halfLength, selectionPadding } = marker;
    if (showSelectionOutline) {
      drawSelectionOutline(
        graphics,
        {
          x: -halfLength - selectionPadding,
          y: -marker.centerRadius - selectionPadding,
          width: 2 * (halfLength + selectionPadding),
          height: 2 * (marker.centerRadius + selectionPadding),
        },
        transform,
        selectionOpacity,
      );
    }
    drawLocalPolyline(
      graphics,
      points,
      {
        color: elementOutlineColor,
        width: marker.outlineWidth,
        alpha: 0.95 * opacity,
      },
      transform,
    );
    drawLocalPolyline(
      graphics,
      points,
      { color: elementColors.event, width: marker.strokeWidth, alpha: opacity },
      transform,
    );
    drawOutlinedDot(
      graphics,
      point,
      marker.centerRadius,
      elementColors.event,
      opacity,
      marker.centerBorderWidth,
    );
  }
}

const elementOutlineColor = 0x000000;
const elementOutlineWidthPx = 0.8;

// Restore the original elements' visual weight as the canvas zooms.
function waypointOutlineWidth(metersToPixels: number): number {
  return Math.max(1.65, elementOutlineMeters * metersToPixels);
}

function drawOutlinedDot(
  graphics: Graphics,
  point: StagePoint,
  radius: number,
  accent: string | number,
  opacity: number,
  borderWidth = elementOutlineWidthPx,
): void {
  graphics
    .circle(point.x, point.y, radius)
    .fill({ color: elementOutlineColor, alpha: 0.95 * opacity });
  graphics
    .circle(point.x, point.y, Math.max(0, radius - borderWidth))
    .fill({ color: accent, alpha: opacity });
}

function drawRobotFootprint(
  graphics: Graphics,
  transform: LocalTransform,
  width: number,
  height: number,
  accent: string | number,
  bodyStrokeWidth: number,
  mode: "waypoint" | "rotation" | "simulation",
  protrusionVisible: boolean,
  protrusionDistancePx: number,
  protrusionSide: DrawNodeInput["protrusionSide"],
  opacity: number,
  rotationHovered = false,
  eventPulse = 0,
): void {
  const metrics = elementFootprintMetrics(width, height);
  const outlineAccent =
    mode === "simulation"
      ? mixRgbColor(simulationOutlineColor, simulationEventColor, eventPulse)
      : accent;
  const outlineOpacity = mode === "simulation" ? 1 : opacity;
  const outlineWidth = bodyStrokeWidth + (rotationHovered ? 0.6 : 0);
  const bounds = centeredRobotBounds(width, height);
  const backing = strokedRectInsideBounds(
    bounds,
    outlineWidth + 2 * elementOutlineWidthPx,
  );
  // A quadratic corner's tightest radius is cornerRadius / sqrt(2).
  // Keep it wider than half the stroke so Pixi's inner edge cannot fold
  // over itself and blend a bright wedge at high zoom.
  const cornerRadius = Math.max(
    metrics.cornerRadius,
    backing.strokeWidth / Math.SQRT2 + 0.5,
  );
  // One shared centerline leaves black visible on both sides of the color,
  // with the outer black edge still exactly on the bumper bounds.
  const outline = {
    rect: backing.rect,
    strokeWidth: Math.min(outlineWidth, backing.strokeWidth),
  };
  const extension = robotProtrusionBounds({
    lengthPx: width,
    widthPx: height,
    protrusionVisible,
    protrusionDistancePx,
    protrusionSide,
  });
  // Finish every fill before drawing the body and protrusion outlines.
  if (mode === "simulation") {
    drawSimulationFill(
      graphics,
      footprintOutlineCommands(
        backing.rect,
        cornerRadius,
        0,
        extension ? protrusionSide : "none",
      ),
      transform,
      accent,
      eventPulse,
    );
    if (extension) {
      const extensionFill = robotProtrusionOutlineGeometry({
        lengthPx: width,
        widthPx: height,
        protrusionVisible: true,
        protrusionDistancePx,
        protrusionSide,
        strokeWidth: backing.strokeWidth,
        cornerRadiusPx: robotCornerRadius(width, height),
        rootInsetPx: backing.strokeWidth / 2,
        rootCornerRadiusPx: 0,
      });
      if (extensionFill)
        drawSimulationFill(
          graphics,
          extensionFill.pathCommands,
          transform,
          accent,
          eventPulse,
        );
    }
  } else if (extension) {
    drawRect(
      graphics,
      extension,
      { fill: accent, fillAlpha: 0.06 * opacity },
      transform,
    );
  }
  if (extension) {
    drawRobotProtrusionOutline(graphics, transform, width, height, {
      protrusionDistancePx,
      protrusionSide,
      strokeWidth: bodyStrokeWidth + 2 * elementOutlineWidthPx,
      color: elementOutlineColor,
      alpha: 0.95 * outlineOpacity,
    });
    drawRobotProtrusionOutline(graphics, transform, width, height, {
      protrusionDistancePx,
      protrusionSide,
      strokeWidth: bodyStrokeWidth,
      backingWidth: bodyStrokeWidth + 2 * elementOutlineWidthPx,
      color: outlineAccent,
      alpha: outlineOpacity,
    });
  }
  const commands = footprintOutlineCommands(
    outline.rect,
    cornerRadius,
    metrics.frontRadius + 2,
    extension ? protrusionSide : "none",
  );
  // The bumper dimensions include the thin black outer outline.
  drawLocalPathCommands(
    graphics,
    footprintOutlineCommands(
      backing.rect,
      cornerRadius,
      metrics.frontRadius + 2,
      extension ? protrusionSide : "none",
    ),
    transform,
    {
      color: elementOutlineColor,
      width: backing.strokeWidth,
      alpha: 0.95 * outlineOpacity,
    },
  );
  drawLocalPathCommands(graphics, commands, transform, {
    color: outlineAccent,
    width: outline.strokeWidth,
    alpha: outlineOpacity,
  });
  const center = transformLocalPoint(transform, 0, 0);
  const centerRadius = metrics.centerRadius / 2;
  drawOutlinedDot(graphics, center, centerRadius, accent, opacity);
  if (mode === "rotation") {
    const innerRadius = Math.max(0, centerRadius - elementOutlineWidthPx);
    graphics
      .circle(center.x, center.y, innerRadius - Math.min(1.2, innerRadius / 2))
      .fill({ color: 0x15181e, alpha: 0.95 * opacity });
  }
  const front = transformLocalPoint(
    transform,
    outline.rect.x + outline.rect.width,
    0,
  );
  drawOutlinedDot(graphics, front, metrics.frontRadius, accent, opacity);
}

function drawRobotProtrusionOutline(
  graphics: Graphics,
  transform: LocalTransform,
  width: number,
  height: number,
  options: {
    protrusionDistancePx: number;
    protrusionSide: DrawNodeInput["protrusionSide"];
    strokeWidth: number;
    backingWidth?: number;
    color: string | number;
    alpha: number;
  },
): void {
  const cornerRadius = robotCornerRadius(width, height);
  const outline = robotProtrusionOutlineGeometry({
    lengthPx: width,
    widthPx: height,
    protrusionVisible: true,
    protrusionDistancePx: options.protrusionDistancePx,
    protrusionSide: options.protrusionSide,
    strokeWidth: options.backingWidth ?? options.strokeWidth,
    cornerRadiusPx: cornerRadius,
    // Join the bumper's inset centerline, rather than stopping at its outer
    // edge and leaving a notch beside the attachment-face stroke.
    rootInsetPx: (options.backingWidth ?? options.strokeWidth) / 2,
    rootCornerRadiusPx: 0,
  });

  if (!outline) {
    return;
  }

  drawLocalPathCommands(graphics, outline.pathCommands, transform, {
    color: options.color,
    width: Math.min(options.strokeWidth, outline.strokeWidth),
    alpha: options.alpha,
  });
}

function drawSelectionOutline(
  graphics: Graphics,
  bounds: RobotLocalBounds,
  transform: LocalTransform,
  opacity: number,
): void {
  const commands = footprintOutlineCommands(bounds, 3);
  // The black backing stays steady; only the separate white outline pulses.
  drawLocalPathCommands(graphics, commands, transform, {
    color: selectionBackingColor,
    width: selectionStrokeWidthPx + 2,
    alpha: 0.9,
  });
  drawLocalPathCommands(graphics, commands, transform, {
    color: elementColors.selected,
    width: selectionStrokeWidthPx,
    alpha: opacity,
  });
}

function drawSelectionFootprint(
  graphics: Graphics,
  transform: LocalTransform,
  width: number,
  height: number,
  padding: number,
  protrusionVisible: boolean,
  protrusionDistancePx: number,
  protrusionSide: DrawNodeInput["protrusionSide"],
  opacity: number,
): void {
  const bounds = robotVisualBounds(
    width,
    height,
    protrusionVisible,
    protrusionDistancePx,
    protrusionSide,
  );
  drawSelectionOutline(
    graphics,
    {
      x: bounds.x - padding,
      y: bounds.y - padding,
      width: bounds.width + padding * 2,
      height: bounds.height + padding * 2,
    },
    transform,
    opacity,
  );
}

function drawConstraintStartHighlight(
  graphics: Graphics,
  element: PathElement,
  point: StagePoint,
  headingRadians: number | null,
  robotSizeMeters: RobotSizeMeters,
  metersToPixels: number,
): void {
  if (isTranslationTarget(element)) {
    graphics
      .circle(
        point.x,
        point.y,
        Math.max(7, elementCircleRadiusMeters * metersToPixels),
      )
      .fill({ color: constraintHighlightColor })
      .stroke({ color: constraintHighlightColor, width: 2 });
    return;
  }

  if (isWaypoint(element) || isRotationTarget(element)) {
    const width = robotSizeMeters.lengthMeters * metersToPixels;
    const height = robotSizeMeters.widthMeters * metersToPixels;
    const strokeWidth = Math.max(4, Math.min(width, height) * 0.11);
    const outline = strokedRectInsideBounds(
      centeredRobotBounds(width, height),
      strokeWidth,
    );
    drawRect(
      graphics,
      outline.rect,
      {
        fill: constraintHighlightColor,
        fillAlpha: 0.22,
        stroke: constraintHighlightColor,
        strokeWidth: outline.strokeWidth,
      },
      { x: point.x, y: point.y, rotation: toStageRadians(headingRadians) },
    );
    return;
  }

  if (isEventTrigger(element)) {
    drawLocalPolyline(
      graphics,
      eventTriggerPoints(metersToPixels, 0),
      {
        color: constraintHighlightColor,
        width: 4,
        alpha: 1,
      },
      { x: point.x, y: point.y, rotation: toStageRadians(headingRadians) },
    );
  }
}

function frontOutlineInset(
  size: RobotSizeMeters,
  scale: number,
  hovered: boolean,
  waypoint: boolean,
): number {
  const width = size.lengthMeters * scale,
    height = size.widthMeters * scale;
  const stroke =
    (waypoint
      ? waypointOutlineWidth(scale)
      : elementFootprintMetrics(width, height).strokeWidth) +
    (hovered ? 0.6 : 0) +
    2 * elementOutlineWidthPx;
  return (
    strokedRectInsideBounds(centeredRobotBounds(width, height), stroke)
      .strokeWidth / 2
  );
}

function drawSimulationFill(
  graphics: Graphics,
  commands: RobotProtrusionPathCommand[],
  transform: LocalTransform,
  accent: number | string,
  eventPulse: number,
): void {
  if (!commands.length) return;
  const fill = (color: number | string, alpha: number) => {
    traceLocalPathCommands(graphics, commands, transform);
    graphics.closePath().fill({ color, alpha });
  };
  // Preserve the original shading within the rounded footprint's perimeter.
  fill(0x05080b, 0.3);
  if (eventPulse > 0) fill(simulationEventColor, 0.08 * eventPulse);
  fill(accent, 0.13 + 0.34 * eventPulse);
}

function drawSimulationRobot(
  graphics: Graphics,
  width: number,
  height: number,
  transform: LocalTransform,
  eventPulse: number,
  protrusionVisible: boolean,
  protrusionDistancePx: number,
  protrusionSide: DrawNodeInput["protrusionSide"],
): void {
  const pulse = Math.max(0, Math.min(1, eventPulse));
  const accent = mixRgbColor(simulationRobotColor, simulationEventColor, pulse);
  drawRobotFootprint(
    graphics,
    transform,
    width,
    height,
    accent,
    elementFootprintMetrics(width, height).strokeWidth,
    "simulation",
    protrusionVisible,
    protrusionDistancePx,
    protrusionSide,
    0.75,
    false,
    pulse,
  );
}

const simulationRobotColor = 0x62c7ff;
const simulationOutlineColor = 0x62d7ff;
const simulationEventColor = 0xa78bfa;
const trajectorySpeedBuckets = 20;
const trajectoryMinSegmentPx = 1.5;
const trajectorySlowColor = { r: 0x27, g: 0x45, b: 0x5c };
const trajectoryFastColor = { r: 0x7f, g: 0xdc, b: 0xff };

function trajectorySpeedColor(ratio: number): number {
  const t = Math.max(0, Math.min(1, ratio));
  const r = Math.round(
    trajectorySlowColor.r + (trajectoryFastColor.r - trajectorySlowColor.r) * t,
  );
  const g = Math.round(
    trajectorySlowColor.g + (trajectoryFastColor.g - trajectorySlowColor.g) * t,
  );
  const b = Math.round(
    trajectorySlowColor.b + (trajectoryFastColor.b - trajectorySlowColor.b) * t,
  );
  return (r << 16) | (g << 8) | b;
}

function mixRgbColor(from: number, to: number, ratio: number): number {
  const t = Math.max(0, Math.min(1, ratio));
  const channel = (shift: number) =>
    Math.round(((from >> shift) & 0xff) * (1 - t) + ((to >> shift) & 0xff) * t);
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

function drawPolyline(
  graphics: Graphics,
  points: number[],
  style: { color: string | number; width: number; alpha: number },
): void {
  if (points.length < 4) {
    return;
  }

  graphics.moveTo(points[0], points[1]);
  for (let index = 2; index < points.length; index += 2) {
    graphics.lineTo(points[index], points[index + 1]);
  }
  graphics.stroke({
    color: style.color,
    width: style.width,
    alpha: style.alpha,
    cap: "round",
    join: "round",
  });
}

function drawClippedPolyline(
  graphics: Graphics,
  points: readonly StagePoint[],
  stageSize: CanvasSize,
  style: { color: string | number; width: number; alpha: number },
): void {
  for (const run of clipStagePolyline(points, stageSize)) {
    drawPolyline(
      graphics,
      run.flatMap((point) => [point.x, point.y]),
      style,
    );
  }
}

function drawLocalPolyline(
  graphics: Graphics,
  points: number[],
  style: { color: string | number; width: number; alpha: number },
  transform?: LocalTransform,
): void {
  if (!transform) {
    drawPolyline(graphics, points, style);
    return;
  }

  const transformed = [];
  for (let index = 0; index < points.length; index += 2) {
    const point = transformLocalPoint(
      transform,
      points[index],
      points[index + 1],
    );
    transformed.push(point.x, point.y);
  }
  drawPolyline(graphics, transformed, style);
}

function drawLocalPathCommands(
  graphics: Graphics,
  commands: RobotProtrusionPathCommand[],
  transform: LocalTransform,
  style: { color: string | number; width: number; alpha: number },
): void {
  if (commands.length === 0) {
    return;
  }

  traceLocalPathCommands(graphics, commands, transform);

  graphics.stroke({
    color: style.color,
    width: style.width,
    alpha: style.alpha,
    cap: "butt",
    join: "round",
  });
}

function traceLocalPathCommands(
  graphics: Graphics,
  commands: RobotProtrusionPathCommand[],
  transform: LocalTransform,
): void {
  for (const command of commands) {
    if (command[0] === "M") {
      const point = transformLocalPoint(transform, command[1], command[2]);
      graphics.moveTo(point.x, point.y);
      continue;
    }

    if (command[0] === "L") {
      const point = transformLocalPoint(transform, command[1], command[2]);
      graphics.lineTo(point.x, point.y);
      continue;
    }

    const control = transformLocalPoint(transform, command[1], command[2]);
    const end = transformLocalPoint(transform, command[3], command[4]);
    graphics.quadraticCurveTo(control.x, control.y, end.x, end.y);
  }
}

function drawDashedCircle(
  graphics: Graphics,
  x: number,
  y: number,
  radius: number,
  style: { color: string | number; width: number; alpha: number },
): void {
  const dashCount = Math.max(18, Math.floor((Math.PI * 2 * radius) / 12));
  const step = (Math.PI * 2) / dashCount;
  for (let dash = 0; dash < dashCount; dash += 2) {
    const start = dash * step;
    const end = start + step;
    graphics
      .moveTo(x + Math.cos(start) * radius, y + Math.sin(start) * radius)
      .lineTo(x + Math.cos(end) * radius, y + Math.sin(end) * radius)
      .stroke({
        color: style.color,
        width: style.width,
        alpha: style.alpha,
        cap: "round",
      });
  }
}

function drawRect(
  graphics: Graphics,
  rect: RobotLocalBounds,
  options: {
    fill?: string | number;
    fillAlpha?: number;
    stroke?: string | number;
    strokeAlpha?: number;
    strokeWidth?: number;
  },
  transform?: LocalTransform,
): void {
  if (transform) {
    drawPolygon(graphics, rectPoints(rect), options, transform);
    return;
  }

  graphics.rect(rect.x, rect.y, rect.width, rect.height);
  if (options.fill !== undefined) {
    graphics.fill({ color: options.fill, alpha: options.fillAlpha ?? 1 });
  }
  if (options.stroke !== undefined && options.strokeWidth !== undefined) {
    graphics.stroke({
      color: options.stroke,
      width: options.strokeWidth,
      alpha: options.strokeAlpha ?? 1,
      join: "round",
    });
  }
}

function rectPoints(rect: RobotLocalBounds): number[] {
  return [
    rect.x,
    rect.y,
    rect.x + rect.width,
    rect.y,
    rect.x + rect.width,
    rect.y + rect.height,
    rect.x,
    rect.y + rect.height,
  ];
}

function drawPolygon(
  graphics: Graphics,
  points: number[],
  options: {
    fill?: string | number;
    fillAlpha?: number;
    stroke?: string | number;
    strokeAlpha?: number;
    strokeWidth?: number;
  },
  transform?: LocalTransform,
): void {
  const transformed = transform ? transformPoints(points, transform) : points;
  graphics.poly(transformed, true);
  if (options.fill !== undefined) {
    graphics.fill({ color: options.fill, alpha: options.fillAlpha ?? 1 });
  }
  if (options.stroke !== undefined && options.strokeWidth !== undefined) {
    graphics.stroke({
      color: options.stroke,
      width: options.strokeWidth,
      alpha: options.strokeAlpha ?? 1,
      join: "round",
    });
  }
}

function transformPoints(
  points: number[],
  transform: LocalTransform,
): number[] {
  const transformed = [];
  for (let index = 0; index < points.length; index += 2) {
    const point = transformLocalPoint(
      transform,
      points[index],
      points[index + 1],
    );
    transformed.push(point.x, point.y);
  }
  return transformed;
}

function transformLocalPoint(
  transform: LocalTransform,
  x: number,
  y: number,
): StagePoint {
  const cos = Math.cos(transform.rotation);
  const sin = Math.sin(transform.rotation);
  return {
    x: transform.x + x * cos - y * sin,
    y: transform.y + x * sin + y * cos,
  };
}

function robotVisualBounds(
  width: number,
  height: number,
  protrusionVisible: boolean,
  protrusionDistancePx: number,
  protrusionSide: DrawNodeInput["protrusionSide"],
): RobotLocalBounds {
  const baseBounds = centeredRobotBounds(width, height);
  const extensionBounds = robotProtrusionBounds({
    lengthPx: width,
    widthPx: height,
    protrusionVisible,
    protrusionDistancePx,
    protrusionSide,
  });
  return extensionBounds
    ? unionBounds(baseBounds, extensionBounds)
    : baseBounds;
}

function unionBounds(
  a: RobotLocalBounds,
  b: RobotLocalBounds,
): RobotLocalBounds {
  const xMin = Math.min(a.x, b.x);
  const yMin = Math.min(a.y, b.y);
  const xMax = Math.max(a.x + a.width, b.x + b.width);
  const yMax = Math.max(a.y + a.height, b.y + b.height);

  return {
    x: xMin,
    y: yMin,
    width: xMax - xMin,
    height: yMax - yMin,
  };
}

function eventTriggerPoints(
  metersToPixels: number,
  paddingPx: number,
): number[] {
  const halfLength = eventMarkerMetrics(metersToPixels).halfLength + paddingPx;
  return [-halfLength, 0, halfLength, 0];
}

function poseAtOrBefore(result: SimResult, timeS: number) {
  let selectedTime = result.times_sorted[0];
  for (const time of result.times_sorted) {
    if (time <= timeS) {
      selectedTime = time;
    } else {
      break;
    }
  }

  return result.poses_by_time.get(selectedTime) ?? null;
}

function protrusionVisibleAtOrBefore(
  result: SimResult,
  timeS: number,
): boolean | null {
  let selectedTime: number | null = null;
  for (const time of result.times_sorted) {
    if (time <= timeS && result.protrusion_visible_by_time.has(time)) {
      selectedTime = time;
    }
    if (time > timeS) {
      break;
    }
  }

  return selectedTime === null
    ? null
    : (result.protrusion_visible_by_time.get(selectedTime) ?? null);
}

function toStageRadians(radians: number | null): number {
  return radians === null ? 0 : -radians;
}

function robotCornerRadius(width: number, height: number): number {
  return Math.max(3, Math.min(width, height) * 0.08);
}

function isWholeMultiple(value: number, divisor: number, epsilon: number) {
  return Math.abs(Math.round(value / divisor) * divisor - value) < epsilon;
}

function getPixiResolution(): number {
  if (typeof window === "undefined") {
    return 1;
  }

  const devicePixelRatio = Number.isFinite(window.devicePixelRatio)
    ? window.devicePixelRatio
    : 1;
  return Math.max(1, Math.min(devicePixelRatio, maxPixiResolution));
}

async function loadFieldTexture(src: string): Promise<Texture> {
  const image = new Image();
  image.decoding = "async";

  await new Promise<void>((resolve, reject) => {
    image.addEventListener("load", () => resolve(), { once: true });
    image.addEventListener(
      "error",
      () => reject(new Error(`Failed to load field image from ${src}`)),
      { once: true },
    );
    image.src = src;
  });

  if (typeof image.decode === "function") {
    try {
      await image.decode();
    } catch {
      // The load event is enough for WebKit-backed Tauri once the image decoded for layout.
    }
  }

  return Texture.from(image, true);
}

const constraintHighlightColor = "#15c915";
let nextRendererInstanceId = 1;
const maxPixiResolution = 3;
const selectionStrokeWidthPx = 1.5;
const selectionBackingColor = 0x070b10;
