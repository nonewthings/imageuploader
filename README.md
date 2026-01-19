# Image Uploader

A TypeScript image uploader built with Bun, featuring drag-and-drop file uploads with support for multiple image hosting providers.

## Features

- **Multiple Providers**: Imgchest, Sxcu, and Catbox support
- **Drag & Drop**: Intuitive file upload interface
- **URL Upload**: Upload images directly from URLs
- **Rate Limiting**: Built-in Durable Object rate limiter for Imgchest
- **Local Persistence**: Settings and API keys saved to localStorage

## Setup

### Development

1. Install dependencies:
```bash
bun install
```

2. Create a `.env` file (copy from `.env.example`):
```bash
cp .env.example .env
```

3. For local development, you can leave `API_BASE_URL` empty to use relative paths:
```bash
# .env
API_BASE_URL=
IMGCHEST_API_TOKEN=your_token_here
```

4. Run the development server:
```bash
bun run dev
```

### Production Build

To build for production with your worker URL:

1. Set the `API_BASE_URL` environment variable:
```bash
export API_BASE_URL=https://your-worker.workers.dev
bun run build
```

Or on Windows PowerShell:
```powershell
$env:API_BASE_URL="https://your-worker.workers.dev"
bun run build
```

2. Deploy to Cloudflare Workers:
```bash
bun run deploy
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `API_BASE_URL` | Base URL of your deployed worker (e.g., `https://image-uploader.workers.dev`). Leave empty for local development with relative paths. | No (defaults to empty) |
| `IMGCHEST_API_TOKEN` | Your Imgchest API token for authenticated uploads | Yes (for Imgchest uploads) |

## Architecture

- **Frontend**: HTML/CSS + TypeScript (bundled with Bun)
- **Backend**: Cloudflare Workers with Durable Objects for rate limiting
- **Development Server**: Local Bun server for testing

## Scripts

- `bun run dev` - Start local development server
- `bun run build` - Build for production
- `bun run build:dev` - Build for development
- `bun run test` - Run tests
- `bun run typecheck` - Run TypeScript type checking
- `bun run deploy` - Build and deploy to Cloudflare Workers

## Configuration

The build process uses environment variables to inject the API base URL at build time:

- `src/config.prod.ts` - Production configuration (reads `API_BASE_URL` from env)
- `src/config.dev.ts` - Development configuration (reads `API_BASE_URL` from env)

This keeps sensitive configuration out of the public repository.
