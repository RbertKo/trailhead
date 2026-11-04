# Meta Global AI Developer Hackathon project

> **Status:** foundation only. The project topic has not been chosen yet.

A Next.js app wired to the [Meta Model API](https://dev.meta.ai/docs/overview):
Muse Spark for streaming text and tools, Muse Image for image generation, and
SAM 3.1 for segmentation.

## Getting started

Requires Node.js 22.9 or later.

```bash
npm install
cp .env.example .env.local   # then set MODEL_API_KEY
npm run smoke                # checks the key, billing and each model
npm run dev
```

Open <http://localhost:3000/playground> to try each API route.

`npm run smoke` calls the real API and costs about $0.02 per run.

## Scripts

| Command             | What it does                                    |
| ------------------- | ----------------------------------------------- |
| `npm run dev`       | Starts the development server                   |
| `npm run build`     | Creates a production build                      |
| `npm run smoke`     | Checks the real Meta Model API, end to end      |
| `npm run test`      | Runs the unit tests (no API key needed)         |
| `npm run typecheck` | Type-checks the project                         |
| `npm run lint`      | Lints the project                               |

## Project layout

```text
app/
  page.tsx            Product page (placeholder)
  playground/         Test page for the API routes
  api/chat/           Muse Spark: streaming chat with a tool loop
  api/image/          Muse Image: image generation
  api/segment/        SAM 3.1: image segmentation
components/
  playground/         Playground panels
  ui/                 shadcn/ui components
lib/
  meta/               Meta Model API configuration, clients and calls
  ai/                 Tools available to the chat model
  api/                Request parsing and error mapping for the API routes
  guard/              Rate limiter
proxy.ts              Applies the rate limit to every /api route
scripts/smoke.ts      End-to-end check against the real API
```

## Configuration

See [`.env.example`](.env.example). The API key is read on the server only.

`META_TEXT_MODEL` defaults to `muse-spark-1.3` (Standard mode). Contributor mode
is much cheaper, but Meta may train future models on the content sent, so it is
opted into per environment and is meant for development only.

## Built during the hackathon

This repository was started during the hackathon's building period (Oct 27 to
Nov 4, 2026, ET). Everything in it was written during that period, apart from
open-source dependencies and the generated shadcn/ui components.
