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
  ProjectDocument,
} from "../../core/io/projectSchema";
import type {
  FieldImageKind,
  ResolvedFieldDefinition,
} from "../../core/field/fieldConfig";
import type { CurveAuthoringPreview } from "../curveAuthoring";
import {
  isEventTrigger,
  isRotationTarget,
  isTranslationTarget,
  isWaypoint,
  type PathModel,
  type PathElement,
} from "../../core/model/path";
import type { SelectedRangedConstraint } from "../../state/selectionStore";
import {
  elementCircleRadiusMeters,
  elementOutlineMeters,
  eventMarkerHalfHeightPx,
  eventTriggerLengthMeters,
  triangleSizeRatio,
} from "../constants";
import {
  firstDomainIndexForConstraintRange,
  pathIndexesForConstraintRange,
} from "../constraintRange";
import { elementColors, rotatableElementAccent } from "../elementStyle";
import {
  getElementHeadingRadians,
  getElementPosition,
  getHandoffRadiusMeters,
  getRenderableElementPositions,
  modelToStagePoint,
  type CanvasSize,
  type FieldViewport,
  type PositionOverrides,
  type RotationOverrides,
  type StagePoint,
} from "../geometry";
import {
  centeredRobotBounds,
  robotBoundsWithProtrusion,
  robotProtrusionBounds,
  robotProtrusionOutlineGeometry,
  robotSizeFromConfig,
  robotSizeToPixels,
  strokedRectInsideBounds,
  type RobotLocalBounds,
  type RobotProtrusionPathCommand,
  type RobotSizeMeters,
} from "../robotFootprint";
import { buildElementProtrusionVisibilityByIndex } from "../protrusionVisibility";
import type { SimResult } from "../../core/sim";

export interface PixiRenderInput {
  stageSize: CanvasSize;
  viewport: FieldViewport;
  field: ResolvedFieldDefinition;
  project: ProjectDocument | null;
  overlayPaths: PixiPathOverlay[];
  hoveredOverlayPathId: string | null;
  selectedElementIndex: number | null;
  selectedRangedConstraint: SelectedRangedConstraint | null;
  positionPreview: PositionOverrides;
  rotationPreview: RotationOverrides;
  selectedPulse: number;
  simulationResult: SimResult | null;
  simulationTimeS: number;
  simulationPlaying: boolean;
  config: ProjectConfig | null;
  curvePreview: CurveAuthoringPreview | null;
  linkedTargets?: readonly PixiLinkedTargetOverlay[];
  selectedLinkedTargetId?: string | null;
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
}

export interface PixiDebugApi {
  canvasMetrics(): PixiCanvasMetrics;
  fieldState(): {
    id: string;
    label: string;
    kind: FieldImageKind;
    imageLoaded: boolean;
  };
  nodePosition(testId: string): StagePoint | null;
}

export interface PixiDebugWindow extends Window {
  __blinePixiDebug?: PixiDebugApi;
}

export class PixiPathRenderer {
  private readonly app: Application<Renderer<HTMLCanvasElement>>;
  private readonly root = new Container();
  private readonly fieldGraphics = new Graphics();
  private readonly fieldSprite: Sprite;
  private readonly field: ResolvedFieldDefinition;
  private readonly overlayGraphics = new Graphics();
  private readonly pathGraphics = new Graphics();
  private readonly curvePreviewGraphics = new Graphics();
  private readonly constraintGraphics = new Graphics();
  private readonly nodeGraphics = new Graphics();
  private readonly linkedTargetGraphics = new Graphics();
  private readonly rotationGraphics = new Graphics();
  private readonly simulationGraphics = new Graphics();
  private readonly debugNodes = new Map<string, StagePoint>();
  private renderCount = 0;

