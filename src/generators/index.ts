import type { ProjectAnalysis, GeneratedFile } from "../analyzer/types.js"
import type { AdapterStack } from "../adapters/index.js"
import type { BackupManager } from "../installer/rollback.js"
import { logger } from "../utils/logger.js"
import { generateTypes } from "./types.js"
import { generateActions } from "./actions.js"
import { generateComponents } from "./components.js"
import { generateSchema } from "./schema.js"
import { injectIntoLayout } from "./layout-injector.js"

const TOTAL_STEPS = 5

/**
 * Runs all generators in the correct order and returns the full list of
 * generated files plus a flag indicating whether the layout was modified.
 *
 * Order:
 *   1. generateTypes   — types file that actions & components import from
 *   2. generateActions + generateComponents — parallel, both depend on types
 *   3. generateSchema  — after components so it has the full picture
 *   4. injectIntoLayout — last, modifies user-owned file
 *
 * If any generator throws, the error propagates to the caller (Phase 5
 * orchestrator), which is responsible for calling `backup.rollbackAll()`.
 */
export async function runGenerators(
  analysis: ProjectAnalysis,
  adapters: AdapterStack,
  backup: BackupManager,
): Promise<{ files: GeneratedFile[]; layoutModified: boolean }> {
  const allFiles: GeneratedFile[] = []

  // ── Step 1: Types ────────────────────────────────────────────────────────
  logger.step(1, TOTAL_STEPS, "Generating types…")
  const typesFile = await generateTypes(analysis, adapters, backup)
  allFiles.push(typesFile)

  // ── Step 2: Actions + Components (parallel) ──────────────────────────────
  logger.step(2, TOTAL_STEPS, "Generating actions and components…")
  const [actionsFile, componentFiles] = await Promise.all([
    generateActions(analysis, adapters, backup),
    generateComponents(analysis, adapters, backup),
  ])
  allFiles.push(actionsFile, ...componentFiles)

  // ── Step 3: Schema ───────────────────────────────────────────────────────
  logger.step(3, TOTAL_STEPS, "Generating database schema…")
  const schemaFiles = await generateSchema(analysis, adapters, backup)
  allFiles.push(...schemaFiles)

  // ── Step 4: Layout injection ─────────────────────────────────────────────
  logger.step(4, TOTAL_STEPS, "Injecting providers into layout…")
  const { modified: layoutModified, layoutPath } = await injectIntoLayout(
    analysis,
    backup,
  )

  if (layoutModified) {
    logger.success(`Layout updated: ${layoutPath}`)
  } else {
    logger.info(`Layout injection skipped (already injected or not found).`)
  }

  // ── Step 5: Summary ──────────────────────────────────────────────────────
  logger.step(5, TOTAL_STEPS, `Done — ${allFiles.length} file(s) generated.`)

  return { files: allFiles, layoutModified }
}
