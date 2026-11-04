import {
  decodeMaskToSVGPath,
  recordsOfKind,
  type ImageSegmentationResult,
} from "@meta-sam/parser";

export interface SegmentedObject {
  objectId: string;
  /** Where the mask raster sits on the source image, in source pixels. */
  bounds: { left: number; top: number; right: number; bottom: number };
  /** SVG path in mask-raster coordinates. Scale it into `bounds` to draw it. */
  maskPath: string;
  maskWidth: number;
  maskHeight: number;
}

export function toSegmentedObjects(
  result: ImageSegmentationResult,
): SegmentedObject[] {
  if (result.outcome.status !== "completed") {
    const detail = result.outcome.detail ?? result.outcome.reason;
    throw new Error(`SAM segmentation ended early: ${detail}`);
  }

  // The parser drops malformed lines and reports them here. Without this check,
  // a broken response would look the same as "nothing matched".
  const dropped = result.diagnostics.find(
    (diagnostic) => diagnostic.severity === "error",
  );
  if (dropped) {
    throw new Error(`SAM output could not be parsed: ${dropped.code}`);
  }

  // A completed response with no records is a valid "nothing matched".
  return recordsOfKind(result.records, "mask").map((record) => ({
    objectId: record.objectId,
    bounds: record.bounds,
    maskPath: decodeMaskToSVGPath(record.mask),
    maskWidth: record.mask.width,
    maskHeight: record.mask.height,
  }));
}
