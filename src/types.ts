export type Provider = 'catbox' | 'sxcu' | 'imgchest';

export interface UploadResult {
  type: 'success' | 'error' | 'warning';
  url?: string;
  message?: string;
  isAlbum?: boolean;
  isCollection?: boolean;
  isPost?: boolean;
}

export interface RateLimitEntry {
  limit: number;
  remaining: number;
  resetAt: number;
  windowStart: number;
  lastUpdated: number;
}

export interface RateLimitData {
  remaining: number;
  limit: number;
  reset?: number;
  windowStart: number;
}

export interface SxcuRateLimitState {
  buckets: Record<string, RateLimitEntry>;
  global: RateLimitEntry | null;
}

export interface ImgchestRateLimitState {
  default: RateLimitEntry | null;
}

export interface CatboxRateLimitState {
  default: RateLimitEntry | null;
}

export interface AllRateLimits {
  imgchest: ImgchestRateLimitState;
  sxcu: SxcuRateLimitState;
  catbox: CatboxRateLimitState;
}

export interface RateLimitCheckResult {
  allowed: boolean;
  waitMs: number;
  reason?: 'bucket' | 'global' | 'unknown';
  bucket?: string;
  resetAt?: number;
}

export interface RateLimitHeaders {
  limit?: number;
  remaining?: number;
  reset?: number;
  resetAfter?: number;
  bucket?: string;
  isGlobal?: boolean;
}

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterMs: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 5,
  baseDelayMs: 1000,
  maxDelayMs: 120000,
  jitterMs: 500,
};

export const IMGCHEST_RATE_LIMIT = {
  requestsPerMinute: 60,
  windowMs: 60000,
};

export const SXCU_RATE_LIMIT = {
  globalRequestsPerMinute: 240,
  globalWindowMs: 60000,
};

export interface ImgchestPostResponse {
  data: {
    id: string;
    images: Array<{ link: string }>;
  };
  error?: string;
}

export interface SxcuResponse {
  url?: string;
  id?: string;
  error?: string;
  code?: number;
  rateLimitExceeded?: boolean;
  rateLimitReset?: number;
  rateLimitResetAfter?: number;
}

export interface SxcuCollectionResponse {
  collection_id?: string;
  collection_token?: string;
  url?: string;
  error?: string;
  code?: number;
}

export interface WorkerEnv {
  IMGCHEST_API_TOKEN?: string;
  RATE_LIMITER?: DurableObjectNamespace;
}

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

export const ALLOWED_EXTENSIONS = [
  '.png', '.gif', '.jpeg', '.jpg', '.ico', '.bmp',
  '.tiff', '.tif', '.webm', '.webp'
];

export const MAX_IMGCHEST_IMAGES_PER_REQUEST = 20;

export function parseRateLimitHeaders(headers: Headers): RateLimitHeaders {
  const result: RateLimitHeaders = {};

  const limit = headers.get('X-RateLimit-Limit');
  if (limit) result.limit = parseInt(limit, 10);

  const remaining = headers.get('X-RateLimit-Remaining');
  if (remaining !== null) result.remaining = parseInt(remaining, 10);

  const reset = headers.get('X-RateLimit-Reset');
  if (reset) result.reset = parseInt(reset, 10);

  const resetAfter = headers.get('X-RateLimit-Reset-After');
  if (resetAfter) result.resetAfter = parseFloat(resetAfter);

  const bucket = headers.get('X-RateLimit-Bucket');
  if (bucket) result.bucket = bucket;

  const isGlobal = headers.get('X-RateLimit-Global');
  if (isGlobal) result.isGlobal = true;

  return result;
}

export function calculateExponentialBackoff(
  attempt: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): number {
  const exponentialDelay = config.baseDelayMs * Math.pow(2, attempt);
  const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);
  const jitter = Math.random() * config.jitterMs;
  return Math.floor(cappedDelay + jitter);
}

export function calculateWaitTimeFromHeaders(headers: RateLimitHeaders, nowMs: number = Date.now()): number {
  if (headers.resetAfter !== undefined && headers.resetAfter > 0) {
    return Math.ceil(headers.resetAfter * 1000) + 100;
  }

  if (headers.reset !== undefined) {
    const resetMs = headers.reset * 1000;
    if (resetMs > nowMs) {
      return resetMs - nowMs + 100;
    }
  }

  return 60000 + 100;
}

export function isRateLimitExpired(entry: RateLimitEntry, nowMs: number = Date.now()): boolean {
  return nowMs >= entry.resetAt;
}

export function createRateLimitEntry(
  headers: RateLimitHeaders,
  nowMs: number = Date.now()
): RateLimitEntry {
  let resetAt: number;

  if (headers.resetAfter !== undefined) {
    resetAt = nowMs + Math.ceil(headers.resetAfter * 1000);
  } else if (headers.reset !== undefined) {
    resetAt = headers.reset * 1000;
  } else {
    resetAt = nowMs + 60000;
  }

  return {
    limit: headers.limit ?? 60,
    remaining: headers.remaining ?? 59,
    resetAt,
    windowStart: nowMs,
    lastUpdated: nowMs,
  };
}
