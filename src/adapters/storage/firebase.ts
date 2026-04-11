import type { StorageAdapterPlugin } from "../../types/plugin.js"
import type {
  DetectedStorage,
  DetectionResult,
  GeneratedFile,
  ProjectAnalysis,
  ProjectFiles,
} from "../../analyzer/types.js"
import { PLUGIN_CONTRACT_VERSION } from "../../types/plugin.js"

const PROXY_ROUTE_CONTENT = `import { NextRequest, NextResponse } from "next/server"
import { getStorage } from "firebase-admin/storage"
import { initFirebaseAdmin } from "@/lib/firebase-admin"

initFirebaseAdmin()

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id } = params

  // Validate auth header before serving any file
  const authorization = request.headers.get("Authorization")
  if (!authorization?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const bucket = getStorage().bucket(process.env.FIREBASE_STORAGE_BUCKET!)
    const storagePath = \`attachments/\${id}\`
    const fileRef = bucket.file(storagePath)

    const [signedUrl] = await fileRef.getSignedUrl({
      action: "read",
      expires: Date.now() + 60 * 60 * 1000, // 1 hour
    })

    return NextResponse.redirect(signedUrl)
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 })
  }
}
`

export const FirebaseStorageAdapter: StorageAdapterPlugin = {
  meta: {
    id: "storage:firebase",
    name: "Firebase Storage",
    description:
      "Adapter for Firebase Storage — uses firebase-admin/storage with proxy route for signed URLs",
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

    if ("firebase-admin" in deps) {
      evidence.push("Found firebase-admin — Firebase Storage available via Admin SDK")
      confidence += 50
    }
    if ("firebase" in deps) {
      evidence.push("Found firebase client SDK")
      confidence += 20
    }

    const hasStorageBucket = files.envFiles.some((line) =>
      line.includes("FIREBASE_STORAGE_BUCKET"),
    )
    if (hasStorageBucket) {
      evidence.push("Found FIREBASE_STORAGE_BUCKET in env files")
      confidence += 30
    }

    return {
      data: {
        provider: "firebase",
        confidence,
        bucket: undefined,
      },
      confidence,
      evidence,
      category: "storage",
    }
  },

  async generateUploadHelper(_analysis: ProjectAnalysis): Promise<GeneratedFile[]> {
    const content = `import { getStorage } from "firebase-admin/storage"
import { initFirebaseAdmin } from "@/lib/firebase-admin"

initFirebaseAdmin()

export async function uploadAttachment(
  storagePath: string,
  fileBuffer: Buffer,
  mimeType: string,
): Promise<void> {
  const bucket = getStorage().bucket(process.env.FIREBASE_STORAGE_BUCKET!)
  const fileRef = bucket.file(storagePath)
  await fileRef.save(fileBuffer, { metadata: { contentType: mimeType } })
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

  async generateUrlResolver(_analysis: ProjectAnalysis): Promise<GeneratedFile[]> {
    return [
      {
        path: "app/api/fw/attachment/[id]/route.ts",
        content: PROXY_ROUTE_CONTENT,
        overwritePolicy: "skip-if-exists",
      },
    ]
  },

  requiredEnvVars(_analysis: ProjectAnalysis): string[] {
    return ["FIREBASE_STORAGE_BUCKET"]
  },

  getBucketName(_analysis: ProjectAnalysis): string {
    return `process.env.FIREBASE_STORAGE_BUCKET ?? ""`
  },
}

// ---------------------------------------------------------------------------
// Helper blocks (used by template renderer)
// ---------------------------------------------------------------------------

export function getFirebaseUploadBlock(): string {
  return [
    `import { getStorage } from "firebase-admin/storage"`,
    `const bucket = getStorage().bucket(process.env.FIREBASE_STORAGE_BUCKET!)`,
    `const fileRef = bucket.file(storagePath)`,
    `await fileRef.save(fileBuffer, { metadata: { contentType: mimeType } })`,
  ].join("\n")
}

export function getFirebaseDownloadUrlBlock(): string {
  return [
    `const [signedUrl] = await fileRef.getSignedUrl({`,
    `  action: "read",`,
    `  expires: Date.now() + (expiresInSeconds * 1000),`,
    `})`,
    `return signedUrl`,
  ].join("\n")
}

export function getFirebaseProxyRouteContent(): string {
  return PROXY_ROUTE_CONTENT
}

/** Firebase Storage requires a proxy route because signed URLs cannot be served without server validation */
export function requiresProxyRoute(): true {
  return true
}
