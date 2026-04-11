import type { ORMAdapterPlugin } from "../../types/plugin.js"
import type {
  DetectedORM,
  DetectionResult,
  GeneratedFile,
  ProjectAnalysis,
  ProjectFiles,
} from "../../analyzer/types.js"
import { PLUGIN_CONTRACT_VERSION } from "../../types/plugin.js"

export type PgRawClient = "pg" | "postgres" | "vercel-postgres"

const RAW_SQL_MIGRATION = `-- ---------------------------------------------------------------------------
-- feedback-wizard migration 001
-- Run this against your PostgreSQL database
-- ---------------------------------------------------------------------------

-- Enums
DO $$ BEGIN
  CREATE TYPE improvement_status AS ENUM ('open', 'in_progress', 'resolved', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE improvement_type AS ENUM ('bug', 'feature', 'improvement', 'question');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE improvement_priority AS ENUM ('low', 'medium', 'high', 'critical');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE attachment_type AS ENUM ('image', 'video', 'document', 'other');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Tables
CREATE TABLE IF NOT EXISTS fw_improvements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  type improvement_type NOT NULL,
  status improvement_status NOT NULL DEFAULT 'open',
  priority improvement_priority NOT NULL DEFAULT 'medium',
  created_by_id TEXT NOT NULL,
  assigned_to_id TEXT,
  module_slug TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fw_comments (
  id TEXT PRIMARY KEY,
  improvement_id TEXT NOT NULL REFERENCES fw_improvements(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fw_attachments (
  id TEXT PRIMARY KEY,
  improvement_id TEXT NOT NULL REFERENCES fw_improvements(id) ON DELETE CASCADE,
  uploaded_by_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  type attachment_type NOT NULL DEFAULT 'other',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fw_status_history (
  id TEXT PRIMARY KEY,
  improvement_id TEXT NOT NULL REFERENCES fw_improvements(id) ON DELETE CASCADE,
  changed_by_id TEXT NOT NULL,
  from_status improvement_status,
  to_status improvement_status NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_fw_improvements_status ON fw_improvements(status);
CREATE INDEX IF NOT EXISTS idx_fw_improvements_created_by ON fw_improvements(created_by_id);
CREATE INDEX IF NOT EXISTS idx_fw_improvements_module ON fw_improvements(module_slug);
CREATE INDEX IF NOT EXISTS idx_fw_comments_improvement ON fw_comments(improvement_id);
CREATE INDEX IF NOT EXISTS idx_fw_attachments_improvement ON fw_attachments(improvement_id);
CREATE INDEX IF NOT EXISTS idx_fw_status_history_improvement ON fw_status_history(improvement_id);
`

