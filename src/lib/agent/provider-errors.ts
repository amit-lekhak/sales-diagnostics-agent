import { APICallError } from 'ai';

export type ProviderErrorCode =
  | 'auth'
  | 'rpm'
  | 'tpm'
  | 'quota'
  | 'context_overflow'
  | 'timeout'
  | 'transient'
  | 'unknown';

export type ClassifiedError = {
  code: ProviderErrorCode;
  retryable: boolean;
  retryAfterMs: number | null;
  userMessage: string;
  raw: string;
};

/** Codes where topic/slot gates should fail-open instead of hard-stopping. */
export function isFailOpenCode(code: ProviderErrorCode): boolean {
  return code === 'timeout' || code === 'transient';
}

/** Rate-limit style codes that evals may wait-and-retry once. */
export function isRateLimitCode(code: ProviderErrorCode): boolean {
  return code === 'rpm' || code === 'tpm';
}

function rawFromUnknown(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function collectText(err: unknown): string {
  const parts: string[] = [];
  if (err instanceof Error) {
    parts.push(err.message);
    parts.push(err.name);
  } else {
    parts.push(String(err));
  }
  if (APICallError.isInstance(err)) {
    if (err.responseBody) parts.push(err.responseBody);
    if (err.data != null) {
      try {
        parts.push(JSON.stringify(err.data));
      } catch {
        // ignore
      }
    }
    if (err.statusCode != null) parts.push(`status=${err.statusCode}`);
  }
  return parts.join('\n');
}

/** Parse "Please retry in 56.005s" / Retry-After header style hints. */
export function parseRetryAfterMs(
  message: string,
  headers?: Record<string, string> | undefined,
): number | null {
  if (headers) {
    const retryAfterMs = headers['retry-after-ms'];
    if (retryAfterMs) {
      const ms = parseFloat(retryAfterMs);
      if (!Number.isNaN(ms) && ms >= 0) return Math.ceil(ms);
    }
    const retryAfter = headers['retry-after'];
    if (retryAfter) {
      const seconds = parseFloat(retryAfter);
      if (!Number.isNaN(seconds) && seconds >= 0) {
        return Math.ceil(seconds * 1000);
      }
      const abs = Date.parse(retryAfter) - Date.now();
      if (!Number.isNaN(abs) && abs > 0) return abs;
    }
  }
  const m = message.match(/retry in\s+(\d+(?:\.\d+)?)\s*s/i);
  if (m) return Math.ceil(Number(m[1]) * 1000) + 1000;
  return null;
}

function userMessageFor(code: ProviderErrorCode, retryAfterMs: number | null): string {
  const wait =
    retryAfterMs != null
      ? ` Try again in ${Math.max(1, Math.ceil(retryAfterMs / 1000))} seconds.`
      : '';
  switch (code) {
    case 'auth':
      return 'Gemini API key is invalid or expired. Check GEMINI_API_KEY in .env.local.';
    case 'rpm':
      return `Gemini request rate limit hit.${wait || ' Try again shortly.'}`;
    case 'tpm':
      return `Gemini token rate limit hit.${wait || ' Try again shortly.'}`;
    case 'quota':
      return 'Gemini quota or billing limit reached. Check your Google AI Studio plan and try later.';
    case 'context_overflow':
      return 'This conversation is too long for the model. Start a new chat and try a shorter question.';
    case 'timeout':
      return 'The model timed out. Please try again.';
    case 'transient':
      return `The model is temporarily unavailable.${wait || ' Please try again.'}`;
    default:
      return 'Something went wrong talking to the model. Please try again.';
  }
}

function classifyFromText(
  text: string,
  statusCode: number | undefined,
  isRetryable: boolean | undefined,
  retryAfterMs: number | null,
): ClassifiedError {
  const lower = text.toLowerCase();
  const raw = text.slice(0, 2000);

  const looksAuth =
    statusCode === 401 ||
    statusCode === 403 ||
    /api[_-]?key[_-]?invalid|permission[_-]?denied|unauthenticated|invalid.?api.?key|api key.*(expired|invalid)/i.test(
      text,
    );

  if (looksAuth) {
    return {
      code: 'auth',
      retryable: false,
      retryAfterMs: null,
      userMessage: userMessageFor('auth', null),
      raw,
    };
  }

  const looksContext =
    /context.?length|maximum.?context|token.?count.*exceed|exceeds?.*(maximum|max).*(token|context)|prompt.*(too long|too large)/i.test(
      text,
    ) ||
    (statusCode === 400 && /token/i.test(text) && /exceed/i.test(text));

  if (looksContext) {
    return {
      code: 'context_overflow',
      retryable: false,
      retryAfterMs: null,
      userMessage: userMessageFor('context_overflow', null),
      raw,
    };
  }

  const is429 =
    statusCode === 429 ||
    /resource.?exhausted|rate[- ]?limit|too many requests/i.test(text);

  if (is429 || /quota/i.test(lower)) {
    const isTpm = /token_count|tokens?\s*per\s*min|tpm|generate_content_token/i.test(
      text,
    );
    const isRpm = /_requests|requests?\s*per\s*min|rpm|generate_content_request/i.test(
      text,
    );
    const dailyOrBilling =
      /daily|per.?day|billing|free_tier|exceeded your current quota/i.test(text) &&
      !/retry in/i.test(text) &&
      isRetryable === false;

    let code: ProviderErrorCode = 'rpm';
    if (dailyOrBilling && !isTpm && !isRpm) code = 'quota';
    else if (isTpm) code = 'tpm';
    else if (isRpm) code = 'rpm';
    else if (/quota/i.test(lower) && isRetryable === false && !/retry in/i.test(text))
      code = 'quota';
    else code = 'rpm';

    const wait = retryAfterMs ?? (code === 'rpm' || code === 'tpm' ? 60_000 : null);
    const retryable = code === 'rpm' || code === 'tpm';
    return {
      code,
      retryable,
      retryAfterMs: retryable ? wait : null,
      userMessage: userMessageFor(code, retryable ? wait : null),
      raw,
    };
  }

  if (
    /aborterror|timed?\s*out|timeout|deadline.?exceeded/i.test(text) ||
    statusCode === 408
  ) {
    return {
      code: 'timeout',
      retryable: true,
      retryAfterMs: retryAfterMs,
      userMessage: userMessageFor('timeout', retryAfterMs),
      raw,
    };
  }

  if (
    statusCode === 500 ||
    statusCode === 502 ||
    statusCode === 503 ||
    statusCode === 504 ||
    /unavailable|overloaded|internal.?error|server.?error/i.test(text)
  ) {
    return {
      code: 'transient',
      retryable: true,
      retryAfterMs: retryAfterMs,
      userMessage: userMessageFor('transient', retryAfterMs),
      raw,
    };
  }

  return {
    code: 'unknown',
    retryable: Boolean(isRetryable),
    retryAfterMs: retryAfterMs,
    userMessage: userMessageFor('unknown', retryAfterMs),
    raw,
  };
}

export function classifyProviderError(err: unknown): ClassifiedError {
  if (
    err &&
    typeof err === 'object' &&
    'name' in err &&
    (err as { name: string }).name === 'AbortError'
  ) {
    const raw = rawFromUnknown(err);
    return {
      code: 'timeout',
      retryable: true,
      retryAfterMs: null,
      userMessage: userMessageFor('timeout', null),
      raw,
    };
  }

  if (err instanceof Error && err.name === 'TimeoutError') {
    const raw = err.message;
    return {
      code: 'timeout',
      retryable: true,
      retryAfterMs: null,
      userMessage: userMessageFor('timeout', null),
      raw,
    };
  }

  const text = collectText(err);
  const statusCode = APICallError.isInstance(err) ? err.statusCode : undefined;
  const isRetryable = APICallError.isInstance(err) ? err.isRetryable : undefined;
  const headers = APICallError.isInstance(err) ? err.responseHeaders : undefined;
  const retryAfterMs = parseRetryAfterMs(text, headers);

  return classifyFromText(text, statusCode, isRetryable, retryAfterMs);
}
