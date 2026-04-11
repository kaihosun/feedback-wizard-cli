// ---------------------------------------------------------------------------
// Static analyzer — deterministic detection without any AI or network calls.
//
// Reads only:
//   - snapshot.packageJson  (dependency names)
//   - snapshot.filePaths    (list of relative paths)
//   - snapshot.routePaths   (clean URL paths)
//
// Returns a Partial<ProjectAnalysis> where every detected dimension carries
// evidence and an explicit confidence score. Dimensions that cannot be
// detected statically are left undefined so the caller can decide whether
// to prompt the user or fall back to AI.
// ---------------------------------------------------------------------------

import type { ProjectSnapshot } from "./file-reader.js"
import type {
  DetectedAuth,
  DetectedORM,
  DetectedStorage,
  DetectedUI,
  DetectedModule,
  DetectedRoles,
} from "./types.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the union of dependencies and devDependencies keys from package.json.
 */
function getAllDeps(packageJson: Record<string, unknown>): string[] {
  const deps =
    typeof packageJson.dependencies === "object" && packageJson.dependencies !== null
      ? Object.keys(packageJson.dependencies as Record<string, string>)
      : []

  const devDeps =
    typeof packageJson.devDependencies === "object" && packageJson.devDependencies !== null
      ? Object.keys(packageJson.devDependencies as Record<string, string>)
      : []

  return [...new Set([...deps, ...devDeps])]
}

/**
 * Reads the semver range for a dependency from package.json.
 * Returns null if the package is not found.
 */
