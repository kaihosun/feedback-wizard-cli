import { execa } from "execa"
import { logger } from "../utils/logger.js"
import type { ProjectAnalysis } from "../analyzer/types.js"

// ---------------------------------------------------------------------------
// Run DB migrations according to the detected ORM
// ---------------------------------------------------------------------------

export async function runMigrations(
  projectRoot: string,
  analysis: ProjectAnalysis,
): Promise<void> {
  const orm = analysis.orm

  switch (orm.provider) {
    case "prisma":
      await runPrismaMigration(projectRoot)
      break

    case "drizzle":
      await runDrizzleMigration(projectRoot)
      break

    case "pg-raw":
      showPgRawInstructions()
      break

    case "none":
      logger.info("No ORM detected — skipping migrations.")
      break

    default: {
      // Exhaustive check
      const _exhaustive: never = orm
      logger.warn("Unknown ORM provider — skipping migrations.")
      break
    }
  }
}

// ---------------------------------------------------------------------------
// Prisma
// ---------------------------------------------------------------------------

async function runPrismaMigration(projectRoot: string): Promise<void> {
  logger.info("Running Prisma migration: add-feedback-wizard")

  try {
    await execa("npx", ["prisma", "migrate", "dev", "--name", "add-feedback-wizard"], {
      cwd: projectRoot,
      stdio: "inherit",
    })
    logger.success("Prisma migration applied successfully.")
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error(`Prisma migration failed: ${message}`)
    throw err
  }
}

// ---------------------------------------------------------------------------
// Drizzle
// ---------------------------------------------------------------------------

async function runDrizzleMigration(projectRoot: string): Promise<void> {
  logger.info("Running Drizzle migration")

  try {
    await execa("npx", ["drizzle-kit", "migrate"], {
      cwd: projectRoot,
      stdio: "inherit",
    })
    logger.success("Drizzle migration applied successfully.")
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error(`Drizzle migration failed: ${message}`)
    throw err
  }
}

// ---------------------------------------------------------------------------
// pg-raw — print instructions, do not execute automatically
// ---------------------------------------------------------------------------

function showPgRawInstructions(): void {
  logger.warn(
    "pg-raw detected — feedback-wizard cannot run SQL migrations automatically.\n" +
    "  This is intentional: automated DROP/ALTER commands against a production DB can be destructive.\n" +
    "\n" +
    "  Apply the generated migration manually:\n" +
    "    psql $DATABASE_URL -f feedback-wizard/migrations/001_feedback_wizard.sql\n" +
    "\n" +
    "  Or using your preferred Postgres client / migration tool.\n" +
    "  The SQL file was written to: feedback-wizard/migrations/001_feedback_wizard.sql",
  )
}
