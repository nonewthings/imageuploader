import { test, expect, describe } from 'bun:test';
import {
  RateLimitEntry,
  RateLimitHeaders,
  DEFAULT_RETRY_CONFIG,
  IMGCHEST_RATE_LIMIT,
  SXCU_RATE_LIMIT,
  parseRateLimitHeaders,
  calculateExponentialBackoff,
  calculateWaitTimeFromHeaders,
  isRateLimitExpired,
  createRateLimitEntry,
} from '../src/types';

describe('parseRateLimitHeaders', () => {
  test('parses all rate limit headers', () => {
    const headers = new Headers({
      'X-RateLimit-Limit': '60',
      'X-RateLimit-Remaining': '55',
      'X-RateLimit-Reset': '1704067200',
      'X-RateLimit-Reset-After': '30.5',
      'X-RateLimit-Bucket': 'test-bucket',
      'X-RateLimit-Global': 'true',
    });

    const result = parseRateLimitHeaders(headers);

    expect(result.limit).toBe(60);
    expect(result.remaining).toBe(55);
    expect(result.reset).toBe(1704067200);
    expect(result.resetAfter).toBe(30.5);
    expect(result.bucket).toBe('test-bucket');
    expect(result.isGlobal).toBe(true);
  });

  test('handles missing headers', () => {
    const headers = new Headers({});

    const result = parseRateLimitHeaders(headers);

    expect(result.limit).toBeUndefined();
    expect(result.remaining).toBeUndefined();
    expect(result.reset).toBeUndefined();
    expect(result.resetAfter).toBeUndefined();
    expect(result.bucket).toBeUndefined();
    expect(result.isGlobal).toBeUndefined();
  });

  test('handles partial headers', () => {
    const headers = new Headers({
      'X-RateLimit-Limit': '100',
      'X-RateLimit-Remaining': '50',
    });

    const result = parseRateLimitHeaders(headers);

    expect(result.limit).toBe(100);
    expect(result.remaining).toBe(50);
    expect(result.reset).toBeUndefined();
  });
});

describe('calculateExponentialBackoff', () => {
  test('calculates increasing delays', () => {
    const delay0 = calculateExponentialBackoff(0);
    const delay1 = calculateExponentialBackoff(1);
    const delay2 = calculateExponentialBackoff(2);
    const delay3 = calculateExponentialBackoff(3);

    expect(delay0).toBeGreaterThanOrEqual(DEFAULT_RETRY_CONFIG.baseDelayMs);
    expect(delay0).toBeLessThanOrEqual(DEFAULT_RETRY_CONFIG.baseDelayMs + DEFAULT_RETRY_CONFIG.jitterMs);

    expect(delay1).toBeGreaterThan(delay0);
    expect(delay2).toBeGreaterThan(delay1);
    expect(delay3).toBeGreaterThan(delay2);
  });

  test('caps delay at maxDelayMs', () => {
    const delay = calculateExponentialBackoff(20);
    expect(delay).toBeLessThanOrEqual(DEFAULT_RETRY_CONFIG.maxDelayMs + DEFAULT_RETRY_CONFIG.jitterMs);
  });

  test('uses custom config', () => {
    const customConfig = {
      maxRetries: 3,
      baseDelayMs: 500,
      maxDelayMs: 5000,
      jitterMs: 100,
    };

    const delay = calculateExponentialBackoff(0, customConfig);

    expect(delay).toBeGreaterThanOrEqual(customConfig.baseDelayMs);
    expect(delay).toBeLessThanOrEqual(customConfig.baseDelayMs + customConfig.jitterMs);
  });
});

describe('calculateWaitTimeFromHeaders', () => {
  test('uses resetAfter when available', () => {
    const headers: RateLimitHeaders = { resetAfter: 30 };
    const waitTime = calculateWaitTimeFromHeaders(headers);

    expect(waitTime).toBe(30100);
  });

  test('uses reset timestamp when resetAfter not available', () => {
    const now = Date.now();
    const resetInFuture = Math.floor(now / 1000) + 45;
    const headers: RateLimitHeaders = { reset: resetInFuture };

    const waitTime = calculateWaitTimeFromHeaders(headers, now);

    expect(waitTime).toBeGreaterThanOrEqual(44000);
    expect(waitTime).toBeLessThanOrEqual(46000);
  });

  test('defaults to 60 seconds when no headers', () => {
    const headers: RateLimitHeaders = {};
    const waitTime = calculateWaitTimeFromHeaders(headers);

    expect(waitTime).toBe(60100);
  });

  test('returns default when reset is in past', () => {
    const now = Date.now();
    const resetInPast = Math.floor(now / 1000) - 10;
    const headers: RateLimitHeaders = { reset: resetInPast };

    const waitTime = calculateWaitTimeFromHeaders(headers, now);

    expect(waitTime).toBe(60100);
  });
});

