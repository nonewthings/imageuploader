import { serve } from 'bun';
import { writeFileSync, unlinkSync, mkdirSync, existsSync, readFileSync } from 'fs';
import {
  RateLimitEntry,
  AllRateLimits,
  RateLimitCheckResult,
  RateLimitHeaders,
  RetryConfig,
  DEFAULT_RETRY_CONFIG,
  IMGCHEST_RATE_LIMIT,
  SXCU_RATE_LIMIT,
  MAX_IMGCHEST_IMAGES_PER_REQUEST,
  parseRateLimitHeaders,
  calculateExponentialBackoff,
  calculateWaitTimeFromHeaders,
  isRateLimitExpired,
  createRateLimitEntry,
} from './types';

const PORT = 3000;
const TEMP_DIR = 'C:\\Users\\lenovo\\AppData\\Local\\Temp';
const RATE_LIMIT_FILE = `${TEMP_DIR}\\image_uploader_rate_limits.json`;
const SXCU_GLOBAL_BUCKET = '__sxcu_global__';
const DEBUG = process.env.DEBUG === 'true';

let rateLimits: AllRateLimits = {
  imgchest: { default: null },
  sxcu: { buckets: {}, global: null },
  catbox: { default: null },
};

function loadRateLimits(): void {
  if (existsSync(RATE_LIMIT_FILE)) {
    try {
      rateLimits = JSON.parse(readFileSync(RATE_LIMIT_FILE, 'utf-8'));
      cleanupExpiredEntries();
    } catch {
      rateLimits = {
        imgchest: { default: null },
        sxcu: { buckets: {}, global: null },
        catbox: { default: null },
      };
    }
  }
}

function resetRateLimits(): void {
  rateLimits = {
    imgchest: { default: null },
    sxcu: { buckets: {}, global: null },
    catbox: { default: null },
  };
}

function saveRateLimits(): void {
  writeFileSync(RATE_LIMIT_FILE, JSON.stringify(rateLimits, null, 2));
}

function cleanupExpiredEntries(): void {
  const now = Date.now();

  if (rateLimits.imgchest.default && isRateLimitExpired(rateLimits.imgchest.default, now)) {
    rateLimits.imgchest.default = null;
  }

  if (rateLimits.sxcu.global && isRateLimitExpired(rateLimits.sxcu.global, now)) {
    rateLimits.sxcu.global = null;
  }

  for (const bucket of Object.keys(rateLimits.sxcu.buckets)) {
    if (isRateLimitExpired(rateLimits.sxcu.buckets[bucket], now)) {
      delete rateLimits.sxcu.buckets[bucket];
    }
  }

  if (rateLimits.catbox.default && isRateLimitExpired(rateLimits.catbox.default, now)) {
    rateLimits.catbox.default = null;
  }
}

function getImgchestToken(): string | null {
  return process.env.IMGCHEST_API_TOKEN || null;
}

function checkImgchestRateLimit(cost: number = 1): RateLimitCheckResult {
  const now = Date.now();
  const entry = rateLimits.imgchest.default;

  if (!entry || isRateLimitExpired(entry, now)) {
    return { allowed: true, waitMs: 0 };
  }

  if (entry.remaining < cost) {
    const waitMs = entry.resetAt - now + 100;
    return {
      allowed: false,
      waitMs: Math.max(waitMs, 100),
      reason: 'bucket',
      resetAt: entry.resetAt,
    };
  }

  return { allowed: true, waitMs: 0 };
}

function checkSxcuRateLimit(bucketId: string | null, cost: number = 1): RateLimitCheckResult {
  const now = Date.now();

  const globalEntry = rateLimits.sxcu.global;
  if (globalEntry && !isRateLimitExpired(globalEntry, now)) {
    if (globalEntry.remaining < cost) {
      const waitMs = globalEntry.resetAt - now + 100;
      return {
        allowed: false,
        waitMs: Math.max(waitMs, 100),
        reason: 'global',
        bucket: SXCU_GLOBAL_BUCKET,
        resetAt: globalEntry.resetAt,
      };
    }
  }

  if (bucketId) {
    const bucketEntry = rateLimits.sxcu.buckets[bucketId];
    if (bucketEntry && !isRateLimitExpired(bucketEntry, now)) {
      if (bucketEntry.remaining < cost) {
        const waitMs = bucketEntry.resetAt - now + 100;
        return {
          allowed: false,
          waitMs: Math.max(waitMs, 100),
          reason: 'bucket',
          bucket: bucketId,
          resetAt: bucketEntry.resetAt,
        };
      }
    }
  }

  return { allowed: true, waitMs: 0 };
}

