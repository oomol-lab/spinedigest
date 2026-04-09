export class ParsedJsonError extends Error {
  public readonly issues: readonly string[];

  public constructor(issues: readonly string[]) {
    super(`Parse failed with ${issues.length} issue(s)`);
    this.name = "ParsedJsonError";
    this.issues = [...issues];
  }
}

export class GuaranteedEmptyResponseError extends Error {
  public readonly attempts: number;
  public readonly maxRetries: number;

  public constructor(input: { attempts: number; maxRetries: number }) {
    super("LLM returned empty response after all retries");
    this.name = "GuaranteedEmptyResponseError";
    this.attempts = input.attempts;
    this.maxRetries = input.maxRetries;
  }
}

export class SuspectedModelRefusalError extends Error {
  public readonly attempts: number;
  public readonly maxRetries: number;
  public readonly response: string;
  public readonly reason: string;

  public constructor(input: {
    attempts: number;
    maxRetries: number;
    response: string;
    reason: string;
  }) {
    super(
      `Suspected model refusal after ${input.attempts} JSON syntax error attempt(s): ${input.reason}. Last response: ${JSON.stringify(input.response)}`,
    );
    this.name = "SuspectedModelRefusalError";
    this.attempts = input.attempts;
    this.maxRetries = input.maxRetries;
    this.response = input.response;
    this.reason = input.reason;
  }
}

export class GuaranteedSchemaValidationError extends Error {
  public readonly attempts: number;
  public readonly issues: readonly string[];
  public readonly maxRetries: number;
  public readonly response: string;

  public constructor(
    input: {
      attempts: number;
      issues: readonly string[];
      maxRetries: number;
      response: string;
    },
    cause: unknown,
  ) {
    super("Schema validation failed after all retries", { cause });
    this.name = "GuaranteedSchemaValidationError";
    this.attempts = input.attempts;
    this.issues = [...input.issues];
    this.maxRetries = input.maxRetries;
    this.response = input.response;
  }
}

export class GuaranteedParseValidationError extends Error {
  public readonly attempts: number;
  public readonly issues: readonly string[];
  public readonly maxRetries: number;
  public readonly response: string;

  public constructor(
    input: {
      attempts: number;
      issues: readonly string[];
      maxRetries: number;
      response: string;
    },
    cause: unknown,
  ) {
    super("Parse validation failed after all retries", { cause });
    this.name = "GuaranteedParseValidationError";
    this.attempts = input.attempts;
    this.issues = [...input.issues];
    this.maxRetries = input.maxRetries;
    this.response = input.response;
  }
}
