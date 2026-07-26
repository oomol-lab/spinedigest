import { resolve } from "path";

export type WikiGraphEntryEnvPolicy = "development" | "production";

export interface WikiGraphEntryRuntimeOptions {
  readonly argv?: readonly string[] | undefined;
  readonly cwd?: string | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly envPolicy: WikiGraphEntryEnvPolicy;
  readonly stateDir?: string | undefined;
}

export interface WikiGraphEntryRuntimeContext {
  readonly devProjectRoot?: string | undefined;
  readonly env: NodeJS.ProcessEnv;
  readonly envPolicy: WikiGraphEntryEnvPolicy;
  readonly stateDir?: string | undefined;
}

const DANGEROUS_RUNTIME_ENV_NAMES = [
  "WIKIGRAPH_DEV",
  "WIKIGRAPH_ENV_POLICY",
  "WIKIGRAPH_QUEUE_DISABLE_AUTOSTART",
  "WIKIGRAPH_STATE_DIR",
] as const;

export function createEntryRuntimeContext(
  options: WikiGraphEntryRuntimeOptions,
): WikiGraphEntryRuntimeContext {
  const environment = createMergedEnvironment(options.env);

  if (options.envPolicy === "production") {
    const blocked = DANGEROUS_RUNTIME_ENV_NAMES.filter(
      (name) => environment[name] !== undefined,
    );

    if (blocked.length > 0) {
      throw new Error(
        `Wiki Graph production entries do not support runtime env overrides: ${blocked.join(", ")}. Use the development entry or explicit SDK options instead.`,
      );
    }

    return {
      env: environment,
      envPolicy: options.envPolicy,
      stateDir: options.stateDir,
    };
  }

  const envStateDir =
    environment.WIKIGRAPH_DEV ?? environment.WIKIGRAPH_STATE_DIR;
  const stateDir = options.stateDir ?? envStateDir;

  if (stateDir === undefined) {
    throw new Error(
      "Wiki Graph development entries require an explicit runtime state directory.",
    );
  }

  return {
    devProjectRoot: resolveDevProjectRoot(stateDir),
    env: environment,
    envPolicy: options.envPolicy,
    stateDir,
  };
}

function createMergedEnvironment(
  environment: NodeJS.ProcessEnv | undefined,
): NodeJS.ProcessEnv {
  if (environment === undefined) {
    return { ...process.env };
  }

  return {
    ...process.env,
    ...environment,
  };
}

function resolveDevProjectRoot(stateDirPath: string): string {
  return resolve(stateDirPath, "..", "..");
}
