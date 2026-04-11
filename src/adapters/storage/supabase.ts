import type { StorageAdapterPlugin } from "../../types/plugin.js"
import type {
  DetectedStorage,
  DetectionResult,
  GeneratedFile,
  ProjectAnalysis,
  ProjectFiles,
} from "../../analyzer/types.js"
import { PLUGIN_CONTRACT_VERSION } from "../../types/plugin.js"

const DEFAULT_BUCKET = "fw-improvements"

export const SupabaseStorageAdapter: StorageAdapterPlugin = {
  meta: {
    id: "storage:supabase",
    name: "Supabase Storage",
    description: "Adapter for Supabase Storage — signed URLs, no public bucket required",
    contractVersion: PLUGIN_CONTRACT_VERSION,
    kind: "storage",
  },

  async detect(files: ProjectFiles): Promise<DetectionResult<DetectedStorage>> {
    const evidence: string[] = []
    let confidence = 0

    const pkg = files.packageJson as Record<string, Record<string, string>>
    const deps = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    }

    if ("@supabase/supabase-js" in deps) {
      evidence.push("Found @supabase/supabase-js — Supabase Storage available")
      confidence += 50
    }

    const hasStorageUsage = files.filePaths.some(
      (p) => p.includes("storage") && p.includes("supabase"),
    )
    if (hasStorageUsage) {
      evidence.push("Found Supabase storage usage in project files")
      confidence += 30
    }

    const hasServiceRoleKey = files.envFiles.some((line) =>
      line.includes("SUPABASE_SERVICE_ROLE_KEY"),
    )
    if (hasServiceRoleKey) {
      evidence.push("Found SUPABASE_SERVICE_ROLE_KEY — server-side storage enabled")
      confidence += 20
    }

    return {
      data: {
        provider: "supabase",
        confidence,
        bucket: DEFAULT_BUCKET,
      },
      confidence,
      evidence,
      category: "storage",
    }
  },

  async generateUploadHelper(analysis: ProjectAnalysis): Promise<GeneratedFile[]> {
    const bucketName = this.getBucketName(analysis)
    const content = `import { createClient } from "@/lib/supabase/server"

export async function uploadAttachment(
  storagePath: string,
  fileToUpload: Uint8Array | Blob,
  mimeType: string,
): Promise<void> {
  const supabase = createClient()
  const { error: uploadError } = await supabase.storage
    .from("${bucketName}")
    .upload(storagePath, fileToUpload, { contentType: mimeType })
  if (uploadError) throw new Error(\`Upload failed: \${uploadError.message}\`)
}
`
    return [
      {
        path: "lib/fw/storage/upload.ts",
        content,
        overwritePolicy: "always",
      },
    ]
  },

  async generateUrlResolver(analysis: ProjectAnalysis): Promise<GeneratedFile[]> {
    const bucketName = this.getBucketName(analysis)
    const content = `import { createClient } from "@/lib/supabase/server"

export async function getAttachmentUrl(
  storagePath: string,
  expiresInSeconds = 3600,
): Promise<string | null> {
  const supabase = createClient()
  const { data } = await supabase.storage
    .from("${bucketName}")
    .createSignedUrl(storagePath, expiresInSeconds)
  return data?.signedUrl ?? null
}
`
    return [
      {
        path: "lib/fw/storage/url-resolver.ts",
        content,
        overwritePolicy: "always",
      },
    ]
  },

  requiredEnvVars(_analysis: ProjectAnalysis): string[] {
    return [
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
    ]
  },

  getBucketName(analysis: ProjectAnalysis): string {
    if (
      analysis.storage.provider === "supabase" &&
      "bucket" in analysis.storage &&
      analysis.storage.bucket
    ) {
      return analysis.storage.bucket
    }
    return DEFAULT_BUCKET
  },
}

// ---------------------------------------------------------------------------
// Helper blocks (used by template renderer)
// ---------------------------------------------------------------------------

export function getSupabaseUploadBlock(bucketName = DEFAULT_BUCKET): string {
  return [
    `const supabase = createClient()`,
    `const { error: uploadError } = await supabase.storage`,
    `  .from("${bucketName}")`,
    `  .upload(storagePath, fileToUpload, { contentType: mimeType })`,
    `if (uploadError) throw new Error(\`Upload failed: \${uploadError.message}\`)`,
  ].join("\n")
}

export function getSupabaseDownloadUrlBlock(bucketName = DEFAULT_BUCKET): string {
  return [
    `const supabase = createClient()`,
    `const { data } = await supabase.storage`,
    `  .from("${bucketName}")`,
    `  .createSignedUrl(storagePath, expiresInSeconds)`,
    `return data?.signedUrl ?? null`,
  ].join("\n")
}
