import { Layer, Line, Rect } from "react-konva";
import { fieldLengthMeters, fieldWidthMeters } from "../constants";
import type { FieldViewport } from "../geometry";

interface FieldLayerProps {
  viewport: FieldViewport;
}

export function FieldLayer({ viewport }: FieldLayerProps) {
  const verticalGridLines = Array.from(
    { length: Math.floor(fieldLengthMeters) + 1 },
    (_, index) => viewport.x + index * viewport.scale
  );
  const horizontalGridLines = Array.from(
    { length: Math.floor(fieldWidthMeters) + 1 },
    (_, index) => viewport.y + index * viewport.scale
  );
  const centerX = viewport.x + viewport.width / 2;
  const centerY = viewport.y + viewport.height / 2;

  return (
    <Layer listening={false}>
      <Rect
        x={viewport.x}
        y={viewport.y}
        width={viewport.width}
        height={viewport.height}
        fill="#eef6f0"
        stroke="#54616f"
        strokeWidth={2}
      />
      {verticalGridLines.map((x) => (
        <Line
          key={`v-${x}`}
          points={[x, viewport.y, x, viewport.y + viewport.height]}
          stroke="#c8d8cf"
          strokeWidth={1}
        />
      ))}
      {horizontalGridLines.map((y) => (
        <Line
          key={`h-${y}`}
          points={[viewport.x, y, viewport.x + viewport.width, y]}
          stroke="#c8d8cf"
          strokeWidth={1}
        />
      ))}
      <Line
        points={[centerX, viewport.y, centerX, viewport.y + viewport.height]}
        stroke="#96a7b0"
        strokeWidth={2}
      />
      <Line
        points={[viewport.x, centerY, viewport.x + viewport.width, centerY]}
        stroke="#96a7b0"
        strokeWidth={2}
      />
      <Rect
        x={viewport.x}
        y={viewport.y}
        width={viewport.width}
        height={viewport.height}
        stroke="#18202a"
        strokeWidth={3}
      />
    </Layer>
  );
}
