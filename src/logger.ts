export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  [key: string]: unknown;
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause:
        error.cause instanceof Error
          ? {
              name: error.cause.name,
              message: error.cause.message,
            }
          : error.cause === undefined
            ? undefined
            : String(error.cause),
    };
  }

  return { message: String(error) };
}

export function log(
  level: LogLevel,
  event: string,
  message: string,
  context: LogContext = {},
  error?: unknown,
) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    message,
    ...context,
    ...(error === undefined ? {} : { error: serializeError(error) }),
  };
  const line = JSON.stringify(entry);

  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}
