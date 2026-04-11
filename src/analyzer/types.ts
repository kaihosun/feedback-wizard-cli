// ---------------------------------------------------------------------------
// Primitive types
// ---------------------------------------------------------------------------

export type DetectionConfidence = number

// ---------------------------------------------------------------------------
// Auth detection
// ---------------------------------------------------------------------------

export type DetectedAuth =
  | { provider: "supabase"; confidence: DetectionConfidence; evidence: string[] }
  | {
      provider: "nextauth"
      confidence: DetectionConfidence
      evidence: string[]
      version: 4 | 5
    }
  | { provider: "clerk"; confidence: DetectionConfidence; evidence: string[] }
  | {
      provider: "firebase"
      confidence: DetectionConfidence
      evidence: string[]
      variant: "custom-claims" | "firestore-roles" | "no-roles"
    }
  | {
      provider: "custom"
      confidence: DetectionConfidence
      evidence: string[]
      getUserIdSnippet: string
    }

// ---------------------------------------------------------------------------
// ORM detection
// ---------------------------------------------------------------------------

export type DetectedORM =
  | { provider: "prisma"; confidence: DetectionConfidence; schemaPath: string }
  | { provider: "drizzle"; confidence: DetectionConfidence; schemaPath: string }
  | {
      provider: "pg-raw"
      confidence: DetectionConfidence
      client: "pg" | "postgres" | "vercel-postgres"
    }
  | { provider: "none"; confidence: DetectionConfidence }

// ---------------------------------------------------------------------------
// Storage detection
// ---------------------------------------------------------------------------

export type DetectedStorage =
  | { provider: "supabase"; confidence: DetectionConfidence; bucket?: string }
  | { provider: "s3"; confidence: DetectionConfidence; region?: string }
  | { provider: "firebase"; confidence: DetectionConfidence; bucket?: string }
  | { provider: "local"; confidence: DetectionConfidence; uploadDir: string }

// ---------------------------------------------------------------------------
// UI library detection
// ---------------------------------------------------------------------------

export type DetectedUI =
  | { provider: "shadcn"; confidence: DetectionConfidence; componentPath: string }
  | { provider: "mui"; confidence: DetectionConfidence; version: 5 | 6 }
  | { provider: "tailwind-only"; confidence: DetectionConfidence }

// ---------------------------------------------------------------------------
// Module / layout detection
// ---------------------------------------------------------------------------

export type DetectedModule = {
  name: string
  route: string
  segment: string
}

export type DetectedLayout = {
  filePath: string
  hasProviders: boolean
  insertionPoint: "before-closing-body" | "wrap-children" | "inside-shell" | "append-to-providers"
  existingProviders: string[]
}

// ---------------------------------------------------------------------------
// Role detection
// ---------------------------------------------------------------------------

export type DetectedRoles = {
  roleField: string
  adminValue: string
  viewerValue: string
  source: "db" | "jwt" | "metadata"
}

// ---------------------------------------------------------------------------
// Router type
// ---------------------------------------------------------------------------

export type RouterType = "app" | "pages"

// ---------------------------------------------------------------------------
// Full project analysis result
// ---------------------------------------------------------------------------

export type ProjectAnalysis = {
  projectRoot: string
  routerType: RouterType
  hasSrcDir: boolean
  auth: DetectedAuth
  orm: DetectedORM
  storage: DetectedStorage
  ui: DetectedUI
  modules: DetectedModule[]
  layout: DetectedLayout
  roles: DetectedRoles
  packageManager: "npm" | "pnpm" | "yarn" | "bun"
  existingEnvVars: string[]
  tsConfigPaths: Record<string, string[]>
  isMonorepo: boolean
  projectName: string
}

// ---------------------------------------------------------------------------
// Generic detection wrapper
// ---------------------------------------------------------------------------

export type DetectionResult<T> = {
  data: T
  confidence: DetectionConfidence
  evidence: string[]
  category: string
}

// ---------------------------------------------------------------------------
// Plugin support types
// ---------------------------------------------------------------------------

export type ProjectFiles = {
  packageJson: Record<string, unknown>
  envFiles: string[]
  filePaths: string[]
  readFile: (filePath: string) => Promise<string | null>
}

export type GeneratedFile = {
  path: string
  content: string
  overwritePolicy: "always" | "skip-if-exists" | "ask"
}
