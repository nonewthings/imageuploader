import {
  CORS_HEADERS,
  RateLimitEntry,
  AllRateLimits,
  RateLimitCheckResult,
  RateLimitHeaders,
  RetryConfig,
  DEFAULT_RETRY_CONFIG,
  IMGCHEST_RATE_LIMIT,
  SXCU_RATE_LIMIT,
  parseRateLimitHeaders,
  calculateExponentialBackoff,
  calculateWaitTimeFromHeaders,
  isRateLimitExpired,
  createRateLimitEntry,
} from './types';

const SXCU_GLOBAL_BUCKET = '__sxcu_global__';

export class RateLimiter {
  state: DurableObjectState;
  storage: DurableObjectStorage;
  rateLimits: AllRateLimits;

  constructor(state: DurableObjectState) {
    this.state = state;
    this.storage = state.storage;
    this.rateLimits = {
      imgchest: { default: null },
      sxcu: { buckets: {}, global: null },
      catbox: { default: null },
    };

    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.storage.get<AllRateLimits>('rateLimits');
      if (stored) {
        this.rateLimits = stored;
        this.cleanupExpiredEntries();
      }
    });
  }

  private async persistRateLimits(): Promise<void> {
    await this.storage.put('rateLimits', this.rateLimits);
  }

  private cleanupExpiredEntries(): void {
    const now = Date.now();

    if (this.rateLimits.imgchest.default && isRateLimitExpired(this.rateLimits.imgchest.default, now)) {
      this.rateLimits.imgchest.default = null;
    }

    if (this.rateLimits.sxcu.global && isRateLimitExpired(this.rateLimits.sxcu.global, now)) {
      this.rateLimits.sxcu.global = null;
    }

    for (const bucket of Object.keys(this.rateLimits.sxcu.buckets)) {
      if (isRateLimitExpired(this.rateLimits.sxcu.buckets[bucket], now)) {
        delete this.rateLimits.sxcu.buckets[bucket];
      }
    }

    if (this.rateLimits.catbox.default && isRateLimitExpired(this.rateLimits.catbox.default, now)) {
      this.rateLimits.catbox.default = null;
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS, status: 204 });
    }

    this.cleanupExpiredEntries();

    try {
      if (method === 'POST' && path === '/upload/imgchest/post') {
        return await this.handleImgchestPost(request);
      }

      if (method === 'POST' && path.startsWith('/upload/imgchest/post/') && path.endsWith('/add')) {
        return await this.handleImgchestAdd(request);
      }

      if (method === 'POST' && path === '/upload/sxcu/collections') {
        return await this.handleSxcuCollections(request);
      }

      if (method === 'POST' && path === '/upload/sxcu/files') {
        return await this.handleSxcuFiles(request);
      }

      return new Response('Not Found', { status: 404, headers: CORS_HEADERS });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
  }

  private checkImgchestRateLimit(cost: number = 1): RateLimitCheckResult {
    const now = Date.now();
    const entry = this.rateLimits.imgchest.default;

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

  private checkSxcuRateLimit(bucketId: string | null, cost: number = 1): RateLimitCheckResult {
    const now = Date.now();

    const globalEntry = this.rateLimits.sxcu.global;
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
      const bucketEntry = this.rateLimits.sxcu.buckets[bucketId];
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

  private updateImgchestRateLimit(headers: RateLimitHeaders): void {
    const now = Date.now();

    if (headers.limit !== undefined && headers.remaining !== undefined) {
      this.rateLimits.imgchest.default = {
        limit: headers.limit,
        remaining: headers.remaining,
        resetAt: now + IMGCHEST_RATE_LIMIT.windowMs,
        windowStart: now,
        lastUpdated: now,
      };
    } else if (this.rateLimits.imgchest.default) {
      this.rateLimits.imgchest.default.remaining = Math.max(0, this.rateLimits.imgchest.default.remaining - 1);
      this.rateLimits.imgchest.default.lastUpdated = now;
    }

    this.persistRateLimits();
  }

  private updateSxcuRateLimit(headers: RateLimitHeaders, isGlobalError: boolean = false): void {
    const now = Date.now();

    if (isGlobalError || headers.isGlobal) {
      this.rateLimits.sxcu.global = createRateLimitEntry({
        limit: SXCU_RATE_LIMIT.globalRequestsPerMinute,
        remaining: 0,
        resetAfter: headers.resetAfter,
        reset: headers.reset,
      }, now);
    } else {
      if (this.rateLimits.sxcu.global) {
        this.rateLimits.sxcu.global.remaining = Math.max(0, this.rateLimits.sxcu.global.remaining - 1);
        this.rateLimits.sxcu.global.lastUpdated = now;
      } else {
        this.rateLimits.sxcu.global = {
          limit: SXCU_RATE_LIMIT.globalRequestsPerMinute,
          remaining: SXCU_RATE_LIMIT.globalRequestsPerMinute - 1,
          resetAt: now + SXCU_RATE_LIMIT.globalWindowMs,
          windowStart: now,
          lastUpdated: now,
        };
      }
    }

    if (headers.bucket && headers.limit !== undefined && headers.remaining !== undefined) {
      this.rateLimits.sxcu.buckets[headers.bucket] = createRateLimitEntry(headers, now);
    }

    this.persistRateLimits();
  }

  private async waitWithBackoff(
    waitMs: number,
    attempt: number,
    config: RetryConfig = DEFAULT_RETRY_CONFIG
  ): Promise<void> {
    const backoffMs = calculateExponentialBackoff(attempt, config);
    const actualWaitMs = Math.max(waitMs, backoffMs);
    const cappedWaitMs = Math.min(actualWaitMs, config.maxDelayMs);

    await new Promise(resolve => setTimeout(resolve, cappedWaitMs));
  }

  private async executeWithRateLimitRetry<T>(
    provider: 'imgchest' | 'sxcu',
    bucketId: string | null,
    operation: () => Promise<{ response: Response; result: T; isGlobalError?: boolean }>,
    config: RetryConfig = DEFAULT_RETRY_CONFIG
  ): Promise<{ response: Response; result: T | { error: string } }> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      const checkResult = provider === 'imgchest'
        ? this.checkImgchestRateLimit(1)
        : this.checkSxcuRateLimit(bucketId, 1);

      if (!checkResult.allowed) {
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
        await this.waitWithBackoff(checkResult.waitMs, attempt, config);
        this.cleanupExpiredEntries();
        continue;
      }

      try {
        const { response, result, isGlobalError: opIsGlobalError } = await operation();

        if (response.status === 429) {
          const headers = parseRateLimitHeaders(response.headers);
          
          if (provider === 'sxcu') {
            let isGlobalError = headers.isGlobal;
            if (opIsGlobalError !== undefined) {
              isGlobalError = isGlobalError || opIsGlobalError;
            } else if (!isGlobalError && !response.bodyUsed) {
              isGlobalError = await this.isSxcuGlobalError(response.clone());
            }
            this.updateSxcuRateLimit(headers, isGlobalError);
            return { response, result };
          } else {
            this.updateImgchestRateLimit(headers);
          }

          if (attempt === config.maxRetries) {
            throw new Error(`Rate limit exceeded for ${provider} after ${config.maxRetries} retries`);
          }

          const waitMs = calculateWaitTimeFromHeaders(headers);
          await this.waitWithBackoff(waitMs, attempt, config);
          continue;
        }

        return { response, result };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt === config.maxRetries) {
          throw lastError;
        }

        await this.waitWithBackoff(1000, attempt, config);
      }
    }

    throw lastError || new Error('Unknown error during rate-limited operation');
  }

  private async isSxcuGlobalError(response: Response): Promise<boolean> {
    try {
      const json = await response.json() as { code?: number; error?: string };
      return json.code === 2 || (json.error?.includes('Global rate limit') ?? false);
    } catch {
      return false;
    }
  }

  private createResponseHeaders(apiHeaders: Headers): Headers {
    const responseHeaders = new Headers(CORS_HEADERS);
    responseHeaders.set('Content-Type', 'application/json');

    const rateLimitHeaderNames = [
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
      'X-RateLimit-Reset-After',
      'X-RateLimit-Bucket',
      'X-RateLimit-Global',
    ];

    for (const name of rateLimitHeaderNames) {
      const value = apiHeaders.get(name);
      if (value) responseHeaders.set(name, value);
    }

    return responseHeaders;
  }

  private async handleImgchestPost(request: Request): Promise<Response> {
    const authHeader = request.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '') ||
                  (request as unknown as { env?: { IMGCHEST_API_TOKEN?: string } }).env?.IMGCHEST_API_TOKEN;

    if (!token) {
      return new Response(JSON.stringify({
        error: 'Imgchest API token not configured',
        debug: {
          hasAuthHeader: !!authHeader,
          authHeaderValue: authHeader ? authHeader.substring(0, 20) + '...' : null,
        }
      }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        status: 401,
      });
    }

    const formData = await request.formData();
    const images = formData.getAll('images[]') as File[];

    if (images.length === 0) {
      return new Response(JSON.stringify({ error: 'No images provided' }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    const otherEntries: [string, FormDataEntryValue][] = [];
    for (const [key, value] of formData.entries()) {
      if (key !== 'images[]') {
        otherEntries.push([key, value]);
      }
    }

    const MAX_IMAGES_PER_REQUEST = 20;
    const chunks: File[][] = [];
    for (let i = 0; i < images.length; i += MAX_IMAGES_PER_REQUEST) {
      chunks.push(images.slice(i, i + MAX_IMAGES_PER_REQUEST));
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
        const { response, result } = await this.executeWithRateLimitRetry(
          'imgchest',
          null,
          async (): Promise<{ response: Response; result: Record<string, unknown> }> => {
            const resp: Response = await fetch(url, {
              method: 'POST',
              body: chunkFormData,
              headers: { 'Authorization': 'Bearer ' + token },
            });

            const headers = parseRateLimitHeaders(resp.headers);
            this.updateImgchestRateLimit(headers);

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
            headers: this.createResponseHeaders(response.headers),
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
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          status: 500,
        });
      }
    }

    return new Response(JSON.stringify(finalResult), {
      headers: this.createResponseHeaders(lastResponseHeaders || new Headers()),
      status: 200,
    });
  }

  private async handleImgchestAdd(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const postId = pathParts[4];

    const authHeader = request.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '') ||
                  (request as unknown as { env?: { IMGCHEST_API_TOKEN?: string } }).env?.IMGCHEST_API_TOKEN;

    if (!token) {
      return new Response(JSON.stringify({ error: 'Imgchest API token not configured' }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        status: 401,
      });
    }

    const formData = await request.formData();
    const images = formData.getAll('images[]') as File[];

    if (images.length === 0) {
      return new Response(JSON.stringify({ error: 'No images provided' }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    const MAX_IMAGES_PER_REQUEST = 20;
    const chunks: File[][] = [];
    for (let i = 0; i < images.length; i += MAX_IMAGES_PER_REQUEST) {
      chunks.push(images.slice(i, i + MAX_IMAGES_PER_REQUEST));
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
        const { response, result } = await this.executeWithRateLimitRetry(
          'imgchest',
          null,
          async () => {
            const resp = await fetch(`https://api.imgchest.com/v1/post/${postId}/add`, {
              method: 'POST',
              body: chunkFormData,
              headers: { 'Authorization': 'Bearer ' + token },
            });

            const headers = parseRateLimitHeaders(resp.headers);
            this.updateImgchestRateLimit(headers);

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
            headers: this.createResponseHeaders(response.headers),
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
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          status: 500,
        });
      }
    }

    return new Response(JSON.stringify(finalResult), {
      headers: this.createResponseHeaders(lastResponseHeaders || new Headers()),
      status: 200,
    });
  }

  private async handleSxcuCollections(request: Request): Promise<Response> {
    const formData = await request.formData();
    let knownBucket: string | null = null;

    try {
      const { response, result } = await this.executeWithRateLimitRetry(
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

      return new Response(JSON.stringify(result), {
        headers: this.createResponseHeaders(response.headers),
        status: response.ok ? 200 : response.status,
      });

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return new Response(JSON.stringify({ error: message }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        status: 500,
      });
    }
  }

  private async handleSxcuFiles(request: Request): Promise<Response> {
    const formData = await request.formData();
    let knownBucket: string | null = null;

    try {
      const { response, result } = await this.executeWithRateLimitRetry(
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

      return new Response(JSON.stringify(result), {
        headers: this.createResponseHeaders(response.headers),
        status: response.ok ? 200 : response.status,
      });

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return new Response(JSON.stringify({ error: message }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        status: 500,
      });
    }
  }
}
