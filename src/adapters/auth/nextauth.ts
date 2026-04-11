import type { AuthAdapterPlugin } from "../../types/plugin.js"
import type {
  DetectedAuth,
  DetectionResult,
  GeneratedFile,
  ProjectAnalysis,
  ProjectFiles,
} from "../../analyzer/types.js"
import { PLUGIN_CONTRACT_VERSION } from "../../types/plugin.js"

export type NextAuthVersion = 4 | 5

function buildNextAuthAdapter(version: NextAuthVersion): AuthAdapterPlugin {
  return {
    meta: {
      id: "auth:nextauth",
      name: `NextAuth.js v${version}`,
      description: `Adapter for NextAuth.js v${version} — server-side session retrieval`,
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

      if ("next-auth" in deps) {
        evidence.push("Found next-auth in dependencies")
        confidence += 50
        const rawVersion = deps["next-auth"] ?? ""
        const majorMatch = rawVersion.match(/\^?(\d+)/)
        const detectedVersion =
          majorMatch ? (parseInt(majorMatch[1], 10) >= 5 ? 5 : 4) : 4
        if (detectedVersion === 5) {
          evidence.push("next-auth version appears to be v5 (beta)")
        } else {
          evidence.push("next-auth version appears to be v4")
        }
        confidence += 20
      }

      const hasAuthFile = files.filePaths.some(
        (p) => p.endsWith("/auth.ts") || p.endsWith("/auth.js"),
      )
      if (hasAuthFile) {
        evidence.push("Found auth.ts/auth.js in project root (v5 pattern)")
        confidence += 20
      }

      const hasAuthOptions = files.filePaths.some(
        (p) => p.includes("lib/auth") && (p.endsWith(".ts") || p.endsWith(".js")),
      )
      if (hasAuthOptions) {
        evidence.push("Found lib/auth file (v4 pattern)")
        confidence += 10
      }

      return {
        data: {
          provider: "nextauth",
          confidence,
          evidence,
          version,
        },
        confidence,
        evidence,
        category: "auth",
      }
    },

    generateGetUserIdSnippet(_analysis: ProjectAnalysis): string {
      if (version === 5) {
        return [
          `import { auth } from "@/auth"`,
          ``,
          `const session = await auth()`,
          `if (!session?.user?.id) return { success: false, error: "No autenticado" }`,
          `const userId = session.user.id`,
          `const userRole = (session.user as { role?: string }).role ?? "viewer"`,
        ].join("\n")
      }

      return [
        `import { getServerSession } from "next-auth"`,
        `import { authOptions } from "@/lib/auth"`,
        ``,
        `const session = await getServerSession(authOptions)`,
        `if (!session?.user?.id) return { success: false, error: "No autenticado" }`,
        `const userId = session.user.id as string`,
        `const userRole = (session.user as { role?: string }).role ?? "viewer"`,
      ].join("\n")
    },

    async generateFiles(_analysis: ProjectAnalysis): Promise<GeneratedFile[]> {
      return []
    },

    requiredEnvVars(_analysis: ProjectAnalysis): string[] {
      return ["NEXTAUTH_SECRET", "NEXTAUTH_URL"]
    },
  }
}

export const NextAuthV4Adapter: AuthAdapterPlugin = buildNextAuthAdapter(4)
export const NextAuthV5Adapter: AuthAdapterPlugin = buildNextAuthAdapter(5)

export function createNextAuthAdapter(version: NextAuthVersion): AuthAdapterPlugin {
  return buildNextAuthAdapter(version)
}

// ---------------------------------------------------------------------------
// Helper blocks
// ---------------------------------------------------------------------------

export function getNextAuthImportsBlock(version: NextAuthVersion): string {
  if (version === 5) {
    return `import { auth } from "@/auth"`
  }
  return [
    `import { getServerSession } from "next-auth"`,
    `import { authOptions } from "@/lib/auth"`,
  ].join("\n")
}

export function getNextAuthGetUserIdBlock(version: NextAuthVersion): string {
  if (version === 5) {
    return [
      `const session = await auth()`,
      `if (!session?.user?.id) return { success: false, error: "No autenticado" }`,
      `const userId = session.user.id`,
      `const userRole = (session.user as { role?: string }).role ?? "viewer"`,
    ].join("\n")
  }

  return [
    `const session = await getServerSession(authOptions)`,
    `if (!session?.user?.id) return { success: false, error: "No autenticado" }`,
    `const userId = session.user.id as string`,
    `const userRole = (session.user as { role?: string }).role ?? "viewer"`,
  ].join("\n")
}
