import { type HostError } from "../runtime/platform/index.js";

export function isHostError(error: unknown): error is HostError {
  return error instanceof Error;
}

export function formatError(error: unknown): string {
  const messages: string[] = [];
  const visited = new Set<unknown>();
  let current: unknown = error;

  while (current !== undefined && !visited.has(current)) {
    visited.add(current);

    if (current instanceof Error) {
      pushErrorMessage(messages, describeError(current));
      current = current.cause;
      continue;
    }

    pushErrorMessage(messages, String(current as unknown));
    break;
  }

  return messages.join(": ");
}

function describeError(error: Error): string {
  const hostError = error as HostError;
  const message = error.message.trim();
  const code =
    typeof hostError.code === "string" && hostError.code !== ""
      ? hostError.code
      : undefined;
  const path =
    typeof hostError.path === "string" && hostError.path !== ""
      ? hostError.path
      : undefined;

  if (code === "ENOENT") {
    return path === undefined
      ? "File not found (ENOENT)"
      : `File not found: ${path} (ENOENT)`;
  }

  if (code === "EACCES" || code === "EPERM") {
    return path === undefined
      ? `Permission denied (${code})`
      : `Permission denied: ${path} (${code})`;
  }

  if (message === "") {
    return code === undefined ? error.name : `${error.name} (${code})`;
  }

  return code === undefined ? message : `${message} (${code})`;
}

function pushErrorMessage(messages: string[], message: string): void {
  const normalizedMessage = message.trim();

  if (normalizedMessage === "") return;

  const lastMessage = messages.at(-1);
  if (lastMessage === undefined) {
    messages.push(normalizedMessage);
    return;
  }
  if (
    lastMessage === normalizedMessage ||
    lastMessage.includes(normalizedMessage)
  ) {
    return;
  }
  if (normalizedMessage.includes(lastMessage)) {
    messages[messages.length - 1] = normalizedMessage;
    return;
  }
  messages.push(normalizedMessage);
}
