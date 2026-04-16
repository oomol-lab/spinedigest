import type { LLMessage } from "../llm/index.js";
import {
  GuaranteedEmptyResponseError,
  GuaranteedParseValidationError,
  GuaranteedSchemaValidationError,
  ParsedJsonError,
  SuspectedModelRefusalError,
} from "./errors.js";
import {
  buildBusinessErrorMessage,
  buildSchemaErrorMessage,
  buildSyntaxErrorMessage,
  extractJsonText,
  listSchemaIssues,
  repairJsonText,
} from "./response.js";
import type { GuaranteedRequestOptions } from "./types.js";

const DEFAULT_MAX_RETRIES = 7;

export async function requestGuaranteedJson<TData, TResult>(
  options: GuaranteedRequestOptions<TData, TResult>,
): Promise<TResult> {
  const initialMessages = [...options.messages];
  let currentMessages = [...options.messages];
  let consecutiveJsonSyntaxErrors = 0;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;

  for (let index = 0; index <= maxRetries; index += 1) {
    const response = await options.request(currentMessages, index, maxRetries);
    if (response === undefined || response.trim() === "") {
      if (index >= maxRetries) {
        throw new GuaranteedEmptyResponseError(index + 1, maxRetries);
      }
      continue;
    }
    let parsedData: unknown;

    try {
      const extractedJsonText = extractJsonText(response);
      const repairedJsonText = repairJsonText(extractedJsonText);

      parsedData = JSON.parse(repairedJsonText);
    } catch (error) {
      consecutiveJsonSyntaxErrors += 1;

      if (consecutiveJsonSyntaxErrors >= 2 || index >= maxRetries) {
        const reason =
          index >= maxRetries
            ? "last retry still returned non-JSON content"
            : "two consecutive retries returned non-JSON content";
        throw new SuspectedModelRefusalError(index + 1, maxRetries, {
          response,
          reason,
        });
      }
      currentMessages = buildRetryMessages(
        initialMessages,
        response,
        buildSyntaxErrorMessage(asSyntaxError(error)),
      );
      continue;
    }
    consecutiveJsonSyntaxErrors = 0;

    const validation = await options.schema.safeParseAsync(parsedData);

    if (!validation.success) {
      const feedback = buildSchemaErrorMessage(validation.error);

      if (index >= maxRetries) {
        throw new GuaranteedSchemaValidationError(
          index + 1,
          maxRetries,
          {
            issues: listSchemaIssues(validation.error),
            response,
          },
          validation.error,
        );
      }
      currentMessages = buildRetryMessages(initialMessages, response, feedback);
      continue;
    }

    try {
      return await options.parse(validation.data, index, maxRetries);
    } catch (error) {
      if (!(error instanceof ParsedJsonError)) {
        throw error;
      }
      const feedback = buildBusinessErrorMessage(error.issues);

      if (index >= maxRetries) {
        throw new GuaranteedParseValidationError(
          index + 1,
          maxRetries,
          {
            issues: error.issues,
            response,
          },
          error,
        );
      }
      currentMessages = buildRetryMessages(initialMessages, response, feedback);
    }
  }
  throw new Error("requestGuaranteedJson failed unexpectedly");
}

function buildRetryMessages(
  initialMessages: readonly LLMessage[],
  response: string,
  feedback: string,
): LLMessage[] {
  return [
    ...initialMessages,
    {
      role: "assistant",
      content: response,
    },
    {
      role: "user",
      content: feedback,
    },
  ];
}

function asSyntaxError(error: unknown): SyntaxError {
  if (error instanceof SyntaxError) {
    return error;
  }

  return new SyntaxError(String(error));
}
