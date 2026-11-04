import { describe, expect, it } from "vitest";

import {
  DEFAULT_META_BASE_URL,
  DEFAULT_META_MODELS,
  getMetaConfig,
  MissingApiKeyError,
} from "./config";

describe("getMetaConfig", () => {
  it.each([{}, { MODEL_API_KEY: "" }, { MODEL_API_KEY: "   " }])(
    "throws when the key is missing or blank: %j",
    (env) => {
      expect(() => getMetaConfig(env)).toThrow(MissingApiKeyError);
    },
  );

  it("defaults to the Standard-mode model so content is not used for training", () => {
    const config = getMetaConfig({ MODEL_API_KEY: "key" });

    expect(config.baseURL).toBe(DEFAULT_META_BASE_URL);
    expect(config.models).toEqual(DEFAULT_META_MODELS);
    expect(config.models.text).not.toContain("contributor");
  });

  it("applies overrides and ignores blank ones", () => {
    const config = getMetaConfig({
      MODEL_API_KEY: "key",
      META_API_BASE_URL: "http://localhost:4010/v1",
      META_TEXT_MODEL: "muse-spark-1.3-contributor",
      META_SEGMENT_MODEL: "  ",
    });

    expect(config.baseURL).toBe("http://localhost:4010/v1");
    expect(config.models.text).toBe("muse-spark-1.3-contributor");
    expect(config.models.segment).toBe(DEFAULT_META_MODELS.segment);
  });
});
