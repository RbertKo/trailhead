import "server-only";

export const DEFAULT_META_BASE_URL = "https://api.meta.ai/v1";

// Standard-mode IDs are the default: Contributor mode lets Meta train on the
// content sent, so it has to be opted into per environment (see .env.example).
export const DEFAULT_META_MODELS = {
  text: "muse-spark-1.3",
  segment: "sam-3.1",
} as const;

export class MissingApiKeyError extends Error {
  constructor() {
    super("MODEL_API_KEY is not set");
    this.name = "MissingApiKeyError";
  }
}

export interface MetaConfig {
  apiKey: string;
  baseURL: string;
  models: { text: string; segment: string };
}

type Env = Record<string, string | undefined>;

function readEnv(env: Env, name: string, fallback: string): string {
  return env[name]?.trim() || fallback;
}

export function getMetaConfig(env: Env = process.env): MetaConfig {
  const apiKey = env.MODEL_API_KEY?.trim();
  if (!apiKey) throw new MissingApiKeyError();

  return {
    apiKey,
    baseURL: readEnv(env, "META_API_BASE_URL", DEFAULT_META_BASE_URL),
    models: {
      text: readEnv(env, "META_TEXT_MODEL", DEFAULT_META_MODELS.text),
      segment: readEnv(env, "META_SEGMENT_MODEL", DEFAULT_META_MODELS.segment),
    },
  };
}
