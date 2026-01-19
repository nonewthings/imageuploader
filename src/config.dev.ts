// Development config - uses local server (relative paths)
// Set API_BASE_URL environment variable to override
(globalThis as unknown as { API_BASE_URL: string }).API_BASE_URL = import.meta.env.API_BASE_URL || '';
