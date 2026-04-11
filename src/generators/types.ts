import { fileURLToPath } from "url"
import { dirname, join, resolve } from "path"
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
const TEMPLATE_PATH = resolve(TEMPLATES_DIR, "types/improvements.ts.template")

/**
 * Generates `src/types/improvements.ts` (or `types/improvements.ts` when no
 * src/ directory exists) in the destination project.
 */
export async function generateTypes(
  analysis: ProjectAnalysis,
  adapters: AdapterStack,
  backup: BackupManager,
): Promise<GeneratedFile> {
  const templateContent = await readFileSafe(TEMPLATE_PATH)
  if (templateContent === null) {
    throw new Error(`Types template not found at: ${TEMPLATE_PATH}`)
  }

  // Build the array literal of detected module names
  const moduleNames = analysis.modules.map((m) => m.name)
  if (moduleNames.length === 0) {
    moduleNames.push("General")
  }
  const detectedModules = `[${moduleNames.map((n) => `"${n}"`).join(", ")}]`

  // The ORM enums import block — no prefix when no collision expected at types level
  const ormTypeImportsBlock = adapters.orm.getEnumImportBlock(
    analysis.orm.provider === "prisma" ? "" : "Fw",
  )

  let result = templateContent
  result = result.replaceAll("{{DETECTED_MODULES}}", detectedModules)
  result = result.replaceAll("{{ORM_TYPE_IMPORTS_BLOCK}}", ormTypeImportsBlock)

  // Resolve destination path relative to project root
  const baseDir = analysis.hasSrcDir ? "src/types" : "types"
  const destRelative = `${baseDir}/improvements.ts`
  const destAbsolute = resolve(analysis.projectRoot, destRelative)

  // Backup existing file if present
  await backup.save(destRelative)

  const isNew = !(await fileExists(destAbsolute))

  await ensureDir(dirname(destAbsolute))
  await fsPromises.writeFile(destAbsolute, result, "utf-8")

  if (isNew) {
    await backup.saveNew(destRelative)
  }

  return {
    path: destRelative,
    content: result,
    overwritePolicy: "always",
  }
}
