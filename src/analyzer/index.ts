import path from "path"
import Anthropic from "@anthropic-ai/sdk"
import { buildProjectSnapshot, readFilesForAnalysis, type ProjectSnapshot } from "./file-reader.js"
import * as Prompts from "./prompts.js"
import type {
  ProjectAnalysis,
  DetectedAuth,
  DetectedORM,
  DetectedStorage,
  DetectedUI,
  DetectedModule,
  DetectedRoles,
  DetectedLayout,
  RouterType,
} from "./types.js"
import { resolveWithFallback } from "../utils/confidence.js"
import { logger } from "../utils/logger.js"
import { fileExists } from "../utils/fs.js"
import { detectRunEnvironment } from "../utils/detect-environment.js"
import { runStaticAnalysis } from "./static-analyzer.js"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODEL = "claude-sonnet-4-5"

// ---------------------------------------------------------------------------
// Claude API helper
// ---------------------------------------------------------------------------

export function extractJson(text: string): string | null {
  // Intenta cada match potencial, retorna el primero que sea JSON válido
  const matches = text.matchAll(/(\{[\s\S]*?\}|\[[\s\S]*?\])/g)
  for (const match of matches) {
    try {
      JSON.parse(match[1])
      return match[1]
    } catch {
      // try next match
    }
  }
  // Fallback: regex original greedy como último recurso
  const greedy = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
  return greedy?.[0] ?? null
}

async function callClaude(client: Anthropic, prompt: string): Promise<string> {
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  })

  const content = message.content[0]
  if (content.type !== "text") throw new Error("Unexpected response type from Claude")

  // Extract only the JSON block — the model may emit surrounding prose
  const jsonMatch = extractJson(content.text)
  if (!jsonMatch) throw new Error("No JSON found in Claude response")

  return jsonMatch
}

// ---------------------------------------------------------------------------
// Safe JSON parse — returns null instead of throwing
// ---------------------------------------------------------------------------

