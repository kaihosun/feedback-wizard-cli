import path from "path"
import { promises as fsPromises } from "fs"
import inquirer from "inquirer"
import { loadWizardConfig, WIZARD_CONFIG_FILENAME } from "../types/config.js"
import { fileExists, readFileSafe } from "../utils/fs.js"
import { logger } from "../utils/logger.js"

// ---------------------------------------------------------------------------
// uninstall command
// ---------------------------------------------------------------------------

export async function uninstallCommand(): Promise<void> {
  const projectRoot = process.cwd()

  // Read saved config
  const config = await loadWizardConfig(projectRoot)

  if (config === null) {
    logger.error(
      ".wizard-config.json not found in the current directory.\n" +
        "  feedback-wizard does not appear to be installed here.",
    )
    process.exit(1)
  }

  logger.section("Uninstall feedback-wizard")

  const modifiedFiles = config.modifiedFiles ?? []

  logger.info(`Installed on: ${config.installedAt}`)
  logger.info(`Files to remove: ${config.generatedFiles.length}`)
  if (modifiedFiles.length > 0) {
    logger.info(`Files modified (will NOT be deleted, manual revert required): ${modifiedFiles.join(", ")}`)
  }
  if (config.layoutModified) {
    logger.info(`Layout to revert: ${config.layoutPath}`)
  }

  // Confirmation
  const { confirmed } = await inquirer.prompt<{ confirmed: boolean }>([
    {
      type: "confirm",
      name: "confirmed",
      message: "This will remove all feedback-wizard generated files. Continue?",
      default: false,
    },
  ])

  if (!confirmed) {
    logger.info("Uninstall cancelled.")
    process.exit(0)
  }

  // Remove generated files
  let removedCount = 0
  for (const relPath of config.generatedFiles) {
    const absolute = path.resolve(projectRoot, relPath)
    if (await fileExists(absolute)) {
      await fsPromises.unlink(absolute)
      logger.info(`  Removed: ${relPath}`)
      removedCount++
    } else {
      logger.warn(`  Not found (already deleted?): ${relPath}`)
    }
  }

  logger.success(`Removed ${removedCount} generated file(s).`)

  // Inform about modified files that must be reverted manually
  if (modifiedFiles.length > 0) {
    logger.warn(
      "The following files were modified (not created) by the wizard and were NOT deleted:\n" +
        modifiedFiles.map((f) => `  - ${f}`).join("\n") + "\n" +
        "\n" +
        "  schema.prisma was modified — to revert: remove the wizard models from\n" +
        "  prisma/schema.prisma and run: npx prisma migrate dev --name remove-feedback-wizard",
    )
  }

  // Revert layout
  if (config.layoutModified) {
    await revertLayout(projectRoot, config.layoutPath)
  }

  // Prisma schema instructions
  if (config.analysis.orm.provider === "prisma") {
    logger.warn(
      "Prisma schema changes are NOT reverted automatically.\n" +
        "  To remove the feedback-wizard tables, create a new migration manually:\n" +
        "\n" +
        "    1. Delete the feedback_wizard model additions from prisma/schema.prisma\n" +
        "    2. Run: npx prisma migrate dev --name remove-feedback-wizard\n" +
        "\n" +
        "  This keeps you in control of production database changes.",
    )
  } else if (config.analysis.orm.provider === "drizzle") {
    logger.warn(
      "Drizzle schema changes are NOT reverted automatically.\n" +
        "  Remove the feedback-wizard table definitions from your schema file\n" +
        "  and run: npx drizzle-kit migrate",
    )
  } else if (config.analysis.orm.provider === "pg-raw") {
    logger.warn(
      "pg-raw: Remove the feedback-wizard tables manually via SQL:\n" +
        "  DROP TABLE IF EXISTS fw_issue_attachments;\n" +
        "  DROP TABLE IF EXISTS fw_issues;\n" +
        "  (Table names may differ based on your project config.)",
    )
  }

  // Remove config file
  const configPath = path.join(projectRoot, WIZARD_CONFIG_FILENAME)
  if (await fileExists(configPath)) {
    await fsPromises.unlink(configPath)
    logger.success(`Removed .wizard-config.json`)
  }

  process.stdout.write(
    "\n" +
      "  feedback-wizard uninstalled.\n" +
      "  Don't forget to remove any DB tables per the instructions above.\n" +
      "\n",
  )
}

// ---------------------------------------------------------------------------
// Layout revert helpers
// ---------------------------------------------------------------------------

const ALREADY_INJECTED_MARKER = "ImprovementModalProvider"

const IMPORT_PATTERNS = [
  /^import\s+\{[^}]*ImprovementModalProvider[^}]*\}[^\n]*\n/m,
  /^import\s+\{[^}]*ImprovementModal[^}]*\}[^\n]*\n/m,
  /^import\s+\{[^}]*ImprovementWidget[^}]*\}[^\n]*\n/m,
]

async function revertLayout(projectRoot: string, layoutPath: string): Promise<void> {
  const absolute = path.resolve(projectRoot, layoutPath)

  if (!(await fileExists(absolute))) {
    logger.warn(`Layout file not found at ${layoutPath} — cannot revert automatically.`)
    return
  }

  const source = await readFileSafe(absolute)
  if (source === null) {
    logger.warn(`Could not read layout at ${layoutPath} — cannot revert automatically.`)
    return
  }

  if (!source.includes(ALREADY_INJECTED_MARKER)) {
    logger.info("Layout does not contain feedback-wizard providers — no revert needed.")
    return
  }

  // Remove import lines
  let reverted = source
  for (const pattern of IMPORT_PATTERNS) {
    reverted = reverted.replace(pattern, "")
  }

  // Remove the ImprovementModalProvider wrapper while preserving inner content.
  // Strategy: unwrap <ImprovementModalProvider>...</ImprovementModalProvider>
  // keeping the children intact.
  reverted = reverted
    .replace(/<ImprovementModalProvider>\s*/g, "")
    .replace(/\s*<\/ImprovementModalProvider>/g, "")
    .replace(/\s*<ImprovementModal\s*\/>/g, "")
    .replace(/\s*<ImprovementWidget\s*\/>/g, "")

  await fsPromises.writeFile(absolute, reverted, "utf-8")
  logger.success(`Layout reverted: ${layoutPath}`)
  logger.warn(
    "The automatic revert is a best-effort string replacement.\n" +
      "  Please review the layout file and clean up any leftover whitespace.",
  )
}
