import path from "path"
import { promises as fsPromises } from "fs"
import { readJsonSafe, ensureDir } from "../utils/fs.js"

export const WIZARD_CONFIG_FILENAME = ".wizard-config.json"

// ---------------------------------------------------------------------------
// WizardConfig type
// ---------------------------------------------------------------------------

export type WizardConfig = {
  version: string
  installedAt: string
  projectRoot: string
  analysis: {
    auth: { provider: string; version?: number; variant?: string }
    orm: { provider: string; client?: string }
    storage: { provider: string; bucketName: string }
    ui: { provider: string }
    modules: string[]
    tablePrefix: string
    dbTablePrefix: string
  }
  /** Files created from scratch by the wizard — deleted on uninstall. */
  generatedFiles: string[]
  /** Files that existed before and were only modified (e.g. schema.prisma) — NOT deleted on uninstall. */
  modifiedFiles: string[]
  layoutModified: boolean
  layoutPath: string
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

export async function saveWizardConfig(
  projectRoot: string,
  config: WizardConfig,
): Promise<void> {
  try {
    const configPath = path.join(projectRoot, WIZARD_CONFIG_FILENAME)
    await ensureDir(projectRoot)
    await fsPromises.writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8")
  } catch (err) {
    throw new Error(
      `Failed to save .wizard-config.json: ${err instanceof Error ? err.message : String(err)}\n` +
        `The wizard was installed successfully, but you won't be able to run 'update' or 'uninstall' without this file.`,
    )
  }
}

export async function loadWizardConfig(projectRoot: string): Promise<WizardConfig | null> {
  const configPath = path.join(projectRoot, WIZARD_CONFIG_FILENAME)
  return readJsonSafe<WizardConfig>(configPath)
}
