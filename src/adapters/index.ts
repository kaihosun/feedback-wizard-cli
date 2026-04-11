import { readFile } from "fs/promises"
import { join } from "path"
import type {
  AuthAdapterPlugin,
  FeedbackWizardPlugin,
  ORMAdapterPlugin,
  StorageAdapterPlugin,
  UIAdapterPlugin,
  PLUGIN_CONTRACT_VERSION,
} from "../types/plugin.js"
import type { ProjectAnalysis } from "../analyzer/types.js"

// ---------------------------------------------------------------------------
// Auth adapters
// ---------------------------------------------------------------------------
export { SupabaseAuthAdapter } from "./auth/supabase.js"
export { createNextAuthAdapter, NextAuthV4Adapter, NextAuthV5Adapter } from "./auth/nextauth.js"
export { ClerkAuthAdapter } from "./auth/clerk.js"
export {
  createFirebaseAdapter,
  FirebaseCustomClaimsAdapter,
  FirebaseFirestoreRolesAdapter,
  FirebaseNoRolesAdapter,
} from "./auth/firebase.js"

// ---------------------------------------------------------------------------
// Storage adapters
// ---------------------------------------------------------------------------
export { SupabaseStorageAdapter } from "./storage/supabase.js"
export { S3StorageAdapter } from "./storage/s3.js"
export { FirebaseStorageAdapter } from "./storage/firebase.js"

// ---------------------------------------------------------------------------
// ORM adapters
// ---------------------------------------------------------------------------
export { PrismaORMAdapter } from "./orm/prisma.js"
export { DrizzleORMAdapter } from "./orm/drizzle.js"
export { createPgRawAdapter, PgAdapter, PostgresAdapter, VercelPostgresAdapter } from "./orm/pg-raw.js"

// ---------------------------------------------------------------------------
// UI adapters
// ---------------------------------------------------------------------------
export { ShadcnAdapter } from "./ui/shadcn.js"
export { TailwindAdapter } from "./ui/tailwind.js"

// ---------------------------------------------------------------------------
// Re-export lazy imports for buildAdapterStack
// ---------------------------------------------------------------------------
import { SupabaseAuthAdapter } from "./auth/supabase.js"
import { createNextAuthAdapter } from "./auth/nextauth.js"
import { ClerkAuthAdapter } from "./auth/clerk.js"
import { createFirebaseAdapter } from "./auth/firebase.js"
import { SupabaseStorageAdapter } from "./storage/supabase.js"
import { S3StorageAdapter } from "./storage/s3.js"
import { FirebaseStorageAdapter } from "./storage/firebase.js"
import { PrismaORMAdapter } from "./orm/prisma.js"
import { DrizzleORMAdapter } from "./orm/drizzle.js"
import { createPgRawAdapter } from "./orm/pg-raw.js"
import { ShadcnAdapter } from "./ui/shadcn.js"
import { TailwindAdapter } from "./ui/tailwind.js"

// ---------------------------------------------------------------------------
// Adapter stack type
// ---------------------------------------------------------------------------

export type AdapterStack = {
  auth: AuthAdapterPlugin
  storage: StorageAdapterPlugin
  orm: ORMAdapterPlugin
  ui: UIAdapterPlugin
}

// ---------------------------------------------------------------------------
// buildAdapterStack — selects adapters based on ProjectAnalysis
// ---------------------------------------------------------------------------

