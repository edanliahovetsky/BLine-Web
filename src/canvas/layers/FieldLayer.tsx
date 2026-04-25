import { useEffect, useState } from "react";
import { Image as KonvaImage, Layer, Rect } from "react-konva";
import type { FieldViewport } from "../geometry";

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
        fill="#111616"
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
      <Rect
        x={viewport.x}
        y={viewport.y}
        width={viewport.width}
        height={viewport.height}
        fill="rgba(8, 12, 13, 0.1)"
      />
      {imageRect
        ? getFieldBorderMasks(imageRect).map((mask) => (
            <Rect
              key={mask.key}
              x={mask.x}
              y={mask.y}
              width={mask.width}
              height={mask.height}
              fill="#101416"
            />
          ))
        : null}
    </Layer>
  );
}

function useFieldImage(src: string) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    const nextImage = new window.Image();
    nextImage.decoding = "async";
    nextImage.onload = () => setImage(nextImage);
    nextImage.src = src;

    return () => {
      nextImage.onload = null;
    };
  }, [src]);

  return image;
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
