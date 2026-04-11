# @feedback-wizard/cli

Install a floating feedback & bug-reporting wizard in any Next.js project — zero human intervention.

## Quick Start

```bash
ANTHROPIC_API_KEY=sk-ant-... npx @feedback-wizard/cli init
```

## What it does

Installs a floating widget in your Next.js app that lets users report bugs and request features with screenshots, annotations, and file attachments.

Automatically detects and adapts to your project's:
- **Auth**: Supabase · NextAuth v4/v5 · Clerk · Firebase
- **Database**: Prisma · Drizzle · PostgreSQL raw
- **Storage**: Supabase Storage · AWS S3 · Firebase Storage
- **UI**: shadcn/ui · Tailwind CSS

## Commands

| Command | Description |
|---|---|
| `npx @feedback-wizard/cli init` | Install in current project |
| `npx @feedback-wizard/cli update` | Update to latest templates |
| `npx @feedback-wizard/cli uninstall` | Remove from project |

## Options

| Option | Description |
|---|---|
| `--yes` | Skip all confirmations |
| `--dry-run` | Preview changes without writing files |

## Requirements

- Node.js >= 18
- Next.js 13+ (App Router recommended)
- `ANTHROPIC_API_KEY` environment variable

## Plugin System

Extend with community adapters:

```bash
npm install @feedback-wizard/auth0-adapter
```

```typescript
// wizard.config.ts
import { defineConfig } from "@feedback-wizard/cli"
import auth0 from "@feedback-wizard/auth0-adapter"

export default defineConfig({
  plugins: [auth0()],
})
```