export function buildAdapterStack(analysis: ProjectAnalysis): AdapterStack {
  // Auth
  let auth: AuthAdapterPlugin
  switch (analysis.auth.provider) {
    case "supabase":
      auth = SupabaseAuthAdapter
      break
    case "nextauth": {
      const version = "version" in analysis.auth ? analysis.auth.version : 4
      auth = createNextAuthAdapter(version)
      break
    }
    case "clerk":
      auth = ClerkAuthAdapter
      break
    case "firebase": {
      const variant =
        "variant" in analysis.auth ? analysis.auth.variant : "custom-claims"
      auth = createFirebaseAdapter(variant)
      break
    }
    case "custom":
      // Fall back to Supabase adapter shape; the snippet is provided by the user
      auth = SupabaseAuthAdapter
      break
    default: {
      const _exhaustive: never = analysis.auth
      auth = SupabaseAuthAdapter
      break
    }
  }

  // Storage
  let storage: StorageAdapterPlugin
  switch (analysis.storage.provider) {
    case "supabase":
      storage = SupabaseStorageAdapter
      break
    case "s3":
      storage = S3StorageAdapter
      break
    case "firebase":
      storage = FirebaseStorageAdapter
      break
    case "local":
      // Default to Supabase for local — installer will warn
      storage = SupabaseStorageAdapter
      break
    default: {
      const _exhaustive: never = analysis.storage
      storage = SupabaseStorageAdapter
      break
    }
  }

  // ORM
  let orm: ORMAdapterPlugin
  switch (analysis.orm.provider) {
    case "prisma":
      orm = PrismaORMAdapter
      break
    case "drizzle":
      orm = DrizzleORMAdapter
      break
    case "pg-raw": {
      const client =
        "client" in analysis.orm ? analysis.orm.client : "pg"
      orm = createPgRawAdapter(client)
      break
    }
    case "none":
      // Fall back to Prisma instructions
      orm = PrismaORMAdapter
      break
    default: {
      const _exhaustive: never = analysis.orm
      orm = PrismaORMAdapter
      break
    }
  }

  // UI
  let ui: UIAdapterPlugin
  if (analysis.ui.provider === "shadcn") {
    ui = ShadcnAdapter
  } else {
    ui = TailwindAdapter
  }

  return { auth, storage, orm, ui }
}

// ---------------------------------------------------------------------------
// discoverPlugins — finds third-party feedback-wizard plugins in node_modules
// ---------------------------------------------------------------------------

export async function discoverPlugins(
  projectRoot: string,
): Promise<FeedbackWizardPlugin[]> {
  const plugins: FeedbackWizardPlugin[] = []

  let packageJson: Record<string, unknown>
  try {
    const raw = await readFile(join(projectRoot, "package.json"), "utf-8")
    packageJson = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return plugins
  }

  const allDeps: Record<string, string> = {
    ...((packageJson.dependencies ?? {}) as Record<string, string>),
    ...((packageJson.devDependencies ?? {}) as Record<string, string>),
  }

  const pluginPackageNames = Object.keys(allDeps).filter(
    (name) =>
      name.startsWith("@feedback-wizard/") || name.startsWith("feedback-wizard-"),
  )

  // Skip the CLI itself
  const CLI_PACKAGE_NAME = "@feedback-wizard/cli"

  for (const packageName of pluginPackageNames) {
    if (packageName === CLI_PACKAGE_NAME) continue

    try {
      const pluginModulePath = join(projectRoot, "node_modules", packageName)
      const pluginPkgRaw = await readFile(
        join(pluginModulePath, "package.json"),
        "utf-8",
      )
      const pluginPkg = JSON.parse(pluginPkgRaw) as Record<string, unknown>
      const mainEntry = (pluginPkg.main ?? pluginPkg.exports ?? "index.js") as string

      // Dynamic import — we verify the shape before accepting
      const loaded = (await import(join(pluginModulePath, mainEntry))) as Record<
        string,
        unknown
      >
      const defaultExport = loaded.default ?? loaded

      if (isFeedbackWizardPlugin(defaultExport)) {
        plugins.push(defaultExport)
      }
    } catch {
      // Skip packages that fail to load — they are not valid plugins
    }
  }

  return plugins
}

// ---------------------------------------------------------------------------
// Type guard for FeedbackWizardPlugin
// ---------------------------------------------------------------------------

function isFeedbackWizardPlugin(value: unknown): value is FeedbackWizardPlugin {
  if (typeof value !== "object" || value === null) return false

  const obj = value as Record<string, unknown>

  return (
    typeof obj.meta === "object" &&
    obj.meta !== null &&
    (obj.meta as Record<string, unknown>).kind === "wizard" &&
    typeof obj.auth === "object" &&
    typeof obj.storage === "object" &&
    typeof obj.orm === "object" &&
    typeof obj.ui === "object"
  )
}

// ---------------------------------------------------------------------------
// Contract version re-export for convenience
// ---------------------------------------------------------------------------
export { PLUGIN_CONTRACT_VERSION } from "../types/plugin.js"
export type { PluginContractVersion } from "../types/plugin.js"
