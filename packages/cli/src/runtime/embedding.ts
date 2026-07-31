import { embed } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

import { CLI_HELP_ROUTES, withHelpRoute } from "../support/index.js";
import { readLocalConfigSection } from "./local-config.js";

export type CLIEmbeddingProvider = "openai" | "openai-compatible";

export interface CLIEmbeddingConfig {
  readonly apiKey?: string;
  readonly baseURL?: string;
  readonly dimensions?: number;
  readonly model?: string;
  readonly name?: string;
  readonly provider?: CLIEmbeddingProvider;
}

export interface QueryEmbeddingResult {
  readonly dimensions: number;
  readonly embedding: readonly number[];
  readonly model: string;
  readonly provider: CLIEmbeddingProvider;
  readonly usage?: {
    readonly tokens?: number;
  };
}

export async function readEmbeddingConfig(): Promise<CLIEmbeddingConfig> {
  const config = await readLocalConfigSection("embedding");

  return {
    ...(typeof config.apiKey === "string" ? { apiKey: config.apiKey } : {}),
    ...(typeof config.baseURL === "string" ? { baseURL: config.baseURL } : {}),
    ...(typeof config.dimensions === "number"
      ? { dimensions: config.dimensions }
      : {}),
    ...(typeof config.model === "string" ? { model: config.model } : {}),
    ...(typeof config.name === "string" ? { name: config.name } : {}),
    ...(typeof config.provider === "string"
      ? { provider: parseEmbeddingProvider(config.provider) }
      : {}),
  };
}

export async function embedQueryText(
  value: string,
  config: CLIEmbeddingConfig = {},
): Promise<QueryEmbeddingResult> {
  const normalized = value.trim();

  if (normalized === "") {
    throw new Error("Query text cannot be empty.");
  }

  const provider = requireEmbeddingProvider(config.provider);
  const model = requireEmbeddingModel(config.model);
  const embeddingModel = createEmbeddingModel(provider, model, config);
  const providerOptions = createEmbeddingProviderOptions(provider, config);
  const result = await embed({
    maxRetries: 0,
    model: embeddingModel,
    ...(providerOptions === undefined ? {} : { providerOptions }),
    value: normalized,
  });

  return {
    dimensions: result.embedding.length,
    embedding: result.embedding,
    model,
    provider,
    ...(result.usage.tokens === undefined
      ? {}
      : { usage: { tokens: result.usage.tokens } }),
  };
}

export async function embedQueryTextWithLocalConfig(
  value: string,
): Promise<QueryEmbeddingResult> {
  return await embedQueryText(value, await readEmbeddingConfig());
}

function createEmbeddingModel(
  provider: CLIEmbeddingProvider,
  model: string,
  config: CLIEmbeddingConfig,
) {
  switch (provider) {
    case "openai": {
      if (config.baseURL !== undefined) {
        throw new Error(
          withHelpRoute(
            "openai does not accept embedding.baseURL. Use openai-compatible for third-party OpenAI-style embedding APIs.",
            CLI_HELP_ROUTES.config,
          ),
        );
      }

      return createOpenAI({
        ...(config.apiKey === undefined ? {} : { apiKey: config.apiKey }),
        ...(config.name === undefined ? {} : { name: config.name }),
      }).embeddingModel(model);
    }
    case "openai-compatible": {
      if (config.baseURL === undefined) {
        throw new Error(
          withHelpRoute(
            "openai-compatible requires embedding.baseURL.",
            CLI_HELP_ROUTES.config,
          ),
        );
      }

      return createOpenAICompatible({
        baseURL: config.baseURL,
        name: config.name ?? createOpenAICompatibleName(config.baseURL),
        ...(config.apiKey === undefined ? {} : { apiKey: config.apiKey }),
      }).embeddingModel(model);
    }
  }
}

function createEmbeddingProviderOptions(
  provider: CLIEmbeddingProvider,
  config: CLIEmbeddingConfig,
): Record<string, { readonly dimensions: number }> | undefined {
  if (config.dimensions === undefined) {
    return undefined;
  }

  return {
    [getEmbeddingProviderOptionsName(provider, config)]: {
      dimensions: config.dimensions,
    },
  };
}

function getEmbeddingProviderOptionsName(
  provider: CLIEmbeddingProvider,
  _config: CLIEmbeddingConfig,
): string {
  if (provider === "openai") {
    return "openai";
  }
  return "openaiCompatible";
}

function requireEmbeddingProvider(
  provider: CLIEmbeddingProvider | undefined,
): CLIEmbeddingProvider {
  if (provider !== undefined) {
    return provider;
  }

  throw new Error(
    withHelpRoute(
      "Missing embedding configuration. Configure `wikg://local/config/embedding` with provider and model.",
      CLI_HELP_ROUTES.config,
    ),
  );
}

function requireEmbeddingModel(model: string | undefined): string {
  if (model !== undefined) {
    return model;
  }

  throw new Error(
    withHelpRoute(
      "Missing embedding.model. Configure `wikg://local/config/embedding` before using Dense search.",
      CLI_HELP_ROUTES.config,
    ),
  );
}

function parseEmbeddingProvider(value: string): CLIEmbeddingProvider {
  switch (value) {
    case "openai":
    case "openai-compatible":
      return value;
    default:
      throw new Error(
        `Invalid embedding.provider: ${value}. Expected openai or openai-compatible.`,
      );
  }
}

function createOpenAICompatibleName(baseURL: string): string {
  try {
    return new URL(baseURL).hostname;
  } catch {
    return "openai-compatible";
  }
}