function updateImgchestRateLimit(headers: RateLimitHeaders): void {
  const now = Date.now();

  if (headers.limit !== undefined && headers.remaining !== undefined) {
    rateLimits.imgchest.default = {
      limit: headers.limit,
      remaining: headers.remaining,
      resetAt: now + IMGCHEST_RATE_LIMIT.windowMs,
      windowStart: now,
      lastUpdated: now,
    };
  } else if (rateLimits.imgchest.default) {
    rateLimits.imgchest.default.remaining = Math.max(0, rateLimits.imgchest.default.remaining - 1);
    rateLimits.imgchest.default.lastUpdated = now;
  }

  saveRateLimits();
}

function updateSxcuRateLimit(headers: RateLimitHeaders, isGlobalError: boolean = false): void {
  const now = Date.now();

  if (isGlobalError || headers.isGlobal) {
    rateLimits.sxcu.global = createRateLimitEntry({
      limit: SXCU_RATE_LIMIT.globalRequestsPerMinute,
      remaining: 0,
      resetAfter: headers.resetAfter,
      reset: headers.reset,
    }, now);
  } else {
    if (rateLimits.sxcu.global) {
      rateLimits.sxcu.global.remaining = Math.max(0, rateLimits.sxcu.global.remaining - 1);
      rateLimits.sxcu.global.lastUpdated = now;
    } else {
      rateLimits.sxcu.global = {
        limit: SXCU_RATE_LIMIT.globalRequestsPerMinute,
        remaining: SXCU_RATE_LIMIT.globalRequestsPerMinute - 1,
        resetAt: now + SXCU_RATE_LIMIT.globalWindowMs,
        windowStart: now,
        lastUpdated: now,
      };
    }
  }

  if (headers.bucket && headers.limit !== undefined && headers.remaining !== undefined) {
    rateLimits.sxcu.buckets[headers.bucket] = createRateLimitEntry(headers, now);
  }

  saveRateLimits();
}

async function waitWithBackoff(
  waitMs: number,
  attempt: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<void> {
  const backoffMs = calculateExponentialBackoff(attempt, config);
  const actualWaitMs = Math.max(waitMs, backoffMs);
  const cappedWaitMs = Math.min(actualWaitMs, config.maxDelayMs);

  if (DEBUG) {
    console.log(`[Rate Limit] Waiting ${cappedWaitMs}ms before retry (attempt ${attempt + 1})`);
  }
  await new Promise(resolve => setTimeout(resolve, cappedWaitMs));
}

async function executeWithRateLimitRetry<T>(
  provider: 'imgchest' | 'sxcu',
  bucketId: string | null,
  operation: () => Promise<{ response: Response; result: T; isGlobalError?: boolean }>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<{ response: Response; result: T | { error: string } }> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    cleanupExpiredEntries();

    const checkResult = provider === 'imgchest'
      ? checkImgchestRateLimit(1)
      : checkSxcuRateLimit(bucketId, 1);

    if (!checkResult.allowed) {
      if (DEBUG) {
        console.log(`[Rate Limit] Pre-flight check failed for ${provider}: ${checkResult.reason}`);
      }

      if (provider === 'sxcu') {
        const headers = new Headers();
        headers.set('X-RateLimit-Remaining', '0');
        if (checkResult.resetAt) {
          headers.set('X-RateLimit-Reset', Math.ceil(checkResult.resetAt / 1000).toString());
        }
        headers.set('X-RateLimit-Limit', '5');
        if (checkResult.bucket) headers.set('X-RateLimit-Bucket', checkResult.bucket);
        if (checkResult.reason === 'global') headers.set('X-RateLimit-Global', 'true');

        return {
          response: new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
            status: 429,
            headers,
          }),
          result: { error: 'Rate limit exceeded' }
        };
      }

      if (attempt === config.maxRetries) {
        throw new Error(`Rate limit exceeded for ${provider}. Reset at: ${new Date(checkResult.resetAt || Date.now()).toISOString()}`);
      }
      await waitWithBackoff(checkResult.waitMs, attempt, config);
      continue;
    }

    try {
      const { response, result, isGlobalError: opIsGlobalError } = await operation();

      if (response.status === 429) {
        const headers = parseRateLimitHeaders(response.headers);
        let isGlobalError = headers.isGlobal;
        
        if (provider === 'sxcu') {
          if (opIsGlobalError !== undefined) {
            isGlobalError = isGlobalError || opIsGlobalError;
          } else if (!isGlobalError && !response.bodyUsed) {
            isGlobalError = await isSxcuGlobalError(response.clone());
          }
          updateSxcuRateLimit(headers, isGlobalError);
          return { response, result };
        } else {
          updateImgchestRateLimit(headers);
        }

        if (DEBUG) {
          console.log(`[Rate Limit] Received 429 for ${provider}, global: ${isGlobalError}`);
        }

        if (attempt === config.maxRetries) {
          throw new Error(`Rate limit exceeded for ${provider} after ${config.maxRetries} retries`);
        }

        const waitMs = calculateWaitTimeFromHeaders(headers);
        await waitWithBackoff(waitMs, attempt, config);
        continue;
      }

      return { response, result };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (DEBUG) {
        console.error(`[Rate Limit] Error on attempt ${attempt + 1}:`, lastError.message);
      }

      if (attempt === config.maxRetries) {
        throw lastError;
      }

      await waitWithBackoff(1000, attempt, config);
    }
  }

  throw lastError || new Error('Unknown error during rate-limited operation');
}

