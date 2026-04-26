import { memo, useEffect, useState } from "react";
import { Image as KonvaImage, Layer, Rect } from "react-konva";
import type { FieldViewport } from "../geometry";

const canvasBackgroundColor = "#101416";

interface FieldLayerProps {
  viewport: FieldViewport;
}

export const FieldLayer = memo(function FieldLayer({ viewport }: FieldLayerProps) {
  return (
    <Layer listening={false}>
      <FieldLayerContent viewport={viewport} />
    </Layer>
  );
});

export const FieldLayerContent = memo(function FieldLayerContent({
  viewport
}: FieldLayerProps) {
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
    <>
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
        />
      ) : null}
    </>
  );
});

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
