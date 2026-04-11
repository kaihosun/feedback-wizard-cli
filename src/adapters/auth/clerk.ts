import type { AuthAdapterPlugin } from "../../types/plugin.js"
import type {
  DetectedAuth,
  DetectionResult,
  GeneratedFile,
  ProjectAnalysis,
  ProjectFiles,
} from "../../analyzer/types.js"
import { PLUGIN_CONTRACT_VERSION } from "../../types/plugin.js"

export const ClerkAuthAdapter: AuthAdapterPlugin = {
  meta: {
    id: "auth:clerk",
    name: "Clerk",
    description: "Adapter for Clerk — uses auth() from @clerk/nextjs/server",
    contractVersion: PLUGIN_CONTRACT_VERSION,
    kind: "auth",
  },

  async detect(files: ProjectFiles): Promise<DetectionResult<DetectedAuth>> {
    const evidence: string[] = []
    let confidence = 0

    const pkg = files.packageJson as Record<string, Record<string, string>>
    const deps = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    }

    if ("@clerk/nextjs" in deps) {
      evidence.push("Found @clerk/nextjs in dependencies")
      confidence += 60
    }
    if ("@clerk/clerk-sdk-node" in deps) {
      evidence.push("Found @clerk/clerk-sdk-node in dependencies")
      confidence += 20
    }

    const hasClerkEnv = files.envFiles.some((line) =>
      line.includes("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"),
    )
    if (hasClerkEnv) {
      evidence.push("Found NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY in env files")
      confidence += 20
    }

    const hasClerkMiddleware = files.filePaths.some(
      (p) => p.endsWith("middleware.ts") || p.endsWith("middleware.js"),
    )
    if (hasClerkMiddleware) {
      evidence.push("Found middleware file (likely Clerk middleware)")
      confidence += 10
    }

    return {
      data: {
        provider: "clerk",
        confidence,
        evidence,
      },
      confidence,
      evidence,
      category: "auth",
    }
  },

  generateGetUserIdSnippet(_analysis: ProjectAnalysis): string {
    return [
      `import { auth } from "@clerk/nextjs/server"`,
      ``,
      `const { userId, sessionClaims } = await auth()`,
      `if (!userId) return { success: false, error: "No autenticado" }`,
      `const userRole = (sessionClaims?.metadata as { role?: string })?.role ?? "viewer"`,
    ].join("\n")
  },

  async generateFiles(_analysis: ProjectAnalysis): Promise<GeneratedFile[]> {
    return []
  },

  requiredEnvVars(_analysis: ProjectAnalysis): string[] {
    return ["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY"]
  },
}

// ---------------------------------------------------------------------------
// Helper blocks
// ---------------------------------------------------------------------------

export function getClerkImportsBlock(): string {
  return `import { auth } from "@clerk/nextjs/server"`
}

export function getClerkGetUserIdBlock(): string {
  return [
    `const { userId, sessionClaims } = await auth()`,
    `if (!userId) return { success: false, error: "No autenticado" }`,
    `const userRole = (sessionClaims?.metadata as { role?: string })?.role ?? "viewer"`,
  ].join("\n")
}
