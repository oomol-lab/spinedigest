import type {
  SamplingProfile,
  SamplingScopeConfig,
  TemperatureSetting,
} from "./types.js";

const DEFAULT_SCOPE_SAMPLING = Object.freeze({
  "serial-generation/editor-compress": Object.freeze({
    temperature: 0.7,
    topP: 0.9,
  }),
  "serial-generation/editor-review": Object.freeze({
    temperature: [0.3, 0.95] as const,
    topP: [0.4, 0.8] as const,
  }),
  "serial-generation/editor-review-guide": Object.freeze({
    temperature: 0.4,
    topP: 0.6,
  }),
  "serial-generation/reader-choice": Object.freeze({
    temperature: [0.3, 0.95] as const,
    topP: [0.4, 0.8] as const,
  }),
  "serial-generation/reader-extraction": Object.freeze({
    temperature: [0.3, 0.95] as const,
    topP: [0.4, 0.8] as const,
  }),
} satisfies SamplingScopeConfig<string>);

export function resolveSamplingSetting(
  value: TemperatureSetting | undefined,
  fieldName: string,
  retryIndex?: number,
  retryMax?: number,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "number") {
    return value;
  }

  if (value.length === 1) {
    return value[0];
  }

  if (value.length !== 2) {
    throw new RangeError(
      `${fieldName} must be a number or a 2-item range like [0.6, 0.98]`,
    );
  }
  const [start, end] = value;

  if (start === undefined || end === undefined) {
    throw new RangeError(
      `${fieldName} must be a number or a 2-item range like [0.6, 0.98]`,
    );
  }

  if (retryIndex === undefined || retryMax === undefined || retryMax <= 0) {
    return start;
  }
  const boundedRetryIndex = Math.min(Math.max(retryIndex, 0), retryMax);
  const progress = boundedRetryIndex / retryMax;

  return start + (end - start) * progress;
}

export function resolveTemperatureSetting(
  temperature: TemperatureSetting | undefined,
  retryIndex?: number,
  retryMax?: number,
): number | undefined {
  return resolveSamplingSetting(
    temperature,
    "temperature",
    retryIndex,
    retryMax,
  );
}

export function createDefaultSamplingConfig(
  input: {
    readonly sampling?: SamplingScopeConfig<string>;
    readonly temperature?: TemperatureSetting;
    readonly topP?: TemperatureSetting;
  } = {},
): SamplingScopeConfig<string> {
  const profiles = new Map<string, SamplingProfile>(
    Object.entries(DEFAULT_SCOPE_SAMPLING).map(([scope, profile]) => [
      scope,
      { ...profile },
    ]),
  );

  for (const [scope, profile] of Object.entries(input.sampling ?? {})) {
    profiles.set(scope, {
      ...profiles.get(scope),
      ...profile,
    });
  }

  for (const [scope, profile] of profiles.entries()) {
    profiles.set(scope, {
      ...profile,
      ...(input.temperature === undefined
        ? {}
        : { temperature: input.temperature }),
      ...(input.topP === undefined ? {} : { topP: input.topP }),
    });
  }

  return Object.freeze(
    Object.fromEntries(
      [...profiles.entries()].map(([scope, profile]) => [
        scope,
        Object.freeze(profile),
      ]),
    ),
  ) as SamplingScopeConfig<string>;
}

export function getScopeDefaults<S extends string>(
  scope: S | undefined,
  sampling: SamplingScopeConfig<string> | undefined,
  defaultTemperature: TemperatureSetting,
  defaultTopP: TemperatureSetting,
): {
  temperature: TemperatureSetting;
  topP: TemperatureSetting;
} {
  if (scope === undefined) {
    return {
      temperature: defaultTemperature,
      topP: defaultTopP,
    };
  }

  if (sampling === undefined) {
    return {
      temperature: defaultTemperature,
      topP: defaultTopP,
    };
  }

  const profile = sampling[scope];

  if (profile === undefined) {
    return {
      temperature: defaultTemperature,
      topP: defaultTopP,
    };
  }

  return {
    temperature: profile.temperature ?? defaultTemperature,
    topP: profile.topP ?? defaultTopP,
  };
}
