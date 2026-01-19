import { test, expect, describe, mock, beforeEach, afterEach } from 'bun:test';
import { existsSync, unlinkSync } from 'fs';
import {
  getImgchestToken,
  loadRateLimits,
  saveRateLimits,
  resetRateLimits,
  cleanupExpiredEntries,
  checkImgchestRateLimit,
  checkSxcuRateLimit,
  updateImgchestRateLimit,
  updateSxcuRateLimit,
  handleCatboxUpload,
  handleSxcuCollections,
  handleSxcuFiles,
  handleImgchestPost,
  handleImgchestAdd,
  MAX_IMGCHEST_IMAGES_PER_REQUEST,
} from '../src/server';
import { RateLimitData } from '../src/types';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
const RATE_LIMIT_FILE = 'C:\\Users\\lenovo\\AppData\\Local\\Temp\\image_uploader_rate_limits.json';

function setMockFetch(fn: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>): void {
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fn as typeof fetch;
}

interface MockFormData {
  get: (key: string) => FormDataEntryValue | null;
  getAll: (key: string) => FormDataEntryValue[];
  entries: () => IterableIterator<[string, FormDataEntryValue]>;
}

function createMockFormData(entries: [string, string | File][]): MockFormData {
  const data = new Map<string, FormDataEntryValue>();
  const arrayData = new Map<string, FormDataEntryValue[]>();

  for (const [key, value] of entries) {
    if (key.endsWith('[]')) {
      if (!arrayData.has(key)) arrayData.set(key, []);
      arrayData.get(key)!.push(value);
    } else {
      data.set(key, value);
    }
  }

  return {
    get: (key: string) => data.get(key) ?? null,
    getAll: (key: string) => arrayData.get(key) ?? [],
    entries: () => entries[Symbol.iterator]() as IterableIterator<[string, FormDataEntryValue]>,
  };
}

interface MockRequest {
  url: string;
  method: string;
  formData: () => Promise<MockFormData>;
}

function createMockRequest(url: string, options: { method?: string; formData?: MockFormData } = {}): MockRequest {
  return {
    url,
    method: options.method || 'POST',
    formData: async () => options.formData || createMockFormData([]),
  };
}

function createMockResponse(body: string | object, options: { status?: number; headers?: Record<string, string> } = {}) {
  const headers = new Headers(options.headers || {});
  return {
    ok: options.status ? options.status >= 200 && options.status < 300 : true,
    status: options.status || 200,
    headers,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
    clone: function() { return this; },
  };
}

function createMockFile(name: string, size = 1024): { name: string; size: number; type: string } {
  return { name, size, type: 'image/png' };
}

function cleanupRateLimitFiles(): void {
  if (existsSync(RATE_LIMIT_FILE)) {
    unlinkSync(RATE_LIMIT_FILE);
  }
}

describe('Token management', () => {
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('prioritizes environment variable', () => {
    process.env.IMGCHEST_API_TOKEN = 'env-token-123';
    expect(getImgchestToken()).toBe('env-token-123');
  });

  test('returns null when no token available', () => {
    delete process.env.IMGCHEST_API_TOKEN;
    expect(getImgchestToken()).toBeNull();
  });
});

