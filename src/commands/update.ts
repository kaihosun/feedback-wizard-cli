import { loadWizardConfig } from "../types/config.js"
import { fileExists } from "../utils/fs.js"
import { logger } from "../utils/logger.js"
import { analyzeProject } from "../analyzer/index.js"
import { buildAdapterStack } from "../adapters/index.js"
import { BackupManager } from "../installer/rollback.js"
import { runGenerators } from "../generators/index.js"

// ---------------------------------------------------------------------------
// update command — re-runs steps 3-5 (generators only, no migrations)
// ---------------------------------------------------------------------------

export async function updateCommand(): Promise<void> {
  const projectRoot = process.cwd()

  // Read saved config
  const config = await loadWizardConfig(projectRoot)

  if (config === null) {
    logger.error(
      ".wizard-config.json not found in the current directory.\n" +
        "  Run `feedback-wizard init` first to install feedback-wizard.",
    )
    process.exit(1)
  }

  logger.section("Updating feedback-wizard templates")
  logger.info(`Previous install: ${config.installedAt}`)
  logger.info(`Detected stack: ${config.analysis.auth.provider} / ${config.analysis.orm.provider} / ${config.analysis.ui.provider}`)

  // Re-analyse to pick up any project changes (new modules, layout changes, etc.)
  logger.section("Re-analysing project")

  let analysis
  try {
    analysis = await analyzeProject(projectRoot)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error(`Project re-analysis failed: ${message}`)
    process.exit(1)
  }

  const adapters = buildAdapterStack(analysis)
  const backup = new BackupManager(projectRoot)

  // Steps 3-5 only: types, actions, components, schema, layout injection
  // Does NOT re-run migrations — schema is preserved
  logger.section("Regenerating files (steps 3-5)")

  try {
    const { files, layoutModified } = await runGenerators(analysis, adapters, backup)

    await backup.commit()

    logger.success(
      `Updated ${files.length} file(s).` +
        (layoutModified ? " Layout re-injected." : " Layout unchanged."),
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error(`Update failed: ${message}\n  Rolling back changes.`)
    await backup.rollbackAll()
    process.exit(1)
  }

  process.stdout.write(
    "\n" +
      "  feedback-wizard templates updated successfully!\n" +
      "\n" +
      "  Restart your dev server to pick up the changes:\n" +
      "    npm run dev\n" +
      "\n",
  )
}
