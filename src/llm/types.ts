import type { LanguageModel, ModelMessage } from "ai";

export type LLMessage = ModelMessage;
export type LLMModel = LanguageModel;

export type TemperatureSetting = number | readonly number[];

export interface SamplingProfile {
  temperature?: TemperatureSetting;
  topP?: TemperatureSetting;
}

export type SamplingScopeConfig = Record<string, SamplingProfile>;

export interface LLMRequestOptions {
  temperature?: TemperatureSetting;
  topP?: TemperatureSetting;
  scope?: string;
  useCache?: boolean;
  retryIndex?: number;
  retryMax?: number;
}

export interface LLMOptions {
  model: LLMModel;
  modelId?: string;
  dataDirPath: string;
  logDirPath?: string;
  cacheDirPath?: string;
  concurrent?: number;
  timeout?: number;
  temperature?: TemperatureSetting;
  topP?: TemperatureSetting;
  sampling?: SamplingScopeConfig;
  retryTimes?: number;
  retryIntervalSeconds?: number;
}

export interface PendingCacheEntry {
  cacheKey: string;
  response: string;
}

export type LLMContextRequest = (
  messages: readonly LLMessage[],
  options: LLMRequestOptions,
  pendingCacheEntries?: Map<string, PendingCacheEntry>,
  logFiles?: string[],
) => Promise<string>;
