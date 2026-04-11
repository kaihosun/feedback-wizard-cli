import type { StorageAdapterPlugin } from "../../types/plugin.js"
import type {
  DetectedStorage,
  DetectionResult,
  GeneratedFile,
  ProjectAnalysis,
  ProjectFiles,
} from "../../analyzer/types.js"
import { PLUGIN_CONTRACT_VERSION } from "../../types/plugin.js"

export const S3StorageAdapter: StorageAdapterPlugin = {
  meta: {
    id: "storage:s3",
    name: "AWS S3",
    description: "Adapter for AWS S3 — uses @aws-sdk/client-s3 with presigned URLs",
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

    if ("@aws-sdk/client-s3" in deps) {
      evidence.push("Found @aws-sdk/client-s3 in dependencies")
      confidence += 60
    }
    if ("@aws-sdk/s3-request-presigner" in deps) {
      evidence.push("Found @aws-sdk/s3-request-presigner in dependencies")
      confidence += 20
    }

    const hasAwsEnv = files.envFiles.some((line) => line.includes("AWS_S3_BUCKET"))
    if (hasAwsEnv) {
      evidence.push("Found AWS_S3_BUCKET in env files")
      confidence += 20
    }

    return {
      data: {
        provider: "s3",
        confidence,
        region: undefined,
      },
      confidence,
      evidence,
      category: "storage",
    }
  },

  async generateUploadHelper(_analysis: ProjectAnalysis): Promise<GeneratedFile[]> {
    const content = `import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"

const s3 = new S3Client({ region: process.env.AWS_REGION! })

export async function uploadAttachment(
  storagePath: string,
  fileBuffer: Buffer,
  mimeType: string,
): Promise<void> {
  await s3.send(new PutObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET!,
    Key: storagePath,
    Body: fileBuffer,
    ContentType: mimeType,
  }))
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
    const content = `import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

const s3 = new S3Client({ region: process.env.AWS_REGION! })

export async function getAttachmentUrl(
  storagePath: string,
  expiresInSeconds = 3600,
): Promise<string> {
  const url = await getSignedUrl(s3, new GetObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET!,
    Key: storagePath,
  }), { expiresIn: expiresInSeconds })
  return url
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
      "AWS_REGION",
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "AWS_S3_BUCKET",
    ]
  },

  getBucketName(_analysis: ProjectAnalysis): string {
    return `process.env.AWS_S3_BUCKET ?? "fw-improvements"`
  },
}

// ---------------------------------------------------------------------------
// Helper blocks (used by template renderer)
// ---------------------------------------------------------------------------

export function getS3UploadBlock(): string {
  return [
    `import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"`,
    `const s3 = new S3Client({ region: process.env.AWS_REGION! })`,
    `await s3.send(new PutObjectCommand({`,
    `  Bucket: process.env.AWS_S3_BUCKET!,`,
    `  Key: storagePath,`,
    `  Body: fileBuffer,`,
    `  ContentType: mimeType,`,
    `}))`,
  ].join("\n")
}

export function getS3DownloadUrlBlock(): string {
  return [
    `import { getSignedUrl } from "@aws-sdk/s3-request-presigner"`,
    `const url = await getSignedUrl(s3, new GetObjectCommand({`,
    `  Bucket: process.env.AWS_S3_BUCKET!,`,
    `  Key: storagePath,`,
    `}), { expiresIn: expiresInSeconds })`,
    `return url`,
  ].join("\n")
}
