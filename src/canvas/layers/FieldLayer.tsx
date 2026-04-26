import { useEffect, useState } from "react";
import { Image as KonvaImage, Layer, Rect } from "react-konva";
import type { FieldViewport } from "../geometry";

const canvasBackgroundColor = "#101416";

interface FieldLayerProps {
  viewport: FieldViewport;
}

export function FieldLayer({ viewport }: FieldLayerProps) {
  const fieldImage = useFieldImage("/assets/field26.png");
  const imageRect = fieldImage
    ? getAspectFitRect(
        fieldImage.width,
        fieldImage.height,
        viewport.x,
        viewport.y,
        viewport.width,
        viewport.height
      )
    : null;

  return (
    <Layer listening={false}>
      <Rect
        x={viewport.x}
        y={viewport.y}
        width={viewport.width}
        height={viewport.height}
        fill={canvasBackgroundColor}
      />
      {fieldImage && imageRect ? (
        <KonvaImage
          image={fieldImage}
          x={imageRect.x}
          y={imageRect.y}
          width={imageRect.width}
          height={imageRect.height}
          opacity={0.96}
        />
      ) : null}
      {imageRect
        ? getFieldBorderMasks(imageRect).map((mask) => (
            <Rect
              key={mask.key}
              x={mask.x}
              y={mask.y}
              width={mask.width}
              height={mask.height}
              fill={canvasBackgroundColor}
            />
          ))
        : null}
      {imageRect
        ? getFieldFrostedFrame(imageRect).map((frame) => (
            <Rect
              key={frame.key}
              x={frame.x}
              y={frame.y}
              width={frame.width}
              height={frame.height}
              fill="rgba(236, 243, 249, 0.034)"
            />
          ))
        : null}
      {imageRect ? (
        <Rect
          x={imageRect.x}
          y={imageRect.y}
          width={imageRect.width}
          height={imageRect.height}
          stroke="rgba(235, 243, 249, 0.22)"
          strokeWidth={Math.max(1, imageRect.height * 0.0015)}
          shadowColor="rgba(235, 243, 249, 0.34)"
          shadowBlur={Math.max(8, imageRect.height * 0.018)}
          shadowOpacity={0.14}
        />
      ) : null}
    </Layer>
  );
}

type FieldImageSource = HTMLImageElement | HTMLCanvasElement;

function useFieldImage(src: string) {
  const [image, setImage] = useState<FieldImageSource | null>(null);

  useEffect(() => {
    const nextImage = new window.Image();
    nextImage.decoding = "async";
    nextImage.onload = () => setImage(recolorFieldBackground(nextImage));
    nextImage.src = src;

    return () => {
      nextImage.onload = null;
    };
  }, [src]);

  return image;
}

function recolorFieldBackground(image: HTMLImageElement): FieldImageSource {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return image;
  }

  context.drawImage(image, 0, 0);

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const background = hexToRgb(canvasBackgroundColor);
  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3];
    if (alpha === 0) {
      continue;
    }

    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    if (red <= 16 && green <= 20 && blue <= 22) {
      data[index] = background.red;
      data[index + 1] = background.green;
      data[index + 2] = background.blue;
    }
  }

  context.putImageData(imageData, 0, 0);
  return canvas;
}

function hexToRgb(hex: string) {
  return {
    red: Number.parseInt(hex.slice(1, 3), 16),
    green: Number.parseInt(hex.slice(3, 5), 16),
    blue: Number.parseInt(hex.slice(5, 7), 16)
  };
}

function getAspectFitRect(
  sourceWidth: number,
  sourceHeight: number,
  targetX: number,
  targetY: number,
  targetWidth: number,
  targetHeight: number
) {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return null;
  }

  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;

  return {
    x: targetX + Math.max(0, (targetWidth - width) / 2),
    y: targetY + targetHeight - height,
    width,
    height
  };
}

function getFieldBorderMasks(rect: {
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  const left = rect.x + rect.width * 0.026;
  const right = rect.x + rect.width * 0.974;
  const top = rect.y + rect.height * 0.05;
  const bottom = rect.y + rect.height * 0.95;
  const thickness = Math.max(4, rect.height * 0.012);
  const halfThickness = thickness / 2;

  return [
    {
      key: "top",
      x: left - halfThickness,
      y: top - halfThickness,
      width: right - left + thickness,
      height: thickness
    },
    {
      key: "bottom",
      x: left - halfThickness,
      y: bottom - halfThickness,
      width: right - left + thickness,
      height: thickness
    },
    {
      key: "left",
      x: left - halfThickness,
      y: top - halfThickness,
      width: thickness,
      height: bottom - top + thickness
    },
    {
      key: "right",
      x: right - halfThickness,
      y: top - halfThickness,
      width: thickness,
      height: bottom - top + thickness
    }
  ];
}

function getFieldFrostedFrame(rect: {
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  const thickness = Math.max(5, Math.min(12, rect.height * 0.016));

  return [
    {
      key: "frost-top",
      x: rect.x - thickness,
      y: rect.y - thickness,
      width: rect.width + thickness * 2,
      height: thickness
    },
    {
      key: "frost-bottom",
      x: rect.x - thickness,
      y: rect.y + rect.height,
      width: rect.width + thickness * 2,
      height: thickness
    },
    {
      key: "frost-left",
      x: rect.x - thickness,
      y: rect.y,
      width: thickness,
      height: rect.height
    },
    {
      key: "frost-right",
      x: rect.x + rect.width,
      y: rect.y,
      width: thickness,
      height: rect.height
    }
  ];
}