describe('Rate limiting', () => {
  afterEach(() => {
    cleanupRateLimitFiles();
  });

  test('checkImgchestRateLimit allows when no limit exists', () => {
    const result = checkImgchestRateLimit(1);
    expect(result.allowed).toBe(true);
    expect(result.waitMs).toBe(0);
  });

  test('checkSxcuRateLimit allows when no limit exists', () => {
    const result = checkSxcuRateLimit(null, 1);
    expect(result.allowed).toBe(true);
    expect(result.waitMs).toBe(0);
  });

  test('updateImgchestRateLimit updates and persists limits', () => {
    updateImgchestRateLimit({ limit: 60, remaining: 55 });
    saveRateLimits();

    loadRateLimits();
    const result = checkImgchestRateLimit(1);
    expect(result.allowed).toBe(true);
  });

  test('updateSxcuRateLimit tracks bucket-based limits', () => {
    updateSxcuRateLimit({ limit: 10, remaining: 5, bucket: 'test-bucket' });
    saveRateLimits();

    loadRateLimits();
    const result = checkSxcuRateLimit('test-bucket', 1);
    expect(result.allowed).toBe(true);
  });

  test('updateSxcuRateLimit tracks global limits on error', () => {
    updateSxcuRateLimit({ limit: 240, remaining: 0 }, true);
    saveRateLimits();

    loadRateLimits();
    const result = checkSxcuRateLimit(null, 1);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('global');
  });

  test('cleanupExpiredEntries removes old entries', () => {
    updateImgchestRateLimit({ limit: 60, remaining: 0 });
    saveRateLimits();

    loadRateLimits();
    cleanupExpiredEntries();
  });
});

describe('Catbox upload handler', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('proxies file upload to catbox API', async () => {
    let capturedUrl = '';
    let capturedBody: FormData | null = null;
    setMockFetch(mock((url, opts) => {
      capturedUrl = url as string;
      capturedBody = opts?.body as FormData;
      return Promise.resolve(createMockResponse('https://files.catbox.moe/abc.png') as unknown as Response);
    }));

    const formData = createMockFormData([
      ['reqtype', 'fileupload'],
      ['fileToUpload', createMockFile('test.png') as unknown as File],
    ]);
    const req = createMockRequest('http://localhost:3000/upload/catbox', { formData });

    const response = await handleCatboxUpload(req as unknown as Request);

    expect(response.status).toBe(200);
    expect(capturedUrl).toBe('https://catbox.moe/user/api.php');
    expect(capturedBody!.get('reqtype')).toBe('fileupload');
  });

  test('handles URL upload requests', async () => {
    setMockFetch(mock(() =>
      Promise.resolve(createMockResponse('https://files.catbox.moe/abc.png') as unknown as Response)
    ));

    const formData = createMockFormData([
      ['reqtype', 'urlupload'],
      ['url', 'https://example.com/image.png'],
    ]);
    const req = createMockRequest('http://localhost:3000/upload/catbox', { formData });

    const response = await handleCatboxUpload(req as unknown as Request);
    expect(response.status).toBe(200);
  });

  test('rejects unknown request types', async () => {
    const formData = createMockFormData([['reqtype', 'unknown']]);
    const req = createMockRequest('http://localhost:3000/upload/catbox', { formData });

    const response = await handleCatboxUpload(req as unknown as Request);
    expect(response.status).toBe(400);
  });
});

describe('SXCU upload handlers', () => {
  beforeEach(() => {
    resetRateLimits();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    cleanupRateLimitFiles();
  });

  test('creates collection and returns URL', async () => {
    setMockFetch(mock(() =>
      Promise.resolve(createMockResponse({ id: 'coll123', url: 'https://sxcu.net/c/coll123' }) as unknown as Response)
    ));

    const formData = createMockFormData([['title', 'My Collection']]);
    const req = createMockRequest('http://localhost:3000/upload/sxcu/collections', { formData });

    const response = await handleSxcuCollections(req as unknown as Request);
    const body = JSON.parse(await response.text());

    expect(response.status).toBe(200);
    expect(body.id).toBe('coll123');
  });

  test('uploads file and tracks rate limits', async () => {
    setMockFetch(mock(() =>
      Promise.resolve(createMockResponse(
        { url: 'https://sxcu.net/abc' },
        { headers: { 'X-RateLimit-Remaining': '58', 'X-RateLimit-Limit': '60', 'X-RateLimit-Bucket': 'files' } }
      ) as unknown as Response)
    ));

    const formData = createMockFormData([['file', createMockFile('test.png') as unknown as File]]);
    const req = createMockRequest('http://localhost:3000/upload/sxcu/files', { formData });

    const response = await handleSxcuFiles(req as unknown as Request);

    expect(response.status).toBe(200);
  });
});

