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
const TEMPLATE_PATH = resolve(TEMPLATES_DIR, "actions/improvements.ts.template")

/**
 * Resolves the dashboard path to use in `revalidatePath` calls.
 * Prefers "/dashboard" if a module with that route segment is detected,
 * otherwise falls back to "/".
 */
function resolveDashboardPath(analysis: ProjectAnalysis): string {
  if (analysis.routerType !== "app") return "/"

  const hasDashboard = analysis.modules.some(
    (m) =>
      m.route === "/dashboard" ||
      m.segment === "dashboard" ||
      m.route.startsWith("/dashboard"),
  )
  return hasDashboard ? "/dashboard" : "/"
}

/**
 * Returns a minimal block that obtains the current user's id without also
 * deriving a role. Used in actions that only need the identity check.
 * Mirrors the auth adapter's `generateGetUserIdSnippet` but strips the role line.
 */
function buildSimplifiedUserIdBlock(analysis: ProjectAnalysis): string {
  const full = analysis.auth.provider === "supabase"
    ? [
        `const supabase = createClient()`,
        `const { data: { user } } = await supabase.auth.getUser()`,
        `if (!user) return { success: false, error: "No autenticado" }`,
        `const userId = user.id`,
      ].join("\n")
    : analysis.auth.provider === "clerk"
    ? [
        `const { userId } = auth()`,
        `if (!userId) return { success: false, error: "No autenticado" }`,
      ].join("\n")
    : analysis.auth.provider === "nextauth"
    ? [
        `const session = await getServerSession(authOptions)`,
        `if (!session?.user?.id) return { success: false, error: "No autenticado" }`,
        `const userId = session.user.id`,
      ].join("\n")
    : // Custom / firebase / fallback — use the full snippet from the adapter
      analysis.auth.provider === "custom"
    ? analysis.auth.getUserIdSnippet
    : [
        `// TODO: obtain the current userId from your auth provider`,
        `const userId: string | undefined = undefined`,
        `if (!userId) return { success: false, error: "No autenticado" }`,
      ].join("\n")

  return full
}

/**
 * Generates `src/actions/improvements.ts` in the destination project.
 */
export async function generateActions(
  analysis: ProjectAnalysis,
  adapters: AdapterStack,
  backup: BackupManager,
): Promise<GeneratedFile> {
  const templateContent = await readFileSafe(TEMPLATE_PATH)
  if (templateContent === null) {
    throw new Error(`Actions template not found at: ${TEMPLATE_PATH}`)
  }

  const authImportsBlock = adapters.auth.generateGetUserIdSnippet(analysis)
    // generateGetUserIdSnippet returns the full snippet; we only need the import
    // lines. The adapter's module-level import helpers are the right source,
    // but since AuthAdapterPlugin doesn't expose getImportsBlock() in the
    // interface, we derive it from the snippet's first line (the import line).
    .split("\n")
    .filter((line) => line.startsWith("import "))
    .join("\n")

  // getUserBlock = everything except the import lines
  const authGetUserBlock = adapters.auth
    .generateGetUserIdSnippet(analysis)
    .split("\n")
    .filter((line) => !line.startsWith("import "))
    .join("\n")

  const authGetCurrentUserIdBlock = buildSimplifiedUserIdBlock(analysis)
    .split("\n")
    .filter((line) => !line.startsWith("import "))
    .join("\n")

  const ormImportsBlock = adapters.orm.getImportsBlock(analysis)
  const ormClientInitBlock = adapters.orm.getClientInitBlock(analysis)
  const ormClientEnumsImport = adapters.orm.getEnumImportBlock("")

  const bucketName = adapters.storage.getBucketName(analysis)
  // STORAGE_UPLOAD_BLOCK is described in the spec as the upload snippet;
  // StorageAdapterPlugin doesn't expose a `getUploadBlock` in its interface,
  // so we generate the canonical Supabase/S3 pattern inline based on the
  // upload helper content produced by `generateUploadHelper`.
  const storageUploadBlock = buildStorageUploadBlock(analysis, bucketName)

  const dashboardPath = resolveDashboardPath(analysis)
  const roleAdminValue = analysis.roles.adminValue
  // DetectedRoles only has adminValue and viewerValue — there is no editorValue.
  // ROLE_VIEWER_VALUE is used in Server Actions to deny write access to viewers.
  const roleViewerValue = analysis.roles.viewerValue

  const replacements: Record<string, string> = {
    AUTH_IMPORTS_BLOCK: authImportsBlock,
    AUTH_GET_USER_BLOCK: authGetUserBlock,
    AUTH_GET_CURRENT_USER_ID_BLOCK: authGetCurrentUserIdBlock,
    ORM_IMPORTS_BLOCK: ormImportsBlock,
    ORM_CLIENT_INIT_BLOCK: ormClientInitBlock,
    ORM_CLIENT_ENUMS_IMPORT: ormClientEnumsImport,
    STORAGE_UPLOAD_BLOCK: storageUploadBlock,
    STORAGE_BUCKET_NAME: bucketName,
    APP_DASHBOARD_PATH: dashboardPath,
    ROLE_ADMIN_VALUE: roleAdminValue,
    ROLE_VIEWER_VALUE: roleViewerValue,
  }

  let result = templateContent
  for (const [key, value] of Object.entries(replacements)) {
    result = result.replaceAll(`{{${key}}}`, value)
  }

  const baseDir = analysis.hasSrcDir ? "src/actions" : "actions"
  const destRelative = `${baseDir}/improvements.ts`
  const destAbsolute = resolve(analysis.projectRoot, destRelative)

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

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Builds an inline storage upload code block appropriate for the detected
 * storage provider. This is inlined into the template where the placeholder
 * {{STORAGE_UPLOAD_BLOCK}} appears (currently not used by the actions
 * template directly, but provided for completeness and future templates).
 */
function buildStorageUploadBlock(analysis: ProjectAnalysis, bucketName: string): string {
  switch (analysis.storage.provider) {
    case "supabase":
      return [
        `const supabase = createClient()`,
        `const { error: uploadError } = await supabase.storage`,
        `  .from("${bucketName}")`,
        `  .upload(storagePath, fileToUpload, { contentType: mimeType })`,
        `if (uploadError) throw new Error(\`Upload failed: \${uploadError.message}\`)`,
      ].join("\n")

    case "s3":
      return [
        `const s3 = new S3Client({ region: process.env.AWS_REGION! })`,
        `await s3.send(new PutObjectCommand({`,
        `  Bucket: ${bucketName},`,
        `  Key: storagePath,`,
        `  Body: fileToUpload,`,
        `  ContentType: mimeType,`,
        `}))`,
      ].join("\n")

    case "firebase":
      return [
        `const storageRef = ref(storage, storagePath)`,
        `await uploadBytes(storageRef, fileToUpload, { contentType: mimeType })`,
      ].join("\n")

    default:
      return [
        `// TODO: implement file upload for storage provider "${analysis.storage.provider}"`,
      ].join("\n")
  }
}
