import { fileURLToPath } from "url"
import { dirname, join, resolve, basename } from "path"
import { promises as fsPromises } from "fs"
import { glob } from "glob"
import type { ProjectAnalysis, GeneratedFile } from "../analyzer/types.js"
import type { AdapterStack } from "../adapters/index.js"
import type { BackupManager } from "../installer/rollback.js"
import { readFileSafe, ensureDir, fileExists } from "../utils/fs.js"
import { logger } from "../utils/logger.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// In dist/generators/ after build; ../templates resolves to dist/templates/
// tsup.config.ts copies src/templates/ → dist/templates/ via onSuccess.
const COMPONENTS_TEMPLATES_DIR = resolve(__dirname, "../templates/components")

/**
 * Returns a minimal block for obtaining the current user id on the client side.
 * Used in Client Components that need to know the user's id (e.g. for
 * optimistic UI or permission checks before calling a Server Action).
 */
function buildClientSideUserIdBlock(analysis: ProjectAnalysis): string {
  switch (analysis.auth.provider) {
    case "supabase":
      return [
        `const supabase = createClient()`,
        `const { data: { user } } = await supabase.auth.getUser()`,
        `const userId = user?.id ?? null`,
      ].join("\n")

    case "clerk":
      return `const { userId } = useAuth()`

    case "nextauth":
      return [
        `const { data: session } = useSession()`,
        `const userId = session?.user?.id ?? null`,
      ].join("\n")

    default:
      return [
        `// TODO: obtain userId from your auth provider`,
        `const userId: string | null = null`,
      ].join("\n")
  }
}

/**
 * Returns the client-side auth imports block when the adapter exposes it,
 * or an empty string otherwise.
 */
function buildClientSideAuthImports(analysis: ProjectAnalysis): string {
  switch (analysis.auth.provider) {
    case "supabase":
      return `import { createClient } from "@/lib/supabase/client"`
    case "clerk":
      return `import { useAuth } from "@clerk/nextjs"`
    case "nextauth":
      return `import { useSession } from "next-auth/react"`
    default:
      return ""
  }
}

/**
 * Generates all 11 component files under
 * `src/components/features/improvements/` in the destination project.
 */
export async function generateComponents(
  analysis: ProjectAnalysis,
  adapters: AdapterStack,
  backup: BackupManager,
): Promise<GeneratedFile[]> {
  // Warn early when not using shadcn — components are written with shadcn/ui
  if (analysis.ui.provider !== "shadcn") {
    logger.warn(
      `UI provider detected as "${analysis.ui.provider}". ` +
        `Components are authored with shadcn/ui primitives. ` +
        `You may need to adapt the generated components to your UI library.`,
    )
  }

  // Find all *.tsx.template files in the components template directory
  const templatePaths = await glob("*.tsx.template", {
    cwd: COMPONENTS_TEMPLATES_DIR,
    absolute: true,
  })

  if (templatePaths.length === 0) {
    throw new Error(
      `No component templates found at: ${COMPONENTS_TEMPLATES_DIR}`,
    )
  }

  const bucketName = adapters.storage.getBucketName(analysis)
  const authClientImports = buildClientSideAuthImports(analysis)
  const userIdBlock = buildClientSideUserIdBlock(analysis)

  const commonReplacements: Record<string, string> = {
    AUTH_IMPORTS_BLOCK: authClientImports,
    STORAGE_BUCKET_NAME: bucketName,
    AUTH_GET_CURRENT_USER_ID_BLOCK: userIdBlock,
  }

  const baseDir = analysis.hasSrcDir
    ? "src/components/features/improvements"
    : "components/features/improvements"

  const generated: GeneratedFile[] = []

  for (const templatePath of templatePaths.sort()) {
    const templateContent = await readFileSafe(templatePath)
    if (templateContent === null) {
      throw new Error(`Could not read component template: ${templatePath}`)
    }

    // Derive the output filename from the template filename:
    // "ImprovementModal.tsx.template" → "ImprovementModal.tsx"
    const templateFileName = basename(templatePath)
    const outputFileName = templateFileName.replace(/\.template$/, "")

    let result = templateContent
    for (const [key, value] of Object.entries(commonReplacements)) {
      result = result.replaceAll(`{{${key}}}`, value)
    }

    const destRelative = `${baseDir}/${outputFileName}`
    const destAbsolute = resolve(analysis.projectRoot, destRelative)

    await backup.save(destRelative)

    const isNew = !(await fileExists(destAbsolute))

    await ensureDir(dirname(destAbsolute))
    await fsPromises.writeFile(destAbsolute, result, "utf-8")

    if (isNew) {
      await backup.saveNew(destRelative)
    }

    generated.push({
      path: destRelative,
      content: result,
      overwritePolicy: "always",
    })
  }

  return generated
}