describe('Imgchest upload handlers', () => {
  beforeEach(() => {
    resetRateLimits();
    process.env.IMGCHEST_API_TOKEN = 'test-token';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
    cleanupRateLimitFiles();
  });

  test('rejects requests without API token', async () => {
    delete process.env.IMGCHEST_API_TOKEN;

    const formData = createMockFormData([['images[]', createMockFile('test.png') as unknown as File]]);
    const req = createMockRequest('http://localhost:3000/upload/imgchest/post', { formData });

    const response = await handleImgchestPost(req as unknown as Request);

    expect(response.status).toBe(401);
  });

  test('creates post with images', async () => {
    setMockFetch(mock(() =>
      Promise.resolve(createMockResponse({
        data: { id: 'post123', link: 'https://imgchest.com/p/post123' }
      }, { headers: { 'X-RateLimit-Limit': '60', 'X-RateLimit-Remaining': '59' } }) as unknown as Response)
    ));

    const formData = createMockFormData([
      ['images[]', createMockFile('a.png') as unknown as File],
      ['images[]', createMockFile('b.png') as unknown as File],
      ['title', 'Test Post'],
    ]);
    const req = createMockRequest('http://localhost:3000/upload/imgchest/post', { formData });

    const response = await handleImgchestPost(req as unknown as Request);
    const body = JSON.parse(await response.text());

    expect(response.status).toBe(200);
    expect(body.data.id).toBe('post123');
  });

  test('chunks large uploads into batches of 20', async () => {
    let fetchCallCount = 0;
    setMockFetch(mock(() => {
      fetchCallCount++;
      return Promise.resolve(createMockResponse({
        data: { id: 'post123', link: 'https://imgchest.com/p/post123' }
      }, { headers: { 'X-RateLimit-Limit': '60', 'X-RateLimit-Remaining': String(60 - fetchCallCount) } }) as unknown as Response);
    }));

    const entries: [string, File][] = [];
    for (let i = 0; i < 45; i++) {
      entries.push(['images[]', createMockFile(`img${i}.png`) as unknown as File]);
    }
    const formData = createMockFormData(entries);
    const req = createMockRequest('http://localhost:3000/upload/imgchest/post', { formData });

    await handleImgchestPost(req as unknown as Request);

    expect(fetchCallCount).toBe(3);
  });

  test('adds images to existing post', async () => {
    let capturedUrl = '';
    setMockFetch(mock((url) => {
      capturedUrl = url as string;
      return Promise.resolve(createMockResponse({ success: true }, { headers: { 'X-RateLimit-Limit': '60', 'X-RateLimit-Remaining': '58' } }) as unknown as Response);
    }));

    const formData = createMockFormData([['images[]', createMockFile('new.png') as unknown as File]]);
    const req = createMockRequest('http://localhost:3000/upload/imgchest/post/existingPost123/add', { formData });

    const response = await handleImgchestAdd(req as unknown as Request);

    expect(response.status).toBe(200);
    expect(capturedUrl).toContain('existingPost123');
  });

  test('handles API errors gracefully', async () => {
    setMockFetch(mock(() =>
      Promise.resolve(createMockResponse({ error: 'Invalid request' }, { status: 400, headers: { 'X-RateLimit-Limit': '60', 'X-RateLimit-Remaining': '59' } }) as unknown as Response)
    ));

    const formData = createMockFormData([['images[]', createMockFile('test.png') as unknown as File]]);
    const req = createMockRequest('http://localhost:3000/upload/imgchest/post', { formData });

    const response = await handleImgchestPost(req as unknown as Request);

    expect(response.status).toBe(400);
  });
});

describe('Constants', () => {
  test('MAX_IMGCHEST_IMAGES_PER_REQUEST is 20', () => {
    expect(MAX_IMGCHEST_IMAGES_PER_REQUEST).toBe(20);
  });
});