async function isSxcuGlobalError(response: Response): Promise<boolean> {
  try {
    const json = await response.json() as { code?: number; error?: string };
    return json.code === 2 || (json.error?.includes('Global rate limit') ?? false);
  } catch {
    return false;
  }
}

async function handleCatboxUpload(req: Request): Promise<Response> {
  const formData = await req.formData();
  const reqtype = formData.get('reqtype') as string;

  const validReqTypes = ['fileupload', 'urlupload', 'createalbum'];
  if (!validReqTypes.includes(reqtype)) {
    return new Response(JSON.stringify({ error: 'Unknown request type' }), {
      headers: { 'Content-Type': 'application/json' },
      status: 400,
    });
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= DEFAULT_RETRY_CONFIG.maxRetries; attempt++) {
    try {
      const response = await fetch('https://catbox.moe/user/api.php', {
        method: 'POST',
        body: formData,
        headers: {
          'User-Agent': 'CatboxUploader/2.0',
        },
      });

      const text = await response.text();

      if (response.ok) {
        return new Response(text, { status: 200 });
      }

      if (response.status === 429) {
        if (DEBUG) {
          console.log(`[Catbox] Rate limited, attempt ${attempt + 1}`);
        }
        if (attempt < DEFAULT_RETRY_CONFIG.maxRetries) {
          const waitMs = calculateExponentialBackoff(attempt);
          await new Promise(resolve => setTimeout(resolve, waitMs));
          continue;
        }
      }

      return new Response(text, { status: response.status });

    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (DEBUG) {
        console.error(`[Catbox] Error on attempt ${attempt + 1}:`, lastError.message);
      }

      if (attempt < DEFAULT_RETRY_CONFIG.maxRetries) {
        const waitMs = calculateExponentialBackoff(attempt);
        await new Promise(resolve => setTimeout(resolve, waitMs));
        continue;
      }
    }
  }

  return new Response(JSON.stringify({ error: lastError?.message || 'Unknown error' }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function handleSxcuCollections(req: Request): Promise<Response> {
  const formData = await req.formData();
  let knownBucket: string | null = null;

  try {
    const { response, result } = await executeWithRateLimitRetry(
      'sxcu',
      knownBucket,
      async () => {
        const resp = await fetch('https://sxcu.net/api/collections/create', {
          method: 'POST',
          body: formData,
          headers: { 'User-Agent': 'CatboxUploader/2.0' },
        });

        const headers = parseRateLimitHeaders(resp.headers);
        knownBucket = headers.bucket || null;

        const isGlobalError = resp.status === 429 && headers.isGlobal;

        const json = await resp.json();
        return { response: resp, result: json as Record<string, unknown>, isGlobalError };
      }
    );

    const responseHeaders = new Headers({ 'Content-Type': 'application/json' });
    copyRateLimitHeaders(response.headers, responseHeaders);

    return new Response(JSON.stringify(result), {
      headers: responseHeaders,
      status: response.ok ? 200 : response.status,
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      headers: { 'Content-Type': 'application/json' },
      status: 500,
    });
  }
}

async function handleSxcuFiles(req: Request): Promise<Response> {
  const formData = await req.formData();
  let knownBucket: string | null = null;

  try {
    const { response, result } = await executeWithRateLimitRetry(
      'sxcu',
      knownBucket,
      async () => {
        const resp = await fetch('https://sxcu.net/api/files/create', {
          method: 'POST',
          body: formData,
          headers: { 'User-Agent': 'CatboxUploader/2.0' },
        });

        const headers = parseRateLimitHeaders(resp.headers);
        knownBucket = headers.bucket || null;

        const text = await resp.text();
        let json: Record<string, unknown>;

        try {
          json = JSON.parse(text);
        } catch {
          json = { error: text };
        }

        const isGlobalError = resp.status === 429 && (headers.isGlobal || (json as { code?: number }).code === 2);

        return { response: resp, result: json, isGlobalError };
      }
    );

    const responseHeaders = new Headers({ 'Content-Type': 'application/json' });
    copyRateLimitHeaders(response.headers, responseHeaders);

    return new Response(JSON.stringify(result), {
      headers: responseHeaders,
      status: response.ok ? 200 : response.status,
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      headers: { 'Content-Type': 'application/json' },
      status: 500,
    });
  }
}

async function handleImgchestPost(req: Request): Promise<Response> {
  const token = getImgchestToken();
  if (!token) {
    return new Response(JSON.stringify({
      error: 'Imgchest API token not found. Set IMGCHEST_API_TOKEN environment variable in .env file'
    }), {
      headers: { 'Content-Type': 'application/json' },
      status: 401,
    });
  }

  const formData = await req.formData();
  const images = formData.getAll('images[]') as File[];

  if (images.length === 0) {
    return new Response(JSON.stringify({ error: 'No images provided' }), {
      headers: { 'Content-Type': 'application/json' },
      status: 400,
    });
  }

  const otherEntries: [string, FormDataEntryValue][] = [];
  for (const [key, value] of formData.entries()) {
    if (key !== 'images[]') {
      otherEntries.push([key, value]);
    }
  }

  const chunks: File[][] = [];
  for (let i = 0; i < images.length; i += MAX_IMGCHEST_IMAGES_PER_REQUEST) {
    chunks.push(images.slice(i, i + MAX_IMGCHEST_IMAGES_PER_REQUEST));
  }

  let finalResult: Record<string, unknown> | null = null;
  let lastResponseHeaders: Headers | null = null;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const isFirstChunk = i === 0;

    const chunkFormData = new FormData();
    if (isFirstChunk) {
      for (const [key, value] of otherEntries) {
        chunkFormData.append(key, value);
      }
    }
    for (const image of chunk) {
      chunkFormData.append('images[]', image);
    }

    const url: string = isFirstChunk
      ? 'https://api.imgchest.com/v1/post'
      : `https://api.imgchest.com/v1/post/${(finalResult as { data: { id: string } })?.data?.id}/add`;

    try {
      const { response, result } = await executeWithRateLimitRetry(
        'imgchest',
        null,
        async (): Promise<{ response: Response; result: Record<string, unknown> }> => {
          const resp: Response = await fetch(url, {
            method: 'POST',
            body: chunkFormData,
            headers: { 'Authorization': 'Bearer ' + token },
          });

          const headers = parseRateLimitHeaders(resp.headers);
          updateImgchestRateLimit(headers);

          const text = await resp.text();

          if (text.trim().startsWith('<')) {
            throw new Error('Unauthorized or API error - received HTML response');
          }

          let json: Record<string, unknown>;
          try {
            json = JSON.parse(text);
          } catch {
            throw new Error(`Failed to parse JSON: ${text.substring(0, 200)}`);
          }

          return { response: resp, result: json };
        }
      );

      if (!response.ok) {
        return new Response(JSON.stringify({
          error: 'Imgchest API error',
          status: response.status,
          details: result,
          chunk: i + 1,
        }), {
          headers: { 'Content-Type': 'application/json' },
          status: response.status,
        });
      }

      finalResult = result;
      lastResponseHeaders = response.headers;

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return new Response(JSON.stringify({
        error: message,
        chunk: i + 1,
      }), {
        headers: { 'Content-Type': 'application/json' },
        status: 500,
      });
    }
  }

  const responseHeaders = new Headers({ 'Content-Type': 'application/json' });
  if (lastResponseHeaders) {
    copyRateLimitHeaders(lastResponseHeaders, responseHeaders);
  }

  return new Response(JSON.stringify(finalResult), {
    headers: responseHeaders,
    status: 200,
  });
}

async function handleImgchestAdd(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pathParts = url.pathname.split('/');
  const postId = pathParts[4];

  const token = getImgchestToken();
  if (!token) {
    return new Response(JSON.stringify({ error: 'Imgchest API token not found' }), {
      headers: { 'Content-Type': 'application/json' },
      status: 401,
    });
  }

  const formData = await req.formData();
  const images = formData.getAll('images[]') as File[];

  if (images.length === 0) {
    return new Response(JSON.stringify({ error: 'No images provided' }), {
      headers: { 'Content-Type': 'application/json' },
      status: 400,
    });
  }

  const chunks: File[][] = [];
  for (let i = 0; i < images.length; i += MAX_IMGCHEST_IMAGES_PER_REQUEST) {
    chunks.push(images.slice(i, i + MAX_IMGCHEST_IMAGES_PER_REQUEST));
  }

  let finalResult: Record<string, unknown> | null = null;
  let lastResponseHeaders: Headers | null = null;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const chunkFormData = new FormData();
    for (const image of chunk) {
      chunkFormData.append('images[]', image);
    }

    try {
      const { response, result } = await executeWithRateLimitRetry(
        'imgchest',
        null,
        async () => {
          const resp = await fetch(`https://api.imgchest.com/v1/post/${postId}/add`, {
            method: 'POST',
            body: chunkFormData,
            headers: { 'Authorization': 'Bearer ' + token },
          });

          const headers = parseRateLimitHeaders(resp.headers);
          updateImgchestRateLimit(headers);

          const text = await resp.text();

          if (text.trim().startsWith('<')) {
            throw new Error('Unauthorized or API error - received HTML response');
          }

          let json: Record<string, unknown>;
          try {
            json = JSON.parse(text);
          } catch {
            throw new Error(`Failed to parse JSON: ${text.substring(0, 200)}`);
          }

          return { response: resp, result: json };
        }
      );

      if (!response.ok) {
        return new Response(JSON.stringify({
          error: 'Imgchest API error',
          status: response.status,
          details: result,
          chunk: i + 1,
        }), {
          headers: { 'Content-Type': 'application/json' },
          status: response.status,
        });
      }

      finalResult = result;
      lastResponseHeaders = response.headers;

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return new Response(JSON.stringify({
        error: message,
        chunk: i + 1,
      }), {
        headers: { 'Content-Type': 'application/json' },
        status: 500,
      });
    }
  }

  const responseHeaders = new Headers({ 'Content-Type': 'application/json' });
  if (lastResponseHeaders) {
    copyRateLimitHeaders(lastResponseHeaders, responseHeaders);
  }

  return new Response(JSON.stringify(finalResult), {
    headers: responseHeaders,
    status: 200,
  });
}

function copyRateLimitHeaders(from: Headers, to: Headers): void {
  const rateLimitHeaderNames = [
    'X-RateLimit-Limit',
    'X-RateLimit-Remaining',
    'X-RateLimit-Reset',
    'X-RateLimit-Reset-After',
    'X-RateLimit-Bucket',
    'X-RateLimit-Global',
  ];

  for (const name of rateLimitHeaderNames) {
    const value = from.get(name);
    if (value) to.set(name, value);
  }
}

if (import.meta.main) {
  if (!existsSync(TEMP_DIR)) {
    mkdirSync(TEMP_DIR, { recursive: true });
  }

  loadRateLimits();

  const server = serve({
    port: PORT,

    fetch(req: Request): Response | Promise<Response> {
      const url = new URL(req.url);
      const method = req.method;
      const path = url.pathname;

      cleanupExpiredEntries();

      if (method === 'POST' && path === '/upload/catbox') {
        return handleCatboxUpload(req);
      }

      if (method === 'POST' && path === '/upload/sxcu/collections') {
        return handleSxcuCollections(req);
      }

      if (method === 'POST' && path === '/upload/sxcu/files') {
        return handleSxcuFiles(req);
      }

      if (method === 'POST' && path === '/upload/imgchest/post') {
        return handleImgchestPost(req);
      }

      if (method === 'POST' && path.startsWith('/upload/imgchest/post/') && path.endsWith('/add')) {
        return handleImgchestAdd(req);
      }

      const filePath = path === '/' ? './index.html' : '.' + path;
      if (existsSync(filePath)) {
        const file = Bun.file(filePath);
        const ext = filePath.split('.').pop() || '';
        const contentTypes: Record<string, string> = {
          html: 'text/html',
          css: 'text/css',
          js: 'application/javascript',
        };
        return new Response(file, {
          headers: { 'Content-Type': contentTypes[ext] || 'text/plain' },
        });
      }
      return new Response('Not Found', { status: 404 });
    },
  });

  console.log(`Server running at http://localhost:${PORT}`);
}

export {
  getImgchestToken,
  loadRateLimits,
  saveRateLimits,
  resetRateLimits,
  cleanupExpiredEntries,
  checkImgchestRateLimit,
  checkSxcuRateLimit,
  updateImgchestRateLimit,
  updateSxcuRateLimit,
  executeWithRateLimitRetry,
  handleCatboxUpload,
  handleSxcuCollections,
  handleSxcuFiles,
  handleImgchestPost,
  handleImgchestAdd,
  MAX_IMGCHEST_IMAGES_PER_REQUEST,
};
