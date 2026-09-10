import assert from 'node:assert/strict';
import { APICallError } from 'ai';
import { describe, it } from 'node:test';
import {
  classifyProviderError,
  isFailOpenCode,
  isRateLimitCode,
  parseRetryAfterMs,
} from './provider-errors';

describe('parseRetryAfterMs', () => {
  it('parses Please retry in Ns', () => {
    const ms = parseRetryAfterMs('Please retry in 56.005s');
    assert.equal(ms, 57005);
  });

  it('reads retry-after-ms header', () => {
    const ms = parseRetryAfterMs('rate limited', { 'retry-after-ms': '1200' });
    assert.equal(ms, 1200);
  });
});

describe('classifyProviderError', () => {
  it('maps API_KEY_INVALID / 401 to auth', () => {
    const err = new APICallError({
      message: 'API key not valid. Please pass a valid API key.',
      url: 'https://generativelanguage.googleapis.com',
      requestBodyValues: {},
      statusCode: 401,
      responseHeaders: {},
      responseBody: JSON.stringify({
        error: { status: 'UNAUTHENTICATED', message: 'API_KEY_INVALID' },
      }),
      isRetryable: false,
    });
    const c = classifyProviderError(err);
    assert.equal(c.code, 'auth');
    assert.equal(c.retryable, false);
    assert.match(c.userMessage, /API key/i);
  });

  it('maps 429 request quota to rpm with retry hint', () => {
    const err = new APICallError({
      message:
        'Resource exhausted. You exceeded your current quota. Please retry in 56.005s.',
      url: 'https://generativelanguage.googleapis.com',
      requestBodyValues: {},
      statusCode: 429,
      responseHeaders: {},
      responseBody: JSON.stringify({
        error: {
          status: 'RESOURCE_EXHAUSTED',
          message:
            'Quota exceeded for metric generate_content_requests. Please retry in 56.005s.',
        },
      }),
      isRetryable: true,
    });
    const c = classifyProviderError(err);
    assert.equal(c.code, 'rpm');
    assert.equal(c.retryable, true);
    assert.ok(c.retryAfterMs != null && c.retryAfterMs >= 56000);
    assert.match(c.userMessage, /rate limit/i);
    assert.ok(isRateLimitCode(c.code));
  });

  it('maps 429 token_count quota to tpm', () => {
    const err = new APICallError({
      message: 'Resource exhausted: generate_content_token_count',
      url: 'https://generativelanguage.googleapis.com',
      requestBodyValues: {},
      statusCode: 429,
      responseHeaders: { 'retry-after': '30' },
      responseBody:
        'Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_token_count',
      isRetryable: true,
    });
    const c = classifyProviderError(err);
    assert.equal(c.code, 'tpm');
    assert.equal(c.retryable, true);
    assert.equal(c.retryAfterMs, 30_000);
  });

  it('maps non-retryable daily quota to quota', () => {
    const err = new APICallError({
      message: 'You exceeded your current quota for free_tier daily limit',
      url: 'https://generativelanguage.googleapis.com',
      requestBodyValues: {},
      statusCode: 429,
      responseHeaders: {},
      responseBody: 'free_tier billing daily quota exceeded',
      isRetryable: false,
    });
    const c = classifyProviderError(err);
    assert.equal(c.code, 'quota');
    assert.equal(c.retryable, false);
  });

  it('maps context overflow', () => {
    const err = new APICallError({
      message: 'The input token count exceeds the maximum number of tokens allowed',
      url: 'https://generativelanguage.googleapis.com',
      requestBodyValues: {},
      statusCode: 400,
      responseHeaders: {},
      responseBody: 'token count exceeds maximum context length',
      isRetryable: false,
    });
    const c = classifyProviderError(err);
    assert.equal(c.code, 'context_overflow');
  });

  it('maps AbortError to timeout (fail-open eligible)', () => {
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    const c = classifyProviderError(err);
    assert.equal(c.code, 'timeout');
    assert.ok(isFailOpenCode(c.code));
  });

  it('maps 503 to transient (fail-open eligible)', () => {
    const err = new APICallError({
      message: 'Service unavailable',
      url: 'https://generativelanguage.googleapis.com',
      requestBodyValues: {},
      statusCode: 503,
      responseHeaders: {},
      responseBody: 'overloaded',
      isRetryable: true,
    });
    const c = classifyProviderError(err);
    assert.equal(c.code, 'transient');
    assert.ok(isFailOpenCode(c.code));
  });

  it('classifies string fallbacks used by evals', () => {
    const c = classifyProviderError(
      'RESOURCE_EXHAUSTED: Please retry in 12.5s. Quota for generate_content_requests',
    );
    assert.equal(c.code, 'rpm');
    assert.ok(c.retryAfterMs != null && c.retryAfterMs >= 12500);
  });
});
