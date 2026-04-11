import path from "path"
import inquirer from "inquirer"
import { execa } from "execa"
import { analyzeProject } from "../analyzer/index.js"
import { buildAdapterStack } from "../adapters/index.js"
import { BackupManager } from "../installer/rollback.js"
import { runInstaller } from "../installer/index.js"
import { fileExists } from "../utils/fs.js"
import { logger } from "../utils/logger.js"

// ---------------------------------------------------------------------------
// init command
// ---------------------------------------------------------------------------

export async function initCommand(options: {
  yes?: boolean
  dryRun?: boolean
}): Promise<void> {
  const projectRoot = process.cwd()

  // ── PASO 0: Validación de entorno ─────────────────────────────────────────
  logger.section("Environment validation")

  // Verify this is a Next.js project
  const [hasNextConfigJs, hasNextConfigTs, hasNextConfigMjs, hasPackageJson] =
    await Promise.all([
      fileExists(path.join(projectRoot, "next.config.js")),
      fileExists(path.join(projectRoot, "next.config.ts")),
      fileExists(path.join(projectRoot, "next.config.mjs")),
      fileExists(path.join(projectRoot, "package.json")),
    ])

  const hasNextConfig = hasNextConfigJs || hasNextConfigTs || hasNextConfigMjs

  if (!hasNextConfig) {
    logger.error(
      "No next.config.{js,ts,mjs} found in the current directory.\n" +
        "  feedback-wizard only supports Next.js projects.\n" +
        "  Make sure you are running this command from your project root.",
    )
    process.exit(1)
  }

  if (!hasPackageJson) {
    logger.error(
      "No package.json found in the current directory.\n" +
        "  Make sure you are running this command from your project root.",
    )
    process.exit(1)
  }

  logger.success("Next.js project detected.")

  // Verify ANTHROPIC_API_KEY
  if (!process.env.ANTHROPIC_API_KEY) {
    logger.error(
      "ANTHROPIC_API_KEY is not set.\n" +
        "  The analyzer uses Claude to detect your project's stack.\n" +
        "  Get your key at https://console.anthropic.com and set it:\n" +
        "    export ANTHROPIC_API_KEY=sk-ant-...",
    )
    process.exit(1)
  }

  logger.success("ANTHROPIC_API_KEY found.")

  // Warn if there are uncommitted git changes (non-blocking)
  try {
    const { stdout } = await execa("git", ["status", "--porcelain"], {
      cwd: projectRoot,
    })
    if (stdout.trim().length > 0) {
      logger.warn(
        "You have uncommitted changes in this repository.\n" +
          "  It is recommended to commit or stash them before running feedback-wizard init,\n" +
          "  so that rollback is clean if something goes wrong.",
      )
    }
  } catch {
    // Not a git repo or git not available — ignore
  }

  // Create BackupManager early so it is available for rollback
  const backup = new BackupManager(projectRoot)

  // ── PASO 1: Análisis AI del proyecto ──────────────────────────────────────
  logger.section("AI project analysis")

  let analysis
  try {
    analysis = await analyzeProject(projectRoot)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error(
      `Project analysis failed: ${message}\n` +
        "  This usually means the AI could not read enough of your project files.\n" +
        "  Check that your project root is correct and try again.",
    )
    process.exit(1)
  }

  // Monorepo check — if not --yes, ask which workspace to use
  if (analysis.isMonorepo && !options.yes) {
    logger.warn(
      "Monorepo detected. feedback-wizard will install in the current workspace:\n" +
        `  ${projectRoot}`,
    )
    const { confirmed } = await inquirer.prompt<{ confirmed: boolean }>([
      {
        type: "confirm",
        name: "confirmed",
        message: "Is this the correct workspace?",
        default: true,
      },
    ])

    if (!confirmed) {
      logger.info(
        "Re-run from the correct workspace directory, e.g.:\n" +
          "  cd apps/web && npx feedback-wizard init",
      )
      process.exit(0)
    }
  }

  // ── PASO 2: Confirmación ──────────────────────────────────────────────────
  if (!options.yes) {
    logger.section("Detection summary")

    const authConf = Math.round(analysis.auth.confidence * 100)
    const ormConf = Math.round(analysis.orm.confidence * 100)
    const storageConf = Math.round(analysis.storage.confidence * 100)
    const uiConf = Math.round(analysis.ui.confidence * 100)

    const authLabel = buildAuthLabel(analysis)
    const ormLabel = buildOrmLabel(analysis)
    const storageLabel = buildStorageLabel(analysis)
    const uiLabel = analysis.ui.provider

    process.stdout.write(
      [
        `  Auth:    ${authLabel} (confidence: ${authConf}%)`,
        `  ORM:     ${ormLabel} (confidence: ${ormConf}%)`,
        `  Storage: ${storageLabel} (confidence: ${storageConf}%)`,
        `  UI:      ${uiLabel} (confidence: ${uiConf}%)`,
        `  Modules: ${analysis.modules.map((m) => m.name).join(", ")}`,
        "",
      ].join("\n"),
    )

    const { proceed } = await inquirer.prompt<{ proceed: boolean }>([
      {
        type: "confirm",
        name: "proceed",
        message: "Continue with installation?",
        default: true,
      },
    ])

    if (!proceed) {
      logger.info("Installation cancelled.")
      process.exit(0)
    }
  }

  // ── PASOS 3-8: runInstaller ────────────────────────────────────────────────
  const adapters = buildAdapterStack(analysis)

  try {
    await runInstaller(projectRoot, analysis, adapters, backup, {
      dryRun: options.dryRun,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error(
      `Installation failed: ${message}\n` +
        "  All changes have been rolled back.\n" +
        "  Check the error above and try again.\n" +
        "  If the issue persists, open an issue: https://github.com/feedback-wizard/cli/issues",
    )
    process.exit(1)
  }

  // ── Success ───────────────────────────────────────────────────────────────
  if (!options.dryRun) {
    process.stdout.write(
      "\n" +
        "  feedback-wizard installed successfully!\n" +
        "\n" +
        "  Next steps:\n" +
        "    1. Run your dev server: npm run dev\n" +
        "    2. Look for the floating bug icon in the bottom-right corner\n" +
        "    3. Click it to report your first issue!\n" +
        "\n" +
        "  Config saved to .wizard-config.json\n" +
        "  Need help? https://github.com/feedback-wizard/cli\n" +
        "\n",
    )
  }
}

// ---------------------------------------------------------------------------
// Label helpers
// ---------------------------------------------------------------------------

function buildAuthLabel(analysis: { auth: { provider: string; version?: unknown; variant?: unknown } }): string {
  const auth = analysis.auth as Record<string, unknown>
  if (auth.provider === "nextauth") {
    return `NextAuth v${typeof auth.version === "number" ? auth.version : 4}`
  }
  if (auth.provider === "firebase") {
    return `Firebase (${typeof auth.variant === "string" ? auth.variant : "no-roles"})`
  }
  return String(auth.provider)
}

function buildOrmLabel(analysis: { orm: { provider: string } }): string {
  const orm = analysis.orm as Record<string, unknown>
  if (orm.provider === "pg-raw") {
    return `pg-raw (${typeof orm.client === "string" ? orm.client : "pg"})`
  }
  return String(orm.provider)
}

function buildStorageLabel(analysis: { storage: { provider: string } }): string {
  const storage = analysis.storage as Record<string, unknown>
  if (storage.provider === "supabase" && typeof storage.bucket === "string") {
    return `Supabase (bucket: ${storage.bucket})`
  }
  if (storage.provider === "s3" && typeof storage.region === "string") {
    return `S3 (region: ${storage.region})`
  }
  return String(storage.provider)
}