  private constructor(
    app: Application<Renderer<HTMLCanvasElement>>,
    field: ResolvedFieldDefinition,
    fieldTexture: Texture | null,
  ) {
    this.app = app;
    this.field = field;
    this.fieldSprite = new Sprite(fieldTexture ?? Texture.EMPTY);
    this.app.canvas.dataset.testid = "path-stage-pixi-canvas";
    this.app.canvas.setAttribute("aria-hidden", "true");
    this.app.stage.addChild(this.root);
    this.root.addChild(
      this.fieldGraphics,
      this.fieldSprite,
      this.overlayGraphics,
      this.pathGraphics,
      this.curvePreviewGraphics,
      this.simulationGraphics,
      this.constraintGraphics,
      this.nodeGraphics,
      this.linkedTargetGraphics,
      this.rotationGraphics,
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
        ? await loadFieldTexture(field.image_src)
        : null;
    return new PixiPathRenderer(app, field, texture);
  }

  get canvas(): HTMLCanvasElement {
    return this.app.canvas;
  }

  update(input: PixiRenderInput): void {
    this.resize(input.stageSize);
    this.debugNodes.clear();
    this.drawField(input.viewport);
    this.drawOverlayPaths(input);
    this.drawPath(input);
    this.drawCurvePreview(input);
    this.drawConstraintHighlights(input);
    this.drawNodes(input);
    this.drawLinkedTargets(input);
    this.drawRotationHandle(input);
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
        imageLoaded:
          this.field.kind === "image" &&
          this.fieldSprite.texture !== Texture.EMPTY,
      }),
      nodePosition: (testId) => this.debugNodes.get(testId) ?? null,
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
    };
  }

  private drawField(viewport: FieldViewport): void {
    this.fieldGraphics
      .clear()
      .rect(viewport.x, viewport.y, viewport.width, viewport.height)
      .fill({ color: 0x101416 });

    if (this.field.kind === "grid") {
      this.fieldSprite.visible = false;
      this.drawBlankGrid(viewport);
      return;
    }

    const rect = getAspectFitRect(
      this.fieldSprite.texture.width,
      this.fieldSprite.texture.height,
      viewport.x,
      viewport.y,
      viewport.width,
      viewport.height,
    );
    if (rect) {
      this.fieldSprite.visible = true;
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
    const elements = input.project?.path.path_elements;
    if (!elements) {
      return;
    }

    const points = getRenderableElementPositions(
      elements,
      input.positionPreview,
    ).flatMap(({ position }) => {
      const point = modelToStagePoint(position, input.viewport);
      return [point.x, point.y];
    });
    if (points.length < 4) {
      return;
    }

    drawPolyline(graphics, points, {
      color: 0x05090c,
      width: 8,
      alpha: 0.82,
    });
    drawPolyline(graphics, points, {
      color: 0xd7dde3,
      width: 2.75,
      alpha: 0.94,
    });
  }

  private drawOverlayPaths(input: PixiRenderInput): void {
    const graphics = this.overlayGraphics.clear();
    for (const overlay of input.overlayPaths) {
      const points = getRenderableElementPositions(
        overlay.path.path_elements,
      ).flatMap(({ position }) => {
        const point = modelToStagePoint(position, input.viewport);
        return [point.x, point.y];
      });
      if (points.length < 4) {
        continue;
      }

      const hovered = overlay.pathId === input.hoveredOverlayPathId;
      drawPolyline(graphics, points, {
        color: 0x071016,
        width: hovered ? 11 : 8,
        alpha: hovered ? 0.7 : 0.46,
      });
      drawPolyline(graphics, points, {
        color: hovered ? 0x62d6ff : 0x7d8c98,
        width: hovered ? 3.4 : 2.4,
        alpha: hovered ? 0.9 : 0.56,
      });
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
    const { project, selectedRangedConstraint } = input;
    if (!project || !selectedRangedConstraint) {
      return;
    }

    const selectedConstraint =
      project.path.ranged_constraints[selectedRangedConstraint.index];
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
    const elements = project.path.path_elements;
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
    const coveredPoints = covered.flatMap((point) => [point.x, point.y]);
    if (coveredPoints.length >= 4) {
      drawPolyline(graphics, coveredPoints, {
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
    const headingRadians = getElementHeadingRadians(elements, firstDomainIndex);
    const robotSize = robotSizeFromConfig(project.config);
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
    const { project } = input;
    if (!project) {
      return;
    }

    const elements = project.path.path_elements;
    const robotSize = robotSizeFromConfig(project.config);
    const protrusions = project.config.gui.protrusions;
    const protrusionVisibilityByIndex = buildElementProtrusionVisibilityByIndex(
      elements,
      project.config,
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
      this.debugNodes.set(`path-element-node-${index}`, point);
      drawPathElementNode(graphics, {
        element,
        index,
        point,
        selected: input.selectedElementIndex === index,
        dimmed: hasSelection && input.selectedElementIndex !== index,
        selectedPulse: input.selectedPulse,
        headingRadians: getElementHeadingRadians(
          elements,
          index,
          input.rotationPreview,
        ),
        handoffRadiusMeters:
          index === elements.length - 1
            ? null
            : getHandoffRadiusMeters(element),
        robotSizeMeters: robotSize,
        metersToPixels: input.viewport.scale,
        protrusionVisible:
          Boolean(protrusions.enabled) &&
          Boolean(protrusionVisibilityByIndex.get(index)) &&
          protrusions.distance_meters > 0 &&
          protrusions.side !== "none",
        protrusionDistanceMeters: protrusions.distance_meters,
        protrusionSide: protrusions.side,
      });
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
      drawPathElementNode(graphics, {
        element: linkedTargetToPathElement(target),
        index,
        point,
        selected,
        dimmed: target.compatible === false || (hasSelection && !selected),
        selectedPulse: input.selectedPulse,
        headingRadians:
          target.kind === "waypoint" ? (target.rotation_radians ?? 0) : 0,
        handoffRadiusMeters: null,
        robotSizeMeters: robotSize,
        metersToPixels: input.viewport.scale,
        protrusionVisible: false,
        protrusionDistanceMeters: 0,
        protrusionSide: "none",
      });
    }
  }

  private drawRotationHandle(input: PixiRenderInput): void {
    const graphics = this.rotationGraphics.clear();
    if (this.drawProjectRotationHandle(graphics, input)) {
      return;
    }

    this.drawLinkedTargetRotationHandle(graphics, input);
  }

  private drawProjectRotationHandle(
    graphics: Graphics,
    input: PixiRenderInput,
  ): boolean {
    const { project, selectedElementIndex } = input;
    if (!project || selectedElementIndex === null) {
      return false;
    }

    const elements = project.path.path_elements;
    const element = elements[selectedElementIndex];
    if (!element || (!isWaypoint(element) && !isRotationTarget(element))) {
      return false;
    }

    const position = getElementPosition(
      elements,
      selectedElementIndex,
      input.positionPreview,
    );
    const rotationRadians = getElementHeadingRadians(
      elements,
      selectedElementIndex,
      input.rotationPreview,
    );
    if (!position || rotationRadians === null) {
      return false;
    }

    const center = modelToStagePoint(position, input.viewport);
    const handlePoint = rotationHandlePoint(
      center,
      input.viewport,
      rotationRadians,
    );
    const accent = rotatableElementAccent(element);
    this.debugNodes.set("rotation-handle-root", center);
    this.debugNodes.set("rotation-handle", handlePoint);
    drawRotationHandleGlyph(graphics, center, handlePoint, accent);
    return true;
  }

  private drawLinkedTargetRotationHandle(
    graphics: Graphics,
    input: PixiRenderInput,
  ): void {
    const selectedTargetId = input.selectedLinkedTargetId ?? null;
    if (!selectedTargetId) {
      return;
    }

    const target = (input.linkedTargets ?? []).find(
      (candidate) => candidate.target_id === selectedTargetId,
    );
    if (!target || target.kind !== "waypoint") {
      return;
    }

    const center = modelToStagePoint(
      {
        x_meters: target.x_meters,
        y_meters: target.y_meters,
      },
      input.viewport,
    );
    const handlePoint = rotationHandlePoint(
      center,
      input.viewport,
      target.rotation_radians ?? 0,
    );
    const accent = rotatableElementAccent(linkedTargetToPathElement(target));
    this.debugNodes.set("linked-target-rotation-handle-root", center);
    this.debugNodes.set("linked-target-rotation-handle", handlePoint);
    drawRotationHandleGlyph(graphics, center, handlePoint, accent);
  }

  private drawSimulation(input: PixiRenderInput): void {
    const graphics = this.simulationGraphics.clear();
    const result = input.simulationResult;
    if (!result || result.times_sorted.length === 0) {
      return;
    }

    const visibleTimes = result.times_sorted.filter(
      (time) => time <= input.simulationTimeS,
    );
    const trailPoints = visibleTimes.flatMap((time) => {
      const pose = result.poses_by_time.get(time);
      if (!pose) {
        return [];
      }
      const point = modelToStagePoint(
        { x_meters: pose[0], y_meters: pose[1] },
        input.viewport,
      );
      return [point.x, point.y];
    });
    if (trailPoints.length >= 4) {
      drawPolyline(graphics, trailPoints, {
        color: 0x05080b,
        width: 7,
        alpha: 0.7,
      });
      drawPolyline(graphics, trailPoints, {
        color: elementColors.simulationTrail,
        width: 2.6,
        alpha: 0.92,
      });
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
    const robotBounds = robotBoundsWithProtrusion({
      lengthPx,
      widthPx,
      protrusionVisible,
      protrusionDistancePx:
        (protrusions?.distance_meters ?? 0) * input.viewport.scale,
      protrusionSide: protrusions?.side ?? "none",
    });

    drawSimulationRobot(graphics, robotBounds, {
      x: robotPoint.x,
      y: robotPoint.y,
      rotation: -pose[2],
    });
  }
}

function drawRotationHandleGlyph(
  graphics: Graphics,
  center: StagePoint,
  handlePoint: StagePoint,
  accent: string | number,
): void {
  drawLine(graphics, center.x, center.y, handlePoint.x, handlePoint.y, {
    color: 0x05080b,
    width: 6,
    alpha: 0.78,
  });
  drawLine(graphics, center.x, center.y, handlePoint.x, handlePoint.y, {
    color: accent,
    width: 2.2,
    alpha: 0.86,
  });
  graphics
    .circle(handlePoint.x, handlePoint.y, 10)
    .fill({ color: 0x0f1215, alpha: 0.94 })
    .stroke({ color: accent, width: 2 });
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
  dimmed: boolean;
  selectedPulse: number;
  headingRadians: number | null;
  handoffRadiusMeters: number | null;
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

function drawPathElementNode(graphics: Graphics, input: DrawNodeInput): void {
  const elementOpacity = input.dimmed ? 0.58 : 1;
  const selectionOpacity = (0.46 + input.selectedPulse * 0.34) * elementOpacity;
  const circleRadius = metersToVisiblePixels(
    elementCircleRadiusMeters,
    input.metersToPixels,
    7,
  );
  const rectWidth = input.robotSizeMeters.lengthMeters * input.metersToPixels;
  const rectHeight = input.robotSizeMeters.widthMeters * input.metersToPixels;
  const protrusionDistancePx =
    Math.max(0, input.protrusionDistanceMeters) * input.metersToPixels;
  const showProtrusion =
    input.protrusionVisible &&
    protrusionDistancePx > 0 &&
    input.protrusionSide !== "none";
  const outlineWidth = metersToVisiblePixels(
    elementOutlineMeters,
    input.metersToPixels,
    1.65,
  );
  const selected = input.selected;
  const point = input.point;

  if (input.handoffRadiusMeters) {
    const handoffRadius = Math.max(
      8,
      input.handoffRadiusMeters * input.metersToPixels,
    );
    drawDashedCircle(graphics, point.x, point.y, handoffRadius, {
      color: 0x05080b,
      width: 4,
      alpha: 0.82,
    });
    drawDashedCircle(graphics, point.x, point.y, handoffRadius, {
      color: elementColors.handoff,
      width: 1.45,
      alpha: 0.82,
    });
  }

  if (isTranslationTarget(input.element)) {
    if (selected) {
      graphics.circle(point.x, point.y, circleRadius + 8).stroke({
        color: elementColors.selected,
        width: selectionStrokeWidthPx,
        alpha: selectionOpacity,
      });
    }
    graphics
      .circle(
        point.x,
        point.y,
        circleRadius + clampedElementHaloThickness(circleRadius),
      )
      .fill({ color: 0x05080b, alpha: 0.72 * elementOpacity });
    graphics
      .circle(point.x, point.y, circleRadius)
      .fill({ color: elementColors.translation, alpha: elementOpacity })
      .stroke({ color: 0xeff8ff, width: 1.35, alpha: 0.9 * elementOpacity });
    graphics
      .circle(point.x, point.y, Math.max(2, circleRadius * 0.24))
      .fill({ color: 0xf7fbff, alpha: elementOpacity });
    return;
  }

  if (isWaypoint(input.element) || isRotationTarget(input.element)) {
    const accent = isWaypoint(input.element)
      ? elementColors.waypoint
      : elementColors.rotation;
    const mode = isWaypoint(input.element) ? "waypoint" : "rotation";
    const selectionPadding = Math.max(6, outlineWidth / 2 + 5);

    const transform = {
      x: point.x,
      y: point.y,
      rotation: toStageRadians(input.headingRadians),
    };
    if (selected) {
      drawSelectionFootprint(
        graphics,
        transform,
        rectWidth,
        rectHeight,
        selectionPadding,
        outlineWidth,
        showProtrusion,
        protrusionDistancePx,
        input.protrusionSide,
        selectionOpacity,
      );
    }
    drawRobotFootprint(
      graphics,
      transform,
      rectWidth,
      rectHeight,
      accent,
      outlineWidth,
      mode,
      showProtrusion,
      protrusionDistancePx,
      input.protrusionSide,
      elementOpacity,
    );
    return;
  }

  if (isEventTrigger(input.element)) {
    const points = eventTriggerPoints(input.metersToPixels, 0);
    const transform = {
      x: point.x,
      y: point.y,
      rotation: toStageRadians(input.headingRadians),
    };
    if (selected) {
      drawLocalPolyline(
        graphics,
        eventTriggerPoints(input.metersToPixels, 8),
        {
          color: elementColors.selected,
          width: selectionStrokeWidthPx + 4,
          alpha: selectionOpacity,
        },
        transform,
      );
    }
    drawLocalPolyline(
      graphics,
      eventTriggerPoints(input.metersToPixels, 2),
      {
        color: 0x05080b,
        width: 8,
        alpha: 0.82 * elementOpacity,
      },
      transform,
    );
    drawLocalPolyline(
      graphics,
      points,
      {
        color: elementColors.event,
        width: 4,
        alpha: elementOpacity,
      },
      transform,
    );
    graphics
      .circle(point.x, point.y, 3.75)
      .fill({ color: 0xf8f4ff, alpha: elementOpacity })
      .stroke({ color: 0x05080b, width: 1, alpha: 0.58 * elementOpacity });
  }
}

function drawRobotFootprint(
  graphics: Graphics,
  transform: LocalTransform,
  width: number,
  height: number,
  accent: string,
  outlineWidth: number,
  mode: "waypoint" | "rotation",
  protrusionVisible: boolean,
  protrusionDistancePx: number,
  protrusionSide: DrawNodeInput["protrusionSide"],
  opacity: number,
): void {
  const triangleLength = Math.min(width, height) * triangleSizeRatio;
  const halfTriangleHeight = triangleLength / 2;
  const footprintBounds = centeredRobotBounds(width, height);
  const halo = robotHaloMetrics(width, height);
  const haloOutline = strokedRectInsideBounds(
    footprintBounds,
    halo.strokeWidth,
  );
  const robotOutline = strokedRectInsideBounds(footprintBounds, outlineWidth);
  const protrusionStrokeWidth = Math.max(1.2, outlineWidth * 0.6);
  const extension = robotProtrusionBounds({
    lengthPx: width,
    widthPx: height,
    protrusionVisible,
    protrusionDistancePx,
    protrusionSide,
  });
  const fillColor = mode === "waypoint" ? 0xff9f43 : 0x6bdc8b;

  if (extension) {
    drawRect(
      graphics,
      extension,
      {
        fill: fillColor,
        fillAlpha: 0.08 * opacity,
      },
      transform,
    );
    drawRobotProtrusionOutline(graphics, transform, width, height, {
      protrusionDistancePx,
      protrusionSide,
      strokeWidth: Math.max(
        protrusionStrokeWidth + 1.4,
        protrusionStrokeWidth + halo.strokeWidth * 0.55,
      ),
      color: 0x05080b,
      alpha: 0.76 * opacity,
    });
    drawRobotProtrusionOutline(graphics, transform, width, height, {
      protrusionDistancePx,
      protrusionSide,
      strokeWidth: protrusionStrokeWidth,
      color: accent,
      alpha: opacity,
    });
  }
  drawRobotBodyRect(
    graphics,
    haloOutline.rect,
    {
      fill: 0x05080b,
      fillAlpha: 0.28 * opacity,
      stroke: 0x05080b,
      strokeAlpha: 0.82 * opacity,
      strokeWidth: haloOutline.strokeWidth,
    },
    transform,
    extension ? protrusionSide : null,
  );
  drawRobotBodyRect(
    graphics,
    robotOutline.rect,
    {
      fill: fillColor,
      fillAlpha: 0.1 * opacity,
      stroke: accent,
      strokeAlpha: opacity,
      strokeWidth: robotOutline.strokeWidth,
    },
    transform,
    extension ? protrusionSide : null,
  );

  if (mode === "rotation") {
    const center = transformLocalPoint(transform, 0, 0);
    graphics
      .circle(center.x, center.y, Math.max(4, Math.min(width, height) * 0.13))
      .fill({ color: 0x05080b, alpha: 0.26 * opacity })
      .stroke({
        color: accent,
        width: Math.max(1.4, outlineWidth * 0.72),
        alpha: opacity,
      });
    drawTransformedLine(graphics, 0, 0, width * 0.28, 0, transform, {
      color: accent,
      width: Math.max(1.25, outlineWidth * 0.55),
      alpha: opacity,
    });
    drawPolygon(
      graphics,
      [
        triangleLength / 2,
        0,
        -triangleLength / 2,
        halfTriangleHeight,
        -triangleLength / 2,
        -halfTriangleHeight,
      ],
      { fill: accent, fillAlpha: 0.52 * opacity },
      transform,
    );
    return;
  }

  drawPolygon(
    graphics,
    [
      triangleLength / 2,
      0,
      -triangleLength / 2,
      halfTriangleHeight,
      -triangleLength / 2,
      -halfTriangleHeight,
    ],
    {
      fill: 0x05080b,
      fillAlpha: 0.25 * opacity,
      stroke: accent,
      strokeAlpha: opacity,
      strokeWidth: Math.max(1.4, outlineWidth * 0.72),
    },
    transform,
  );
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
    strokeWidth: options.strokeWidth,
    cornerRadiusPx: cornerRadius,
    rootInsetPx: 0,
  });

  if (!outline) {
    return;
  }

  drawLocalPathCommands(graphics, outline.pathCommands, transform, {
    color: options.color,
    width: outline.strokeWidth,
    alpha: options.alpha,
  });
}

function drawRobotBodyRect(
  graphics: Graphics,
  rect: RobotLocalBounds,
  options: {
    fill?: string | number;
    fillAlpha?: number;
    stroke?: string | number;
    strokeAlpha?: number;
    strokeWidth?: number;
  },
  transform: LocalTransform,
  protrusionSide: DrawNodeInput["protrusionSide"] | null,
): void {
  if (!protrusionSide || protrusionSide === "none") {
    drawRect(graphics, rect, options, transform);
    return;
  }

  drawPolygon(
    graphics,
    rectPoints(rect),
    {
      fill: options.fill,
      fillAlpha: options.fillAlpha,
    },
    transform,
  );

  if (options.stroke === undefined || options.strokeWidth === undefined) {
    return;
  }

  drawRectStrokeWithSharpAttachmentCorners(
    graphics,
    rect,
    protrusionSide,
    transform,
    {
      color: options.stroke,
      width: options.strokeWidth,
      alpha: options.strokeAlpha ?? 1,
    },
  );
}

function drawRectStrokeWithSharpAttachmentCorners(
  graphics: Graphics,
  rect: RobotLocalBounds,
  protrusionSide: DrawNodeInput["protrusionSide"],
  transform: LocalTransform,
  style: { color: string | number; width: number; alpha: number },
): void {
  const left = rect.x;
  const right = rect.x + rect.width;
  const top = rect.y;
  const bottom = rect.y + rect.height;
  const halfStroke = style.width / 2;

  if (protrusionSide === "front") {
    drawLocalStrokePath(
      graphics,
      [right, top, left, top, left, bottom, right, bottom],
      transform,
      {
        ...style,
        cap: "butt",
        join: "round",
      },
    );
    drawLocalStrokePath(
      graphics,
      [right, top - halfStroke, right, bottom + halfStroke],
      transform,
      {
        ...style,
        cap: "butt",
        join: "miter",
      },
    );
    return;
  }

  if (protrusionSide === "back") {
    drawLocalStrokePath(
      graphics,
      [left, top, right, top, right, bottom, left, bottom],
      transform,
      {
        ...style,
        cap: "butt",
        join: "round",
      },
    );
    drawLocalStrokePath(
      graphics,
      [left, top - halfStroke, left, bottom + halfStroke],
      transform,
      {
        ...style,
        cap: "butt",
        join: "miter",
      },
    );
    return;
  }

  if (protrusionSide === "left") {
    drawLocalStrokePath(
      graphics,
      [left, top, left, bottom, right, bottom, right, top],
      transform,
      {
        ...style,
        cap: "butt",
        join: "round",
      },
    );
    drawLocalStrokePath(
      graphics,
      [left - halfStroke, top, right + halfStroke, top],
      transform,
      {
        ...style,
        cap: "butt",
        join: "miter",
      },
    );
    return;
  }

  if (protrusionSide === "right") {
    drawLocalStrokePath(
      graphics,
      [left, bottom, left, top, right, top, right, bottom],
      transform,
      {
        ...style,
        cap: "butt",
        join: "round",
      },
    );
    drawLocalStrokePath(
      graphics,
      [left - halfStroke, bottom, right + halfStroke, bottom],
      transform,
      {
        ...style,
        cap: "butt",
        join: "miter",
      },
    );
  }
}

function drawSelectionFootprint(
  graphics: Graphics,
  transform: LocalTransform,
  width: number,
  height: number,
  padding: number,
  outlineWidth: number,
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
  drawRect(
    graphics,
    {
      x: bounds.x - padding,
      y: bounds.y - padding,
      width: bounds.width + padding * 2,
      height: bounds.height + padding * 2,
    },
    {
      stroke: elementColors.selected,
      strokeAlpha: opacity,
      strokeWidth: selectionStrokeWidthPx,
    },
    transform,
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

function drawSimulationRobot(
  graphics: Graphics,
  bounds: RobotLocalBounds,
  transform: LocalTransform,
): void {
  const triangleSize = Math.min(bounds.width, bounds.height) * 0.28;
  const triangleOffset = bounds.width * 0.26;
  const halo = robotHaloMetrics(bounds.width, bounds.height);
  const haloOutline = strokedRectInsideBounds(bounds, halo.strokeWidth);
  const robotOutline = strokedRectInsideBounds(
    bounds,
    simulationRobotStrokeWidthPx,
  );

  drawRect(
    graphics,
    haloOutline.rect,
    {
      fill: 0x05080b,
      fillAlpha: 0.3,
      stroke: 0x05080b,
      strokeAlpha: 0.82,
      strokeWidth: haloOutline.strokeWidth,
    },
    transform,
  );
  drawRect(
    graphics,
    robotOutline.rect,
    {
      fill: 0x62c7ff,
      fillAlpha: 0.13,
      stroke: elementColors.simulation,
      strokeAlpha: 1,
      strokeWidth: robotOutline.strokeWidth,
    },
    transform,
  );
  drawPolygon(
    graphics,
    [
      triangleOffset + triangleSize,
      0,
      triangleOffset - triangleSize / 2,
      triangleSize / 2,
      triangleOffset - triangleSize / 2,
      -triangleSize / 2,
    ],
    {
      fill: 0x62c7ff,
      fillAlpha: 0.38,
      stroke: elementColors.simulation,
      strokeWidth: 1.9,
    },
    transform,
  );
  const center = transformLocalPoint(transform, 0, 0);
  graphics
    .circle(
      center.x,
      center.y,
      Math.max(2.5, Math.min(bounds.width, bounds.height) * 0.08),
    )
    .fill({ color: 0x05080b, alpha: 0.36 })
    .stroke({ color: elementColors.simulation, width: 1.5, alpha: 0.94 });
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

function drawLocalStrokePath(
  graphics: Graphics,
  points: number[],
  transform: LocalTransform,
  style: {
    color: string | number;
    width: number;
    alpha: number;
    cap: "butt" | "round";
    join: "miter" | "round";
  },
): void {
  if (points.length < 4) {
    return;
  }

  const start = transformLocalPoint(transform, points[0], points[1]);
  graphics.moveTo(start.x, start.y);
  for (let index = 2; index < points.length; index += 2) {
    const point = transformLocalPoint(
      transform,
      points[index],
      points[index + 1],
    );
    graphics.lineTo(point.x, point.y);
  }
  graphics.stroke({
    color: style.color,
    width: style.width,
    alpha: style.alpha,
    cap: style.cap,
    join: style.join,
  });
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

  graphics.stroke({
    color: style.color,
    width: style.width,
    alpha: style.alpha,
    cap: "butt",
    join: "round",
  });
}

function drawLine(
  graphics: Graphics,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  style: { color: string | number; width: number; alpha: number },
): void {
  graphics.moveTo(x0, y0).lineTo(x1, y1).stroke({
    color: style.color,
    width: style.width,
    alpha: style.alpha,
    cap: "round",
    join: "round",
  });
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

function drawTransformedLine(
  graphics: Graphics,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  transform: LocalTransform,
  style: { color: string | number; width: number; alpha: number },
): void {
  const start = transformLocalPoint(transform, x0, y0);
  const end = transformLocalPoint(transform, x1, y1);
  drawLine(graphics, start.x, start.y, end.x, end.y, style);
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
  const halfLength =
    metersToVisiblePixels(
      eventTriggerLengthMeters,
      metersToPixels,
      eventMarkerHalfHeightPx * 2,
    ) /
      2 +
    paddingPx;
  return [-halfLength, 0, halfLength, 0];
}

function rotationHandlePoint(
  center: StagePoint,
  viewport: FieldViewport,
  rotationRadians: number,
): StagePoint {
  const radius = rotationHandleRadius(viewport);
  return {
    x: center.x + Math.cos(rotationRadians) * radius,
    y: center.y - Math.sin(rotationRadians) * radius,
  };
}

function rotationHandleRadius(viewport: FieldViewport): number {
  return Math.max(42, Math.min(64, viewport.scale * 0.36));
}

function getAspectFitRect(
  sourceWidth: number,
  sourceHeight: number,
  targetX: number,
  targetY: number,
  targetWidth: number,
  targetHeight: number,
): { x: number; y: number; width: number; height: number } | null {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return null;
  }

  const scale = Math.min(
    targetWidth / sourceWidth,
    targetHeight / sourceHeight,
  );
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;

  return {
    x: targetX + Math.max(0, (targetWidth - width) / 2),
    y: targetY + targetHeight - height,
    width,
    height,
  };
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

function metersToVisiblePixels(
  meters: number,
  metersToPixels: number,
  minimumPixels: number,
): number {
  return Math.max(minimumPixels, meters * metersToPixels);
}

function toStageRadians(radians: number | null): number {
  return radians === null ? 0 : -radians;
}

function robotHaloMetrics(width: number, height: number) {
  const footprintSize = Math.min(width, height);

  return {
    strokeWidth: clamp(footprintSize * 0.12, 2.2, 5),
  };
}

function robotCornerRadius(width: number, height: number): number {
  return Math.max(3, Math.min(width, height) * 0.08);
}

function clampedElementHaloThickness(radius: number): number {
  return clamp(radius * 0.35, 2.25, 4);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
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
const maxPixiResolution = 3;
const selectionStrokeWidthPx = 2.6;
const simulationRobotStrokeWidthPx = 2.4;
