import { RateLimiter } from './rate-limiter';
import { CORS_HEADERS, DEFAULT_RETRY_CONFIG, calculateExponentialBackoff } from './types';

interface Env {
  IMGCHEST_API_TOKEN?: string;
  RATE_LIMITER?: DurableObjectNamespace;
}

const DEBUG = false;

async function handleCatboxUpload(req: Request): Promise<Response> {
  const formData = await req.formData();
  const reqtype = formData.get('reqtype') as string;

  const validReqTypes = ['fileupload', 'urlupload', 'createalbum'];
  if (!validReqTypes.includes(reqtype)) {
    return new Response(JSON.stringify({ error: 'Unknown request type' }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
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
        return new Response(text, {
          status: 200,
          headers: CORS_HEADERS,
        });
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

      return new Response(text, {
        status: response.status,
        headers: CORS_HEADERS,
      });

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
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

export { RateLimiter };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;
    const path = url.pathname;

    if (method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS, status: 204 });
    }

    if (method === 'POST' && path === '/upload/catbox') {
      return handleCatboxUpload(request);
    }

    if (!env.RATE_LIMITER) {
      return new Response(JSON.stringify({ error: 'Rate limiter not configured' }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        status: 500,
      });
    }

    const rateLimiterId = env.RATE_LIMITER.idFromName('global');
    const rateLimiter = env.RATE_LIMITER.get(rateLimiterId);

    const headers = new Headers(request.headers);
    if (env.IMGCHEST_API_TOKEN && !headers.has('Authorization')) {
      headers.set('Authorization', 'Bearer ' + env.IMGCHEST_API_TOKEN);
    }

    const rateLimiterRequest = new Request(request.url, {
      method: request.method,
      headers: headers,
      body: request.body,
    });

    return rateLimiter.fetch(rateLimiterRequest);
  }
} satisfies ExportedHandler<Env>;