describe('isRateLimitExpired', () => {
  test('returns true when entry is expired', () => {
    const now = Date.now();
    const entry: RateLimitEntry = {
      limit: 60,
      remaining: 0,
      resetAt: now - 1000,
      windowStart: now - 61000,
      lastUpdated: now - 1000,
    };

    expect(isRateLimitExpired(entry, now)).toBe(true);
  });

  test('returns false when entry is active', () => {
    const now = Date.now();
    const entry: RateLimitEntry = {
      limit: 60,
      remaining: 30,
      resetAt: now + 30000,
      windowStart: now - 30000,
      lastUpdated: now,
    };

    expect(isRateLimitExpired(entry, now)).toBe(false);
  });

  test('returns true exactly at resetAt', () => {
    const now = Date.now();
    const entry: RateLimitEntry = {
      limit: 60,
      remaining: 0,
      resetAt: now,
      windowStart: now - 60000,
      lastUpdated: now,
    };

    expect(isRateLimitExpired(entry, now)).toBe(true);
  });
});

describe('createRateLimitEntry', () => {
  test('creates entry from headers with resetAfter', () => {
    const now = Date.now();
    const headers: RateLimitHeaders = {
      limit: 60,
      remaining: 55,
      resetAfter: 45.5,
    };

    const entry = createRateLimitEntry(headers, now);

    expect(entry.limit).toBe(60);
    expect(entry.remaining).toBe(55);
    expect(entry.resetAt).toBe(now + 45500);
    expect(entry.windowStart).toBe(now);
    expect(entry.lastUpdated).toBe(now);
  });

  test('creates entry from headers with reset timestamp', () => {
    const now = Date.now();
    const resetTimestamp = Math.floor(now / 1000) + 60;
    const headers: RateLimitHeaders = {
      limit: 100,
      remaining: 50,
      reset: resetTimestamp,
    };

    const entry = createRateLimitEntry(headers, now);

    expect(entry.limit).toBe(100);
    expect(entry.remaining).toBe(50);
    expect(entry.resetAt).toBe(resetTimestamp * 1000);
  });

  test('defaults to 60 second window when no reset info', () => {
    const now = Date.now();
    const headers: RateLimitHeaders = {
      limit: 60,
      remaining: 59,
    };

    const entry = createRateLimitEntry(headers, now);

    expect(entry.resetAt).toBe(now + 60000);
  });

  test('uses defaults when headers are empty', () => {
    const now = Date.now();
    const headers: RateLimitHeaders = {};

    const entry = createRateLimitEntry(headers, now);

    expect(entry.limit).toBe(60);
    expect(entry.remaining).toBe(59);
  });
});

describe('Rate limit constants', () => {
  test('IMGCHEST_RATE_LIMIT has correct values', () => {
    expect(IMGCHEST_RATE_LIMIT.requestsPerMinute).toBe(60);
    expect(IMGCHEST_RATE_LIMIT.windowMs).toBe(60000);
  });

  test('SXCU_RATE_LIMIT has correct values', () => {
    expect(SXCU_RATE_LIMIT.globalRequestsPerMinute).toBe(240);
    expect(SXCU_RATE_LIMIT.globalWindowMs).toBe(60000);
  });

  test('DEFAULT_RETRY_CONFIG has sensible defaults', () => {
    expect(DEFAULT_RETRY_CONFIG.maxRetries).toBe(5);
    expect(DEFAULT_RETRY_CONFIG.baseDelayMs).toBe(1000);
    expect(DEFAULT_RETRY_CONFIG.maxDelayMs).toBe(120000);
    expect(DEFAULT_RETRY_CONFIG.jitterMs).toBe(500);
  });
});
