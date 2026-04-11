import type { AuthAdapterPlugin } from "../../types/plugin.js"
import type {
  DetectedAuth,
  DetectionResult,
  GeneratedFile,
  ProjectAnalysis,
  ProjectFiles,
} from "../../analyzer/types.js"
import { PLUGIN_CONTRACT_VERSION } from "../../types/plugin.js"

export const SupabaseAuthAdapter: AuthAdapterPlugin = {
  meta: {
    id: "auth:supabase",
    name: "Supabase Auth",
    description: "Adapter for Supabase Auth — uses createClient() from @/lib/supabase/server",
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

    if ("@supabase/supabase-js" in deps) {
      evidence.push("Found @supabase/supabase-js in dependencies")
      confidence += 50
    }
    if ("@supabase/ssr" in deps) {
      evidence.push("Found @supabase/ssr in dependencies")
      confidence += 20
    }

    const supabaseServerFile = files.filePaths.find(
      (p) => p.includes("supabase") && p.includes("server"),
    )
    if (supabaseServerFile) {
      evidence.push(`Found Supabase server client at ${supabaseServerFile}`)
      confidence += 30
    }

    const hasSupabaseEnv = files.envFiles.some((line) =>
      line.includes("NEXT_PUBLIC_SUPABASE_URL"),
    )
    if (hasSupabaseEnv) {
      evidence.push("Found NEXT_PUBLIC_SUPABASE_URL in env files")
      confidence += 10
    }

    return {
      data: {
        provider: "supabase",
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
      `import { createClient } from "@/lib/supabase/server"`,
      ``,
      `const supabase = createClient()`,
      `const { data: { user } } = await supabase.auth.getUser()`,
      `if (!user) return { success: false, error: "No autenticado" }`,
      `const userId = user.id`,
      `const userRole = user.user_metadata?.role as string ?? "viewer"`,
    ].join("\n")
  },

  async generateFiles(_analysis: ProjectAnalysis): Promise<GeneratedFile[]> {
    return []
  },

  requiredEnvVars(_analysis: ProjectAnalysis): string[] {
    return ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]
  },
}

// ---------------------------------------------------------------------------
// Helper blocks (used by template renderer without full analysis)
// ---------------------------------------------------------------------------

export function getSupabaseAuthImportsBlock(): string {
  return `import { createClient } from "@/lib/supabase/server"`
}

export function getSupabaseAuthClientSideImportsBlock(): string {
  return `import { createClient } from "@/lib/supabase/client"`
}

export function getSupabaseGetUserIdBlock(): string {
  return [
    `const supabase = createClient()`,
    `const { data: { user } } = await supabase.auth.getUser()`,
    `if (!user) return { success: false, error: "No autenticado" }`,
    `const userId = user.id`,
    `const userRole = user.user_metadata?.role as string ?? "viewer"`,
  ].join("\n")
}

export function getSupabaseGetUserRoleBlock(): string {
  return `user.user_metadata?.role as string ?? "viewer"`
}
