import type { File } from "./types.js";

export type PlatformModule = Record<string, any>;

type LegacyFunction = (...args: any[]) => any;

/**
 * Transitional capabilities used by path-based Core modules that have not yet
 * moved to File/Directory. This is not part of the public host contract and is
 * removed as those modules migrate.
 *
 * @internal
 */
export interface LegacyRuntimePlatform {
  readonly binary: {
    readonly alloc: LegacyFunction;
    readonly byteLength: LegacyFunction;
    readonly concat: LegacyFunction;
    readonly from: LegacyFunction;
    readonly isBuffer: LegacyFunction;
  };
  readonly compression: {
    readonly inflateRaw: LegacyFunction;
  };
  readonly crypto: {
    readonly createHash: LegacyFunction;
    readonly randomBytes: LegacyFunction;
    readonly randomUUID: LegacyFunction;
  };
  readonly database: {
    readonly module: PlatformModule;
    readonly open: (file: File, flags: number) => Promise<any>;
  };
  readonly files: {
    readonly access: LegacyFunction;
    readonly appendFile: LegacyFunction;
    readonly chmod: LegacyFunction;
    readonly constants: {
      readonly O_CREAT: number;
      readonly O_RDONLY: number;
      readonly O_WRONLY: number;
    };
    readonly copyFile: LegacyFunction;
    readonly createReadStream: LegacyFunction;
    readonly createWriteStream: LegacyFunction;
    readonly existsSync: LegacyFunction;
    readonly mkdir: LegacyFunction;
    readonly mkdirSync: LegacyFunction;
    readonly mkdtemp: LegacyFunction;
    readonly open: LegacyFunction;
    readonly opendir: LegacyFunction;
    readonly readFile: LegacyFunction;
    readonly readFileSync: LegacyFunction;
    readonly readdir: LegacyFunction;
    readonly realpath: LegacyFunction;
    readonly rename: LegacyFunction;
    readonly rm: LegacyFunction;
    readonly rmdir: LegacyFunction;
    readonly stat: LegacyFunction;
    readonly statSync: LegacyFunction;
    readonly unlink: LegacyFunction;
    readonly writeFile: LegacyFunction;
  };
  readonly paths: {
    readonly basename: LegacyFunction;
    readonly dirname: LegacyFunction;
    readonly extname: LegacyFunction;
    readonly isAbsolute: LegacyFunction;
    readonly join: LegacyFunction;
    readonly parse: LegacyFunction;
    readonly posix: Record<string, any>;
    readonly relative: LegacyFunction;
    readonly resolve: LegacyFunction;
  };
  readonly execution: {
    readonly argv: readonly string[];
    readonly cwd: LegacyFunction;
    readonly env: Record<string, string | undefined>;
    readonly kill: LegacyFunction;
    readonly once: LegacyFunction;
    readonly pid: number;
    readonly removeListener: LegacyFunction;
    readonly stderr: unknown;
  };
  readonly streams: {
    readonly finished: LegacyFunction;
    readonly PassThrough: new (...args: any[]) => any;
    readonly pipeline: LegacyFunction;
    readonly readLines: (input: any) => AsyncIterable<string>;
    readonly Writable: new (...args: any[]) => any;
  };
  readonly subprocess: {
    readonly spawn: LegacyFunction;
  };
  readonly system: {
    readonly homedir: LegacyFunction;
    readonly tmpdir: LegacyFunction;
  };
  readonly timers: {
    readonly sleep: LegacyFunction;
  };
  readonly url: {
    readonly fileURLToPath: LegacyFunction;
  };
  readonly zip: {
    readonly open: LegacyFunction;
    readonly Writer: new (...args: any[]) => any;
  };
}
