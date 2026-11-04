import { describe, expect, it } from "vitest";

import { isUsefulRegion } from "./image";

const image = { width: 1000, height: 1000 };

describe("isUsefulRegion", () => {
  it("accepts a region that covers a real part of the image", () => {
    const bounds = { left: 100, top: 100, right: 700, bottom: 600 };
    expect(isUsefulRegion(image, { bounds })).toBe(true);
  });

  it("rejects a speck", () => {
    const bounds = { left: 100, top: 100, right: 150, bottom: 130 };
    expect(isUsefulRegion(image, { bounds })).toBe(false);
  });
});