function getDepVersion(packageJson: Record<string, unknown>, pkg: string): string | null {
  const deps =
    typeof packageJson.dependencies === "object" && packageJson.dependencies !== null
      ? (packageJson.dependencies as Record<string, string>)
      : {}
  const devDeps =
    typeof packageJson.devDependencies === "object" && packageJson.devDependencies !== null
      ? (packageJson.devDependencies as Record<string, string>)
      : {}

  return deps[pkg] ?? devDeps[pkg] ?? null
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

type StaticAuthResult = DetectedAuth | null

function detectAuthStatic(
  deps: string[],
  filePaths: string[],
  packageJson: Record<string, unknown>
): StaticAuthResult {
  // Supabase — @supabase/ssr or legacy auth-helpers
  if (deps.includes("@supabase/ssr") || deps.includes("@supabase/auth-helpers-nextjs")) {
    return {
      provider: "supabase",
      confidence: 0.97,
      evidence: [
        deps.includes("@supabase/ssr")
          ? "@supabase/ssr in dependencies"
          : "@supabase/auth-helpers-nextjs in dependencies",
      ],
    }
  }

  // Clerk
  if (deps.includes("@clerk/nextjs")) {
    return {
      provider: "clerk",
      confidence: 0.97,
      evidence: ["@clerk/nextjs in dependencies"],
    }
  }

  // NextAuth — v4 vs v5
  if (deps.includes("next-auth") || deps.includes("@auth/core")) {
    const versionStr = getDepVersion(packageJson, "next-auth")
    const isV5 =
      (versionStr !== null && (versionStr.startsWith("^5") || versionStr.startsWith("5"))) ||
      filePaths.includes("auth.ts") ||
      filePaths.includes("src/auth.ts")

    return {
      provider: "nextauth",
      confidence: 0.95,
      evidence: [
        deps.includes("next-auth") ? "next-auth in dependencies" : "@auth/core in dependencies",
        isV5 ? `detected version 5` : `detected version 4`,
      ],
      version: isV5 ? 5 : 4,
    }
  }

  // Firebase — with admin (server-side roles possible) vs client-only
  if (deps.includes("firebase-admin") && deps.includes("firebase")) {
    return {
      provider: "firebase",
      confidence: 0.95,
      evidence: ["firebase + firebase-admin in dependencies"],
      variant: "no-roles",
    }
  }

  if (deps.includes("firebase")) {
    return {
      provider: "firebase",
      confidence: 0.55,
      evidence: ["firebase in dependencies (no firebase-admin)"],
      variant: "no-roles",
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// ORM
// ---------------------------------------------------------------------------

type StaticORMResult = DetectedORM | null

function detectORMStatic(
  deps: string[],
  filePaths: string[]
): StaticORMResult {
  if (deps.includes("@prisma/client")) {
    // Prefer non-default schema paths if detectable from file list
    const schemaPath = filePaths.find((f) => f.endsWith("schema.prisma")) ?? "prisma/schema.prisma"
    return {
      provider: "prisma",
      confidence: 0.99,
      schemaPath,
    }
  }

  if (deps.includes("drizzle-orm")) {
    const schemaPath =
      filePaths.find((f) => f.includes("db/schema") || f.includes("drizzle/schema")) ??
      "src/db/schema.ts"
    return {
      provider: "drizzle",
      confidence: 0.99,
      schemaPath,
    }
  }

  if (deps.includes("@vercel/postgres")) {
    return { provider: "pg-raw", confidence: 0.97, client: "vercel-postgres" }
  }

  if (deps.includes("postgres")) {
    return { provider: "pg-raw", confidence: 0.97, client: "postgres" }
  }

  if (deps.includes("pg")) {
    return { provider: "pg-raw", confidence: 0.97, client: "pg" }
  }

  return null
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

type StaticStorageResult = DetectedStorage | null

function detectStorageStatic(
  deps: string[],
  authProvider: string | null
): StaticStorageResult {
  // Supabase — if auth is already supabase, storage is very likely supabase too
  if (deps.includes("@supabase/ssr") || deps.includes("@supabase/auth-helpers-nextjs")) {
    return {
      provider: "supabase",
      confidence: authProvider === "supabase" ? 0.85 : 0.75,
    }
  }

  if (deps.includes("@aws-sdk/client-s3") || deps.includes("aws-sdk")) {
    return {
      provider: "s3",
      confidence: 0.97,
    }
  }

  if (deps.includes("firebase-admin") || deps.includes("firebase")) {
    return {
      provider: "firebase",
      confidence: deps.includes("firebase-admin") ? 0.80 : 0.55,
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

type StaticUIResult = DetectedUI | null

function detectUIStatic(
  deps: string[],
  filePaths: string[],
  packageJson: Record<string, unknown>
): StaticUIResult {
  // components.json is the definitive shadcn/ui signal
  if (filePaths.includes("components.json")) {
    // Try to derive componentPath from the file list
    const hasCustomUIDir = filePaths.some((f) => f.includes("/components/ui/"))
    const componentPath = hasCustomUIDir ? "src/components/ui" : "src/components/ui"
    return {
      provider: "shadcn",
      confidence: 0.99,
      componentPath,
    }
  }

  if (deps.includes("@mui/material")) {
    const versionStr = getDepVersion(packageJson, "@mui/material")
    const version =
      versionStr !== null && (versionStr.startsWith("^6") || versionStr.startsWith("6")) ? 6 : 5
    return {
      provider: "mui",
      confidence: 0.97,
      version,
    }
  }

  if (deps.includes("tailwindcss")) {
    return {
      provider: "tailwind-only",
      confidence: 0.90,
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Modules — convert route paths to module names without AI
// ---------------------------------------------------------------------------

const AUTH_ROUTE_PATTERN =
  /^\/(login|register|signup|sign-in|sign-up|forgot-password|reset-password|callback|auth|verify)(\/|$)/i

/**
 * Capitalises the first letter and lowercases the rest, then replaces hyphens
 * and underscores with spaces.
 */
function toModuleName(segment: string): string {
  return segment
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function detectModulesStatic(routePaths: string[]): DetectedModule[] {
  const appRoutes = routePaths.filter((r) => !AUTH_ROUTE_PATTERN.test(r) && r !== "/")

  // Group by first path segment
  const seen = new Set<string>()
  const modules: DetectedModule[] = []

  for (const route of appRoutes) {
    const segment = route.split("/")[1] ?? ""
    if (segment === "" || seen.has(segment)) continue
    seen.add(segment)
    modules.push({
      name: toModuleName(segment),
      route,
      segment,
    })
  }

  // Always include General as the last entry
  modules.push({ name: "General", route: "/", segment: "" })

  return modules.slice(0, 12)
}

// ---------------------------------------------------------------------------
// Roles — static defaults (low confidence — requires file content to do better)
// ---------------------------------------------------------------------------

function detectRolesStatic(
  authProvider: string | null
): { data: DetectedRoles; confidence: number; evidence: string[] } {
  // Supabase projects typically store roles in user_metadata
  if (authProvider === "supabase") {
    return {
      data: {
        roleField: "role",
        adminValue: "admin",
        viewerValue: "user",
        source: "metadata",
      },
      confidence: 0.40,
      evidence: ["Supabase detected — roles likely in user_metadata"],
    }
  }

  // Clerk projects use publicMetadata
  if (authProvider === "clerk") {
    return {
      data: {
        roleField: "role",
        adminValue: "admin",
        viewerValue: "user",
        source: "metadata",
      },
      confidence: 0.40,
      evidence: ["Clerk detected — roles likely in publicMetadata"],
    }
  }

  // Generic default — low confidence, needs AI or user confirmation
  return {
    data: {
      roleField: "role",
      adminValue: "admin",
      viewerValue: "user",
      source: "db",
    },
    confidence: 0.30,
    evidence: ["Default role schema — no provider-specific signal found"],
  }
}

// ---------------------------------------------------------------------------
// Public result type
// ---------------------------------------------------------------------------

export type StaticAnalysisResult = {
  auth: { data: DetectedAuth; confidence: number; evidence: string[] } | null
  orm: { data: DetectedORM; confidence: number; evidence: string[] } | null
  storage: { data: DetectedStorage; confidence: number; evidence: string[] } | null
  ui: { data: DetectedUI; confidence: number; evidence: string[] } | null
  modules: DetectedModule[]
  roles: { data: DetectedRoles; confidence: number; evidence: string[] }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Runs fully deterministic analysis against the project snapshot.
 * Does NOT read file contents — only inspects package.json and filePaths.
 * Does NOT make any network calls.
 */
export function runStaticAnalysis(snapshot: ProjectSnapshot): StaticAnalysisResult {
  const deps = getAllDeps(snapshot.packageJson)

  // Auth first — other detectors may use it to infer higher confidence
  const authRaw = detectAuthStatic(deps, snapshot.filePaths, snapshot.packageJson)
  const authProvider = authRaw?.provider ?? null

  const auth = authRaw !== null
    ? {
        data: authRaw,
        confidence: authRaw.confidence,
        evidence: "evidence" in authRaw ? authRaw.evidence : [],
      }
    : null

  const ormRaw = detectORMStatic(deps, snapshot.filePaths)
  const orm = ormRaw !== null
    ? {
        data: ormRaw,
        confidence: ormRaw.confidence,
        evidence: [] as string[],
      }
    : null

  const storageRaw = detectStorageStatic(deps, authProvider)
  const storage = storageRaw !== null
    ? {
        data: storageRaw,
        confidence: storageRaw.confidence,
        evidence: [] as string[],
      }
    : null

  const uiRaw = detectUIStatic(deps, snapshot.filePaths, snapshot.packageJson)
  const ui = uiRaw !== null
    ? {
        data: uiRaw,
        confidence: uiRaw.confidence,
        evidence: [] as string[],
      }
    : null

  const modules = detectModulesStatic(snapshot.routePaths)

  const roles = detectRolesStatic(authProvider)

  return { auth, orm, storage, ui, modules, roles }
}