function safeParse<T>(json: string): T | null {
  try {
    return JSON.parse(json) as T
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Per-dimension result parsers with typed defaults
// ---------------------------------------------------------------------------

function parseAuth(json: string | null): { data: DetectedAuth; confidence: number; evidence: string[] } {
  if (json === null) {
    return {
      data: { provider: "custom", confidence: 0, evidence: [], getUserIdSnippet: "" },
      confidence: 0,
      evidence: [],
    }
  }

  type Raw = {
    provider?: string
    confidence?: number
    evidence?: string[]
    version?: number | null
    variant?: string | null
    getUserIdSnippet?: string | null
  }

  const raw = safeParse<Raw>(json)
  if (!raw) {
    return {
      data: { provider: "custom", confidence: 0, evidence: [], getUserIdSnippet: "" },
      confidence: 0,
      evidence: ["parse error"],
    }
  }

  const confidence = typeof raw.confidence === "number" ? raw.confidence : 0
  const evidence = Array.isArray(raw.evidence) ? raw.evidence.map(String) : []

  switch (raw.provider) {
    case "supabase":
      return { data: { provider: "supabase", confidence, evidence }, confidence, evidence }
    case "clerk":
      return { data: { provider: "clerk", confidence, evidence }, confidence, evidence }
    case "nextauth": {
      const version = raw.version === 5 ? 5 : 4
      return { data: { provider: "nextauth", confidence, evidence, version }, confidence, evidence }
    }
    case "firebase": {
      const variant =
        raw.variant === "custom-claims" || raw.variant === "firestore-roles"
          ? raw.variant
          : "no-roles"
      return {
        data: { provider: "firebase", confidence, evidence, variant },
        confidence,
        evidence,
      }
    }
    default:
      return {
        data: {
          provider: "custom",
          confidence,
          evidence,
          getUserIdSnippet: typeof raw.getUserIdSnippet === "string" ? raw.getUserIdSnippet : "",
        },
        confidence,
        evidence,
      }
  }
}

function parseORM(json: string | null): { data: DetectedORM; confidence: number; evidence: string[] } {
  if (json === null) {
    return { data: { provider: "none", confidence: 0 }, confidence: 0, evidence: [] }
  }

  type Raw = {
    provider?: string
    confidence?: number
    evidence?: string[]
    schemaPath?: string | null
    pgClient?: string | null
  }

  const raw = safeParse<Raw>(json)
  if (!raw) {
    return { data: { provider: "none", confidence: 0 }, confidence: 0, evidence: ["parse error"] }
  }

  const confidence = typeof raw.confidence === "number" ? raw.confidence : 0
  const evidence = Array.isArray(raw.evidence) ? raw.evidence.map(String) : []
  const schemaPath = typeof raw.schemaPath === "string" ? raw.schemaPath : null

  switch (raw.provider) {
    case "prisma":
      return {
        data: { provider: "prisma", confidence, schemaPath: schemaPath ?? "prisma/schema.prisma" },
        confidence,
        evidence,
      }
    case "drizzle":
      return {
        data: { provider: "drizzle", confidence, schemaPath: schemaPath ?? "src/db/schema.ts" },
        confidence,
        evidence,
      }
    case "pg-raw": {
      const validClients = ["pg", "postgres", "vercel-postgres"] as const
      type PgClient = (typeof validClients)[number]
      const client: PgClient = validClients.includes(raw.pgClient as PgClient)
        ? (raw.pgClient as PgClient)
        : "pg"
      return { data: { provider: "pg-raw", confidence, client }, confidence, evidence }
    }
    default:
      return { data: { provider: "none", confidence }, confidence, evidence }
  }
}

function parseStorage(json: string | null): {
  data: DetectedStorage
  confidence: number
  evidence: string[]
} {
  if (json === null) {
    return {
      data: { provider: "local", confidence: 0, uploadDir: "public/uploads" },
      confidence: 0,
      evidence: [],
    }
  }

  type Raw = {
    provider?: string
    confidence?: number
    evidence?: string[]
    bucketName?: string | null
    region?: string | null
  }

  const raw = safeParse<Raw>(json)
  if (!raw) {
    return {
      data: { provider: "local", confidence: 0, uploadDir: "public/uploads" },
      confidence: 0,
      evidence: ["parse error"],
    }
  }

  const confidence = typeof raw.confidence === "number" ? raw.confidence : 0
  const evidence = Array.isArray(raw.evidence) ? raw.evidence.map(String) : []
  const bucket = typeof raw.bucketName === "string" ? raw.bucketName : undefined
  const region = typeof raw.region === "string" ? raw.region : undefined

  switch (raw.provider) {
    case "supabase":
      return {
        data: { provider: "supabase", confidence, bucket },
        confidence,
        evidence,
      }
    case "s3":
      return { data: { provider: "s3", confidence, region }, confidence, evidence }
    case "firebase":
      return { data: { provider: "firebase", confidence, bucket }, confidence, evidence }
    default:
      return {
        data: { provider: "local", confidence, uploadDir: "public/uploads" },
        confidence,
        evidence,
      }
  }
}

function parseUI(json: string | null): { data: DetectedUI; confidence: number; evidence: string[] } {
  if (json === null) {
    return { data: { provider: "tailwind-only", confidence: 0 }, confidence: 0, evidence: [] }
  }

  type Raw = {
    provider?: string
    confidence?: number
    evidence?: string[]
    componentPath?: string | null
    muiVersion?: number | null
  }

  const raw = safeParse<Raw>(json)
  if (!raw) {
    return {
      data: { provider: "tailwind-only", confidence: 0 },
      confidence: 0,
      evidence: ["parse error"],
    }
  }

  const confidence = typeof raw.confidence === "number" ? raw.confidence : 0
  const evidence = Array.isArray(raw.evidence) ? raw.evidence.map(String) : []
  const componentPath = typeof raw.componentPath === "string" ? raw.componentPath : null

  switch (raw.provider) {
    case "shadcn":
      return {
        data: {
          provider: "shadcn",
          confidence,
          componentPath: componentPath ?? "src/components/ui",
        },
        confidence,
        evidence,
      }
    case "mui": {
      const version = raw.muiVersion === 6 ? 6 : 5
      return { data: { provider: "mui", confidence, version }, confidence, evidence }
    }
    default:
      return { data: { provider: "tailwind-only", confidence }, confidence, evidence }
  }
}

export function parseModules(json: string | null, routes: string[]): DetectedModule[] {
  const fallback: DetectedModule[] = [{ name: "General", route: "/", segment: "" }]

  if (json === null) return fallback

  const raw = safeParse<string[]>(json)
  if (!Array.isArray(raw) || raw.length === 0) return fallback

  return raw.filter((item): item is string => typeof item === "string").map((name) => {
    // Try to find a matching route for this module name
    const lowerName = name.toLowerCase()
    const matchedRoute =
      routes.find((r) => r.toLowerCase().includes(lowerName.split(" ")[0])) ?? "/"
    const segment = matchedRoute.split("/")[1] ?? ""
    return { name, route: matchedRoute, segment }
  })
}

function parseRoles(json: string | null): {
  data: DetectedRoles
  confidence: number
  evidence: string[]
} {
  const defaultRoles: DetectedRoles = {
    roleField: "role",
    adminValue: "admin",
    viewerValue: "user",
    source: "db",
  }

  if (json === null) return { data: defaultRoles, confidence: 0.3, evidence: [] }

  type Raw = {
    confidence?: number
    evidence?: string[]
    roleField?: string
    adminValue?: string
    viewerValue?: string
    source?: string
  }

  const raw = safeParse<Raw>(json)
  if (!raw) return { data: defaultRoles, confidence: 0.3, evidence: ["parse error"] }

  const confidence = typeof raw.confidence === "number" ? raw.confidence : 0.3
  const evidence = Array.isArray(raw.evidence) ? raw.evidence.map(String) : []
  const validSources = ["db", "jwt", "metadata"] as const
  type Source = (typeof validSources)[number]

  return {
    data: {
      roleField: typeof raw.roleField === "string" ? raw.roleField : "role",
      adminValue: typeof raw.adminValue === "string" ? raw.adminValue : "admin",
      viewerValue: typeof raw.viewerValue === "string" ? raw.viewerValue : "user",
      source: validSources.includes(raw.source as Source) ? (raw.source as Source) : "db",
    },
    confidence,
    evidence,
  }
}

// ---------------------------------------------------------------------------
// Layout detection — no AI needed, file-system heuristics
// ---------------------------------------------------------------------------

async function detectLayout(
  snapshot: { readFile: (p: string) => Promise<string | null>; filePaths: string[] },
  hasSrcDir: boolean,
  routerType: RouterType
): Promise<DetectedLayout> {
  const candidates =
    routerType === "app"
      ? [
          hasSrcDir
            ? "src/app/(dashboard)/layout.tsx"
            : "app/(dashboard)/layout.tsx",
          hasSrcDir ? "src/app/layout.tsx" : "app/layout.tsx",
          // Any other layout in the file list
          ...snapshot.filePaths.filter(
            (f) => f.endsWith("layout.tsx") || f.endsWith("layout.ts")
          ),
        ]
      : [
          hasSrcDir ? "src/pages/_app.tsx" : "pages/_app.tsx",
          hasSrcDir ? "src/pages/_app.ts" : "pages/_app.ts",
        ]

  // Deduplicate while preserving order
  const seen = new Set<string>()
  const orderedCandidates = candidates.filter((c) => {
    if (seen.has(c)) return false
    seen.add(c)
    return true
  })

  for (const candidate of orderedCandidates) {
    const content = await snapshot.readFile(candidate)
    if (content === null) continue

    const hasProviders =
      /Provider|providers|ProviderTree/i.test(content)

    const existingProviders: string[] = []
    const providerMatches = content.matchAll(/<(\w+Provider)\s/g)
    for (const match of providerMatches) {
      existingProviders.push(match[1])
    }

    let insertionPoint: DetectedLayout["insertionPoint"] = "wrap-children"

    if (existingProviders.length > 0) {
      insertionPoint = "append-to-providers"
    } else if (/<\/body>/i.test(content)) {
      insertionPoint = "before-closing-body"
    } else if (/<Shell|<Layout|<AppShell/i.test(content)) {
      insertionPoint = "inside-shell"
    }

    return {
      filePath: candidate,
      hasProviders,
      insertionPoint,
      existingProviders,
    }
  }

  // No layout file found — provide a sensible default
  const defaultPath =
    routerType === "app"
      ? hasSrcDir
        ? "src/app/layout.tsx"
        : "app/layout.tsx"
      : hasSrcDir
        ? "src/pages/_app.tsx"
        : "pages/_app.tsx"

  return {
    filePath: defaultPath,
    hasProviders: false,
    insertionPoint: "wrap-children",
    existingProviders: [],
  }
}

// ---------------------------------------------------------------------------
// Shared: resolve choices used by both analyzeWithClaude and analyzeWithStaticFallback
// ---------------------------------------------------------------------------

async function resolveAllDimensions(
  authParsed: { data: DetectedAuth; confidence: number; evidence: string[] },
  ormParsed: { data: DetectedORM; confidence: number; evidence: string[] },
  storageParsed: { data: DetectedStorage; confidence: number; evidence: string[] },
  uiParsed: { data: DetectedUI; confidence: number; evidence: string[] },
  rolesParsed: { data: DetectedRoles; confidence: number; evidence: string[] },
  modules: DetectedModule[]
): Promise<{
  auth: DetectedAuth
  orm: DetectedORM
  storage: DetectedStorage
  ui: DetectedUI
  modules: DetectedModule[]
  roles: DetectedRoles
}> {
  const auth = await resolveWithFallback<DetectedAuth>(
    { data: authParsed.data, confidence: authParsed.confidence, evidence: authParsed.evidence, category: "Auth" },
    "Auth provider",
    {
      message: "Which authentication provider does this project use?",
      choices: [
        { name: "Supabase", value: { provider: "supabase", confidence: 1, evidence: [] } },
        { name: "NextAuth v4", value: { provider: "nextauth", confidence: 1, evidence: [], version: 4 } },
        { name: "NextAuth v5", value: { provider: "nextauth", confidence: 1, evidence: [], version: 5 } },
        { name: "Clerk", value: { provider: "clerk", confidence: 1, evidence: [] } },
        {
          name: "Firebase",
          value: { provider: "firebase", confidence: 1, evidence: [], variant: "no-roles" },
        },
        {
          name: "Custom",
          value: { provider: "custom", confidence: 1, evidence: [], getUserIdSnippet: "" },
        },
      ] as Array<{ name: string; value: DetectedAuth }>,
    }
  )

  const orm = await resolveWithFallback<DetectedORM>(
    { data: ormParsed.data, confidence: ormParsed.confidence, evidence: ormParsed.evidence, category: "ORM" },
    "ORM / DB client",
    {
      message: "Which ORM or database client does this project use?",
      choices: [
        {
          name: "Prisma",
          value: { provider: "prisma", confidence: 1, schemaPath: "prisma/schema.prisma" },
        },
        {
          name: "Drizzle",
          value: { provider: "drizzle", confidence: 1, schemaPath: "src/db/schema.ts" },
        },
        { name: "Raw pg", value: { provider: "pg-raw", confidence: 1, client: "pg" } },
        { name: "None", value: { provider: "none", confidence: 1 } },
      ] as Array<{ name: string; value: DetectedORM }>,
    }
  )

  const storage = await resolveWithFallback<DetectedStorage>(
    {
      data: storageParsed.data,
      confidence: storageParsed.confidence,
      evidence: storageParsed.evidence,
      category: "Storage",
    },
    "Storage provider",
    {
      message: "Which file storage provider does this project use?",
      choices: [
        { name: "Supabase Storage", value: { provider: "supabase", confidence: 1 } },
        { name: "AWS S3", value: { provider: "s3", confidence: 1 } },
        { name: "Firebase Storage", value: { provider: "firebase", confidence: 1 } },
        {
          name: "Local filesystem",
          value: { provider: "local", confidence: 1, uploadDir: "public/uploads" },
        },
      ] as Array<{ name: string; value: DetectedStorage }>,
    }
  )

  const ui = await resolveWithFallback<DetectedUI>(
    { data: uiParsed.data, confidence: uiParsed.confidence, evidence: uiParsed.evidence, category: "UI" },
    "UI library",
    {
      message: "Which UI component library does this project use?",
      choices: [
        {
          name: "shadcn/ui",
          value: { provider: "shadcn", confidence: 1, componentPath: "src/components/ui" },
        },
        { name: "MUI v5", value: { provider: "mui", confidence: 1, version: 5 } },
        { name: "MUI v6", value: { provider: "mui", confidence: 1, version: 6 } },
        { name: "Tailwind only", value: { provider: "tailwind-only", confidence: 1 } },
      ] as Array<{ name: string; value: DetectedUI }>,
    }
  )

  const roles = await resolveWithFallback<DetectedRoles>(
    {
      data: rolesParsed.data,
      confidence: rolesParsed.confidence,
      evidence: rolesParsed.evidence,
      category: "Roles",
    },
    "Role system",
    {
      message: "How are user roles stored in this project?",
      choices: [
        {
          name: "Database field (e.g. user.role in DB)",
          value: { roleField: "role", adminValue: "admin", viewerValue: "user", source: "db" },
        },
        {
          name: "JWT claim",
          value: { roleField: "role", adminValue: "admin", viewerValue: "user", source: "jwt" },
        },
        {
          name: "Auth provider metadata (Supabase user_metadata / Clerk publicMetadata)",
          value: {
            roleField: "role",
            adminValue: "admin",
            viewerValue: "user",
            source: "metadata",
          },
        },
      ] as Array<{ name: string; value: DetectedRoles }>,
    }
  )

  return { auth, orm, storage, ui, modules, roles }
}

// ---------------------------------------------------------------------------
// Strategy: Claude API (standalone with key)
// ---------------------------------------------------------------------------

async function analyzeWithClaude(
  projectRoot: string,
  snapshot: ProjectSnapshot
): Promise<ProjectAnalysis> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set.\n" +
        "Get your key at https://console.anthropic.com\n" +
        "Or run without a key — static analysis will be used with interactive prompts for ambiguous detections."
    )
  }

  const hasSrcDir = snapshot.dirStructure.some((d) => d === "src" || d.startsWith("src/"))
  const routerType: RouterType = snapshot.filePaths.some(
    (f) => f.startsWith("src/app/") || f.startsWith("app/")
  )
    ? "app"
    : "pages"

  // Read targeted files for each dimension
  logger.step(2, 3, "Running AI analysis (6 dimensions in parallel)...")

  const [authFiles, ormFiles, storageFiles, uiFiles, rolesFiles] = await Promise.all([
    readFilesForAnalysis(snapshot, [
      "package.json",
      "middleware.ts",
      "src/middleware.ts",
      "src/lib/auth.ts",
      "src/lib/supabase/server.ts",
      "auth.config.ts",
      "src/app/api/auth/[...nextauth]/route.ts",
    ]),
    readFilesForAnalysis(snapshot, [
      "package.json",
      "prisma/schema.prisma",
      "drizzle.config.ts",
      "src/db/schema.ts",
      "src/lib/db.ts",
      "src/lib/prisma.ts",
    ]),
    readFilesForAnalysis(snapshot, [
      "package.json",
      "src/lib/storage.ts",
      "src/lib/s3.ts",
      "src/lib/supabase/client.ts",
      ".env.example",
    ]),
    readFilesForAnalysis(snapshot, [
      "package.json",
      "components.json",
      "tailwind.config.ts",
      "tailwind.config.js",
      "src/components/ui/button.tsx",
    ]),
    readFilesForAnalysis(snapshot, [
      "prisma/schema.prisma",
      "src/types/index.ts",
      "src/types/auth.ts",
      "src/lib/auth.ts",
      "middleware.ts",
    ]),
  ])

  const client = new Anthropic()

  const spinner = logger.spinner("Calling Claude API...")

  const [authResult, ormResult, storageResult, uiResult, modulesResult, rolesResult] =
    await Promise.allSettled([
      callClaude(client, Prompts.buildAuthPrompt(authFiles, snapshot.packageJson)),
      callClaude(client, Prompts.buildORMPrompt(ormFiles, snapshot.packageJson)),
      callClaude(
        client,
        Prompts.buildStoragePrompt(storageFiles, snapshot.packageJson, snapshot.envVars)
      ),
      callClaude(client, Prompts.buildUIPrompt(uiFiles, snapshot.packageJson)),
      callClaude(
        client,
        Prompts.buildModulesPrompt(snapshot.routePaths, snapshot.dirStructure)
      ),
      callClaude(client, Prompts.buildRolesPrompt(rolesFiles, snapshot.packageJson)),
    ])

  spinner.succeed("Analysis complete")

  logger.step(3, 3, "Resolving ambiguous detections...")

  function getJson(result: PromiseSettledResult<string>, label: string): string | null {
    if (result.status === "fulfilled") return result.value
    logger.warn(`${label} analysis failed: ${String(result.reason)}`)
    return null
  }

  const authParsed = parseAuth(getJson(authResult, "Auth"))
  const ormParsed = parseORM(getJson(ormResult, "ORM"))
  const storageParsed = parseStorage(getJson(storageResult, "Storage"))
  const uiParsed = parseUI(getJson(uiResult, "UI"))
  const rolesParsed = parseRoles(getJson(rolesResult, "Roles"))
  const modulesJson = getJson(modulesResult, "Modules")
  const modules = parseModules(modulesJson, snapshot.routePaths)

  const resolved = await resolveAllDimensions(
    authParsed,
    ormParsed,
    storageParsed,
    uiParsed,
    rolesParsed,
    modules
  )

  const layout = await detectLayout(snapshot, hasSrcDir, routerType)

  return buildAnalysis(projectRoot, snapshot, hasSrcDir, routerType, resolved, layout)
}

