import type { ORMAdapterPlugin } from "../../types/plugin.js"
import type {
  DetectedORM,
  DetectionResult,
  GeneratedFile,
  ProjectAnalysis,
  ProjectFiles,
} from "../../analyzer/types.js"
import { PLUGIN_CONTRACT_VERSION } from "../../types/plugin.js"

const DRIZZLE_SCHEMA_CONTENT = `import {
  pgTable,
  pgEnum,
  text,
  integer,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core"

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const improvementStatusEnum = pgEnum("improvement_status", [
  "open",
  "in_progress",
  "resolved",
  "closed",
])

export const improvementTypeEnum = pgEnum("improvement_type", [
  "bug",
  "feature",
  "improvement",
  "question",
])

export const improvementPriorityEnum = pgEnum("improvement_priority", [
  "low",
  "medium",
  "high",
  "critical",
])

export const attachmentTypeEnum = pgEnum("attachment_type", [
  "image",
  "video",
  "document",
  "other",
])

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export const fwImprovements = pgTable("fw_improvements", {
  id: text("id").primaryKey().notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  type: improvementTypeEnum("type").notNull(),
  status: improvementStatusEnum("status").notNull().default("open"),
  priority: improvementPriorityEnum("priority").notNull().default("medium"),
  createdById: text("created_by_id").notNull(),
  assignedToId: text("assigned_to_id"),
  moduleSlug: text("module_slug"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
})

export const fwComments = pgTable("fw_comments", {
  id: text("id").primaryKey().notNull(),
  improvementId: text("improvement_id")
    .notNull()
    .references(() => fwImprovements.id, { onDelete: "cascade" }),
  authorId: text("author_id").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
})

export const fwAttachments = pgTable("fw_attachments", {
  id: text("id").primaryKey().notNull(),
  improvementId: text("improvement_id")
    .notNull()
    .references(() => fwImprovements.id, { onDelete: "cascade" }),
  uploadedById: text("uploaded_by_id").notNull(),
  filePath: text("file_path").notNull(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  type: attachmentTypeEnum("type").notNull().default("other"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
})

export const fwStatusHistory = pgTable("fw_status_history", {
  id: text("id").primaryKey().notNull(),
  improvementId: text("improvement_id")
    .notNull()
    .references(() => fwImprovements.id, { onDelete: "cascade" }),
  changedById: text("changed_by_id").notNull(),
  fromStatus: improvementStatusEnum("from_status"),
  toStatus: improvementStatusEnum("to_status").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
})
`

const DRIZZLE_QUERY_HELPERS_CONTENT = `import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import {
  fwImprovements,
  fwComments,
  fwAttachments,
  fwStatusHistory,
  type improvementStatusEnum,
  type improvementTypeEnum,
  type improvementPriorityEnum,
} from "@/src/db/schema/fw-improvements"

type ImprovementStatus = (typeof improvementStatusEnum.enumValues)[number]
type ImprovementType = (typeof improvementTypeEnum.enumValues)[number]
type ImprovementPriority = (typeof improvementPriorityEnum.enumValues)[number]

export async function listImprovements(filters?: {
  status?: ImprovementStatus
  type?: ImprovementType
  priority?: ImprovementPriority
  moduleSlug?: string
  createdById?: string
}) {
  return db
    .select()
    .from(fwImprovements)
    .where(
      filters?.status ? eq(fwImprovements.status, filters.status) : undefined,
    )
    .orderBy(fwImprovements.createdAt)
}

export async function getImprovementById(id: string) {
  const rows = await db
    .select()
    .from(fwImprovements)
    .where(eq(fwImprovements.id, id))
    .limit(1)
  return rows[0] ?? null
}

export async function createImprovement(data: {
  id: string
  title: string
  description: string
  type: ImprovementType
  priority: ImprovementPriority
  createdById: string
  moduleSlug?: string
  metadata?: Record<string, unknown>
}) {
  return db.transaction(async (tx) => {
    const [improvement] = await tx
      .insert(fwImprovements)
      .values({ ...data, status: "open" })
      .returning()
    await tx.insert(fwStatusHistory).values({
      id: crypto.randomUUID(),
      improvementId: improvement.id,
      changedById: data.createdById,
      fromStatus: null,
      toStatus: "open",
    })
    return improvement
  })
}
`

export const DrizzleORMAdapter: ORMAdapterPlugin = {
  meta: {
    id: "orm:drizzle",
    name: "Drizzle ORM",
    description: "Adapter for Drizzle ORM — generates pg schema file in src/db/schema/",
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

    if ("drizzle-orm" in deps) {
      evidence.push("Found drizzle-orm in dependencies")
      confidence += 50
    }
    if ("drizzle-kit" in deps) {
      evidence.push("Found drizzle-kit in devDependencies")
      confidence += 20
    }

    const schemaPath = files.filePaths.find(
      (p) => p.includes("db/schema") && (p.endsWith(".ts") || p.endsWith(".js")),
    )
    if (schemaPath) {
      evidence.push(`Found Drizzle schema file at ${schemaPath}`)
      confidence += 30
    }

    return {
      data: {
        provider: "drizzle",
        confidence,
        schemaPath: schemaPath ?? "src/db/schema",
      },
      confidence,
      evidence,
      category: "orm",
    }
  },

  async generateMigration(_analysis: ProjectAnalysis): Promise<GeneratedFile[]> {
    return [
      {
        path: "src/db/schema/fw-improvements.ts",
        content: DRIZZLE_SCHEMA_CONTENT,
        overwritePolicy: "ask",
      },
    ]
  },

  async generateQueryHelpers(_analysis: ProjectAnalysis): Promise<GeneratedFile[]> {
    return [
      {
        path: "lib/fw/queries/improvements.ts",
        content: DRIZZLE_QUERY_HELPERS_CONTENT,
        overwritePolicy: "always",
      },
    ]
  },

  postInstallCommands(_analysis: ProjectAnalysis): string[] {
    return ["npx drizzle-kit migrate"]
  },

  getImportsBlock(_analysis: ProjectAnalysis): string {
    return `import { db } from "@/lib/db"`
  },

  getClientInitBlock(_analysis: ProjectAnalysis): string {
    return ""
  },

  getEnumImportBlock(_tablePrefix: string): string {
    return [
      `import {`,
      `  improvementStatusEnum,`,
      `  improvementTypeEnum,`,
      `  improvementPriorityEnum,`,
      `  attachmentTypeEnum,`,
      `} from "@/src/db/schema/fw-improvements"`,
    ].join("\n")
  },
}

// ---------------------------------------------------------------------------
// Helper exports
// ---------------------------------------------------------------------------

export function getDrizzleMigrationInstructions(): string {
  return "Run: npx drizzle-kit migrate"
}

export function getDrizzleSchemaContent(): string {
  return DRIZZLE_SCHEMA_CONTENT
}
