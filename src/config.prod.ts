// Production config - uses Cloudflare Worker
(globalThis as unknown as { API_BASE_URL: string }).API_BASE_URL = 'https://image-uploader.alvinpelajar.workers.dev';
