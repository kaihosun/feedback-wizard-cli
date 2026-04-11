import { fileURLToPath } from "url"
import { dirname, resolve } from "path"
import { promises as fsPromises } from "fs"
import type { ProjectAnalysis, GeneratedFile } from "../analyzer/types.js"
import type { AdapterStack } from "../adapters/index.js"
import type { BackupManager } from "../installer/rollback.js"
import { readFileSafe, ensureDir, fileExists } from "../utils/fs.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// In dist/generators/ after build; ../templates resolves to dist/templates/
// tsup.config.ts copies src/templates/ → dist/templates/ via onSuccess.
const TEMPLATES_DIR = resolve(__dirname, "../templates")
const PRISMA_TEMPLATE_PATH = resolve(TEMPLATES_DIR, "schema/improvements.prisma.template")

// ---------------------------------------------------------------------------
// Prisma
// ---------------------------------------------------------------------------

/**
 * Detects the User model name from an existing schema.prisma by looking for
 * the first `model` declaration that contains an `@id` field.
 * Checks for `User` then `Users` before defaulting to `User`.
 */
function detectUserModel(schemaContent: string): string {
  if (/^\s*model\s+User\s*\{/m.test(schemaContent)) return "User"
  if (/^\s*model\s+Users\s*\{/m.test(schemaContent)) return "Users"
  return "User"
}

/**
 * Detects the primary key field name of the User model.
 * Looks for the first field marked with `@id` inside the User model block.
 * Defaults to `"id"`.
 */
function detectUserIdField(schemaContent: string, userModel: string): string {
  // Find the model block
  const modelRegex = new RegExp(
    `model\\s+${userModel}\\s*\\{([^}]+)\\}`,
    "ms",
  )
  const match = schemaContent.match(modelRegex)
  if (!match) return "id"

  const body = match[1]
  // Each line like: `  id   String  @id ...`
  const fieldLine = body
    .split("\n")
    .find((line) => line.includes("@id"))
  if (!fieldLine) return "id"

  // The field name is the first non-whitespace token on that line
  const tokens = fieldLine.trim().split(/\s+/)
  return tokens[0] ?? "id"
}

/**
 * Checks whether any model name would collide with the wizard models if no
 * prefix is used. Returns `true` when a collision is detected.
 */
function hasModelCollision(schemaContent: string): boolean {
  const wizardModels = [
    "Improvement",
    "ImprovementAttachment",
    "ImprovementComment",
    "ImprovementStatusHistory",
  ]
  return wizardModels.some((name) =>
    new RegExp(`^\\s*model\\s+${name}\\s*\\{`, "m").test(schemaContent),
  )
}

async function generatePrismaSchema(
  analysis: ProjectAnalysis,
  backup: BackupManager,
): Promise<GeneratedFile[]> {
  const templateContent = await readFileSafe(PRISMA_TEMPLATE_PATH)
  if (templateContent === null) {
    throw new Error(`Prisma schema template not found at: ${PRISMA_TEMPLATE_PATH}`)
  }

  // Locate the existing schema.prisma
  const schemaRelative =
    analysis.orm.provider === "prisma" && "schemaPath" in analysis.orm
      ? analysis.orm.schemaPath
      : "prisma/schema.prisma"

  const schemaAbsolute = resolve(analysis.projectRoot, schemaRelative)
  const existingSchema = await readFileSafe(schemaAbsolute)

  // Determine prefix based on collision detection
  const collision = existingSchema !== null && hasModelCollision(existingSchema)
  const tablePrefix = collision ? "Wz" : ""
  const dbTablePrefix = collision ? "wz_" : ""

  // Detect User model and its id field
  const userModel = existingSchema !== null ? detectUserModel(existingSchema) : "User"
  const userIdField = existingSchema !== null
    ? detectUserIdField(existingSchema, userModel)
    : "id"

  // Apply replacements to the template
  let templateResult = templateContent
  templateResult = templateResult.replaceAll("{{TABLE_PREFIX}}", tablePrefix)
  templateResult = templateResult.replaceAll("{{DB_TABLE_PREFIX}}", dbTablePrefix)
  templateResult = templateResult.replaceAll("{{USER_MODEL}}", userModel)
  templateResult = templateResult.replaceAll("{{USER_ID_FIELD}}", userIdField)

  // Append to the existing schema (or create a new one)
  await ensureDir(dirname(schemaAbsolute))

  const separator = "\n\n// ---------------------------------------------------------------------------\n"
  let finalContent: string

  if (existingSchema !== null) {
    // Back up the original before modifying it so rollback can restore it.
    await backup.save(schemaRelative)
    finalContent = `${existingSchema}${separator}${templateResult}`
    await fsPromises.writeFile(schemaAbsolute, finalContent, "utf-8")
  } else {
    // File did not exist — create it and register for deletion on rollback.
    finalContent = templateResult
    await fsPromises.writeFile(schemaAbsolute, finalContent, "utf-8")
    await backup.saveNew(schemaRelative)
  }

  return [
    {
      path: schemaRelative,
      content: finalContent,
      overwritePolicy: "always",
    },
  ]
}

// ---------------------------------------------------------------------------
// Drizzle
// ---------------------------------------------------------------------------

async function generateDrizzleSchema(
  analysis: ProjectAnalysis,
  adapters: AdapterStack,
  backup: BackupManager,
): Promise<GeneratedFile[]> {
  const generatedFiles = await adapters.orm.generateMigration(analysis)

  for (const file of generatedFiles) {
    const destAbsolute = resolve(analysis.projectRoot, file.path)
    await backup.save(file.path)
    const isNew = !(await fileExists(destAbsolute))
    await ensureDir(dirname(destAbsolute))
    await fsPromises.writeFile(destAbsolute, file.content, "utf-8")
    if (isNew) {
      await backup.saveNew(file.path)
    }
  }

  return generatedFiles
}

// ---------------------------------------------------------------------------
// pg-raw
// ---------------------------------------------------------------------------

const APPLY_SH_CONTENT = `#!/usr/bin/env bash
# feedback-wizard: apply SQL migration
# Usage: bash .feedback-wizard/apply.sh

set -euo pipefail

SCRIPT_DIR="\$(cd "\$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
MIGRATION_FILE="$SCRIPT_DIR/migrations/001_fw_improvements.sql"

if [ -z "\${DATABASE_URL:-}" ]; then
  echo "Error: DATABASE_URL environment variable is not set." >&2
  exit 1
fi

echo "Applying feedback-wizard migration..."
psql "$DATABASE_URL" < "$MIGRATION_FILE"
echo "Done."
`

async function generatePgRawSchema(
  analysis: ProjectAnalysis,
  adapters: AdapterStack,
  backup: BackupManager,
): Promise<GeneratedFile[]> {
  const migrationFiles = await adapters.orm.generateMigration(analysis)

  const applyShRelative = ".feedback-wizard/apply.sh"
  const applyShAbsolute = resolve(analysis.projectRoot, applyShRelative)

  const allFiles: GeneratedFile[] = [
    ...migrationFiles,
    {
      path: applyShRelative,
      content: APPLY_SH_CONTENT,
      overwritePolicy: "skip-if-exists",
    },
  ]

  for (const file of allFiles) {
    const destAbsolute = resolve(analysis.projectRoot, file.path)
    await backup.save(file.path)
    const isNew = !(await fileExists(destAbsolute))
    await ensureDir(dirname(destAbsolute))
    await fsPromises.writeFile(destAbsolute, file.content, "utf-8")
    if (isNew) {
      await backup.saveNew(file.path)
    }
  }

  // Make apply.sh executable
  try {
    await fsPromises.chmod(applyShAbsolute, 0o755)
  } catch {
    // Non-fatal — chmod may not be available on all platforms
  }

  return allFiles
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Generates or modifies the database schema for the destination project.
 * Dispatches to the correct implementation based on the detected ORM provider.
 */
export async function generateSchema(
  analysis: ProjectAnalysis,
  adapters: AdapterStack,
  backup: BackupManager,
): Promise<GeneratedFile[]> {
  switch (analysis.orm.provider) {
    case "prisma":
      return generatePrismaSchema(analysis, backup)

    case "drizzle":
      return generateDrizzleSchema(analysis, adapters, backup)

    case "pg-raw":
      return generatePgRawSchema(analysis, adapters, backup)

    case "none":
      // Fall back to Prisma template so the user at least gets a starting point
      return generatePrismaSchema(analysis, backup)

    default: {
      const _exhaustive: never = analysis.orm
      throw new Error(
        `Unsupported ORM provider: ${(analysis.orm as { provider: string }).provider}`,
      )
    }
  }
}