function buildPgRawAdapter(client: PgRawClient): ORMAdapterPlugin {
  return {
    meta: {
      id: "orm:pg-raw",
      name: `pg-raw (${client})`,
      description: `Adapter for raw PostgreSQL queries using ${client}`,
      contractVersion: PLUGIN_CONTRACT_VERSION,
      kind: "orm",
    },

    async detect(files: ProjectFiles): Promise<DetectionResult<DetectedORM>> {
      const evidence: string[] = []
      let confidence = 0

      const pkg = files.packageJson as Record<string, Record<string, string>>
      const deps = {
        ...(pkg.dependencies ?? {}),
        ...(pkg.devDependencies ?? {}),
      }

      if (client === "pg" && "pg" in deps) {
        evidence.push("Found pg in dependencies")
        confidence += 60
      }
      if (client === "postgres" && "postgres" in deps) {
        evidence.push("Found postgres in dependencies")
        confidence += 60
      }
      if (client === "vercel-postgres" && "@vercel/postgres" in deps) {
        evidence.push("Found @vercel/postgres in dependencies")
        confidence += 60
      }

      const hasDbFile = files.filePaths.some(
        (p) => p.includes("lib/db") && (p.endsWith(".ts") || p.endsWith(".js")),
      )
      if (hasDbFile) {
        evidence.push("Found lib/db file")
        confidence += 20
      }

      return {
        data: {
          provider: "pg-raw",
          confidence,
          client,
        },
        confidence,
        evidence,
        category: "orm",
      }
    },

    async generateMigration(_analysis: ProjectAnalysis): Promise<GeneratedFile[]> {
      return [
        {
          path: ".feedback-wizard/migrations/001_fw_improvements.sql",
          content: RAW_SQL_MIGRATION,
          overwritePolicy: "skip-if-exists",
        },
      ]
    },

    async generateQueryHelpers(_analysis: ProjectAnalysis): Promise<GeneratedFile[]> {
      const importsBlock = this.getImportsBlock(_analysis)
      let queryContent: string

      if (client === "pg") {
        queryContent = `${importsBlock}

export async function listImprovements() {
  const result = await pool.query<{
    id: string
    title: string
    description: string
    type: string
    status: string
    priority: string
    created_by_id: string
    created_at: Date
  }>(
    \`SELECT * FROM fw_improvements ORDER BY created_at DESC\`
  )
  return result.rows
}

export async function getImprovementById(id: string) {
  const result = await pool.query(
    \`SELECT * FROM fw_improvements WHERE id = $1\`,
    [id],
  )
  return result.rows[0] ?? null
}

export async function createImprovement(data: {
  id: string
  title: string
  description: string
  type: string
  priority: string
  createdById: string
  moduleSlug?: string
}) {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const result = await client.query(
      \`INSERT INTO fw_improvements (id, title, description, type, status, priority, created_by_id, module_slug)
       VALUES ($1, $2, $3, $4, 'open', $5, $6, $7) RETURNING *\`,
      [data.id, data.title, data.description, data.type, data.priority, data.createdById, data.moduleSlug ?? null],
    )
    const improvement = result.rows[0]
    await client.query(
      \`INSERT INTO fw_status_history (id, improvement_id, changed_by_id, from_status, to_status)
       VALUES ($1, $2, $3, NULL, 'open')\`,
      [crypto.randomUUID(), improvement.id, data.createdById],
    )
    await client.query("COMMIT")
    return improvement
  } catch (err) {
    await client.query("ROLLBACK")
    throw err
  } finally {
    client.release()
  }
}
`
      } else if (client === "postgres") {
        queryContent = `${importsBlock}

export async function listImprovements() {
  return sql\`SELECT * FROM fw_improvements ORDER BY created_at DESC\`
}

export async function getImprovementById(id: string) {
  const rows = await sql\`SELECT * FROM fw_improvements WHERE id = \${id}\`
  return rows[0] ?? null
}

export async function createImprovement(data: {
  id: string
  title: string
  description: string
  type: string
  priority: string
  createdById: string
  moduleSlug?: string
}) {
  return sql.begin(async (tx) => {
    const [improvement] = await tx\`
      INSERT INTO fw_improvements (id, title, description, type, status, priority, created_by_id, module_slug)
      VALUES (\${data.id}, \${data.title}, \${data.description}, \${data.type}, 'open', \${data.priority}, \${data.createdById}, \${data.moduleSlug ?? null})
      RETURNING *
    \`
    await tx\`
      INSERT INTO fw_status_history (id, improvement_id, changed_by_id, from_status, to_status)
      VALUES (\${crypto.randomUUID()}, \${improvement.id}, \${data.createdById}, NULL, 'open')
    \`
    return improvement
  })
}
`
      } else {
        // vercel-postgres
        queryContent = `${importsBlock}

export async function listImprovements() {
  return sql\`SELECT * FROM fw_improvements ORDER BY created_at DESC\`
}

export async function getImprovementById(id: string) {
  const { rows } = await sql\`SELECT * FROM fw_improvements WHERE id = \${id}\`
  return rows[0] ?? null
}

export async function createImprovement(data: {
  id: string
  title: string
  description: string
  type: string
  priority: string
  createdById: string
  moduleSlug?: string
}) {
  const historyId = crypto.randomUUID()
  const { rows } = await sql\`
    WITH inserted AS (
      INSERT INTO fw_improvements (id, title, description, type, status, priority, created_by_id, module_slug)
      VALUES (\${data.id}, \${data.title}, \${data.description}, \${data.type}, 'open', \${data.priority}, \${data.createdById}, \${data.moduleSlug ?? null})
      RETURNING *
    ),
    history AS (
      INSERT INTO fw_status_history (id, improvement_id, changed_by_id, from_status, to_status)
      SELECT \${historyId}, id, \${data.createdById}, NULL, 'open' FROM inserted
    )
    SELECT * FROM inserted
  \`
  return rows[0]
}
`
      }

      return [
        {
          path: "lib/fw/queries/improvements.ts",
          content: queryContent,
          overwritePolicy: "always",
        },
      ]
    },

    postInstallCommands(_analysis: ProjectAnalysis): string[] {
      return [
        `# Run the generated SQL migration against your database:`,
        `psql $DATABASE_URL < .feedback-wizard/migrations/001_fw_improvements.sql`,
      ]
    },

    getImportsBlock(_analysis: ProjectAnalysis): string {
      if (client === "pg") return `import { pool } from "@/lib/db"`
      if (client === "postgres") return `import { sql } from "@/lib/db"`
      return `import { sql } from "@vercel/postgres"`
    },

    getClientInitBlock(_analysis: ProjectAnalysis): string {
      return ""
    },

    getEnumImportBlock(_tablePrefix: string): string {
      // pg-raw uses plain string union types; no enum imports needed
      return [
        `// pg-raw: use string literals for status/type/priority`,
        `type ImprovementStatus = "open" | "in_progress" | "resolved" | "closed"`,
        `type ImprovementType = "bug" | "feature" | "improvement" | "question"`,
        `type ImprovementPriority = "low" | "medium" | "high" | "critical"`,
        `type AttachmentType = "image" | "video" | "document" | "other"`,
      ].join("\n")
    },
  }
}

export const PgAdapter: ORMAdapterPlugin = buildPgRawAdapter("pg")
export const PostgresAdapter: ORMAdapterPlugin = buildPgRawAdapter("postgres")
export const VercelPostgresAdapter: ORMAdapterPlugin = buildPgRawAdapter("vercel-postgres")

export function createPgRawAdapter(client: PgRawClient): ORMAdapterPlugin {
  return buildPgRawAdapter(client)
}

// ---------------------------------------------------------------------------
// Helper exports
// ---------------------------------------------------------------------------

export function getPgRawMigrationInstructions(client: PgRawClient): string {
  return [
    `# Run the generated SQL migration against your database:`,
    `psql $DATABASE_URL < .feedback-wizard/migrations/001_fw_improvements.sql`,
    ``,
    `# Client: ${client}`,
  ].join("\n")
}

export function getRawSqlMigration(): string {
  return RAW_SQL_MIGRATION
}
