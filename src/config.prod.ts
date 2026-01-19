// Production config - uses Cloudflare Worker
// Set API_BASE_URL environment variable to override
(globalThis as unknown as { API_BASE_URL: string }).API_BASE_URL = process.env.API_BASE_URL || '';