// ---------------------------------------------------------------------------
// Strategy: static analysis with interactive fallback (claude-code / no-key)
// ---------------------------------------------------------------------------

async function analyzeWithStaticFallback(
  projectRoot: string,
  snapshot: ProjectSnapshot
): Promise<ProjectAnalysis> {
  logger.step(2, 3, "Running static analysis...")

  const staticResult = runStaticAnalysis(snapshot)

  // Build parsed results — use null-safe defaults for undetected dimensions
  const authParsed = staticResult.auth ?? {
    data: { provider: "custom" as const, confidence: 0, evidence: [], getUserIdSnippet: "" },
    confidence: 0,
    evidence: [],
  }

  const ormParsed = staticResult.orm ?? {
    data: { provider: "none" as const, confidence: 0 },
    confidence: 0,
    evidence: [],
  }

  const storageParsed = staticResult.storage ?? {
    data: { provider: "local" as const, confidence: 0, uploadDir: "public/uploads" },
    confidence: 0,
    evidence: [],
  }

  const uiParsed = staticResult.ui ?? {
    data: { provider: "tailwind-only" as const, confidence: 0 },
    confidence: 0,
    evidence: [],
  }

  logger.step(3, 3, "Resolving ambiguous detections...")

  const resolved = await resolveAllDimensions(
    authParsed,
    ormParsed,
    storageParsed,
    uiParsed,
    staticResult.roles,
    staticResult.modules
  )

  const hasSrcDir = snapshot.dirStructure.some((d) => d === "src" || d.startsWith("src/"))
  const routerType: RouterType = snapshot.filePaths.some(
    (f) => f.startsWith("src/app/") || f.startsWith("app/")
  )
    ? "app"
    : "pages"

  const layout = await detectLayout(snapshot, hasSrcDir, routerType)

  return buildAnalysis(projectRoot, snapshot, hasSrcDir, routerType, resolved, layout)
}

// ---------------------------------------------------------------------------
// Helper: assemble final ProjectAnalysis from resolved dimensions + snapshot
// ---------------------------------------------------------------------------

async function buildAnalysis(
  projectRoot: string,
  snapshot: ProjectSnapshot,
  hasSrcDir: boolean,
  routerType: RouterType,
  resolved: {
    auth: DetectedAuth
    orm: DetectedORM
    storage: DetectedStorage
    ui: DetectedUI
    modules: DetectedModule[]
    roles: DetectedRoles
  },
  layout: DetectedLayout
): Promise<ProjectAnalysis> {
  const [hasPnpmLock, hasYarnLock, hasBunLock] = await Promise.all([
    fileExists(path.join(projectRoot, "pnpm-lock.yaml")),
    fileExists(path.join(projectRoot, "yarn.lock")),
    fileExists(path.join(projectRoot, "bun.lockb")),
  ])

  const packageManager: ProjectAnalysis["packageManager"] = hasPnpmLock
    ? "pnpm"
    : hasYarnLock
      ? "yarn"
      : hasBunLock
        ? "bun"
        : "npm"

  const [hasPnpmWorkspace, hasTurbo, hasNx, hasLerna] = await Promise.all([
    fileExists(path.join(projectRoot, "pnpm-workspace.yaml")),
    fileExists(path.join(projectRoot, "turbo.json")),
    fileExists(path.join(projectRoot, "nx.json")),
    fileExists(path.join(projectRoot, "lerna.json")),
  ])

  const isMonorepo = hasPnpmWorkspace || hasTurbo || hasNx || hasLerna

  const projectName =
    typeof snapshot.packageJson.name === "string"
      ? snapshot.packageJson.name.replace(/^@[^/]+\//, "")
      : path.basename(projectRoot)

  const tsconfig = await snapshot.readFile("tsconfig.json")
  let tsConfigPaths: Record<string, string[]> = {}
  if (tsconfig) {
    try {
      const parsed = JSON.parse(tsconfig) as {
        compilerOptions?: { paths?: Record<string, string[]> }
      }
      tsConfigPaths = parsed.compilerOptions?.paths ?? {}
    } catch {
      // ignore parse errors
    }
  }

  return {
    projectRoot,
    routerType,
    hasSrcDir,
    auth: resolved.auth,
    orm: resolved.orm,
    storage: resolved.storage,
    ui: resolved.ui,
    modules: resolved.modules,
    layout,
    roles: resolved.roles,
    packageManager,
    existingEnvVars: snapshot.envVars,
    tsConfigPaths,
    isMonorepo,
    projectName,
  }
}

// ---------------------------------------------------------------------------
// Main entry point — routes to the correct strategy
// ---------------------------------------------------------------------------

export async function analyzeProject(projectRoot: string): Promise<ProjectAnalysis> {
  logger.section("Analyzing project")

  logger.step(1, 3, "Reading project files...")
  const snapshot = await buildProjectSnapshot(projectRoot)

  const env = detectRunEnvironment()

  if (env === "claude-code") {
    logger.info("Running in Claude Code — using static analysis (no API key required)")
    return analyzeWithStaticFallback(projectRoot, snapshot)
  }

  if (env === "standalone-with-key") {
    logger.info(`Using Claude API (${MODEL}) for intelligent project analysis...`)
    return analyzeWithClaude(projectRoot, snapshot)
  }

  // standalone-no-key: static analysis + interactive fallback for low-confidence dimensions
  logger.warn("No ANTHROPIC_API_KEY found — using static analysis with interactive fallback")
  logger.info("Tip: set ANTHROPIC_API_KEY for fully automatic analysis")
  return analyzeWithStaticFallback(projectRoot, snapshot)
}
