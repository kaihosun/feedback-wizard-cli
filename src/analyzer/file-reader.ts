import path from "path"
import { glob } from "glob"
import { readFileSafe, readJsonSafe } from "../utils/fs.js"

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ProjectSnapshot = {
  packageJson: Record<string, unknown>
  envVars: string[]         // only the NAMES of env vars — never the values
  filePaths: string[]       // relative paths of all source files in the project
  routePaths: string[]      // clean URL paths detected (e.g. "/dashboard", "/tickets")
  dirStructure: string[]    // first- and second-level directory names
  readFile: (relativePath: string) => Promise<string | null>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parses an env file string and returns only the variable names (before `=`).
 * Ignores comment lines and blank lines.
 */
function extractEnvVarNames(content: string): string[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => line.split("=")[0].trim())
    .filter((name) => name.length > 0)
}

/**
 * Converts a Next.js file-system path to a clean URL path.
 *
 * Rules applied in order:
 *  1. Remove leading `src/app/` or `app/` prefix (App Router)
 *  2. Remove leading `src/pages/` or `pages/` prefix (Pages Router)
 *  3. Remove trailing `/page` or `/page.tsx` etc.
 *  4. Remove route group segments like `(dashboard)` → ``
 *  5. Replace dynamic segments like `[id]` with `:id`
 *  6. Ensure the path starts with `/`
 *  7. Collapse double slashes
 */
export function filePathToRoute(filePath: string): string {
  let p = filePath
    .replace(/^src\/app\//, "")
    .replace(/^app\//, "")
    .replace(/^src\/pages\//, "")
    .replace(/^pages\//, "")

  // Strip the trailing filename component (page.tsx, index.tsx, etc.)
  p = p
    .replace(/\/page\.(tsx|ts|jsx|js)$/, "")
    .replace(/\/index\.(tsx|ts|jsx|js)$/, "")
    .replace(/\.(tsx|ts|jsx|js)$/, "")

  // Remove route groups like (dashboard), (auth), etc.
  p = p.replace(/\([^)]+\)\/?/g, "")

  // Replace dynamic segments like [id], [slug] with :param
  p = p.replace(/\[([^\]]+)\]/g, ":$1")

  // Normalize
  p = "/" + p
  p = p.replace(/\/+/g, "/")
  p = p.replace(/\/$/, "") || "/"

  return p
}

// ---------------------------------------------------------------------------
// Main export: buildProjectSnapshot
// ---------------------------------------------------------------------------

export async function buildProjectSnapshot(projectRoot: string): Promise<ProjectSnapshot> {
  const ignore = [
    "**/node_modules/**",
    "**/.next/**",
    "**/dist/**",
    "**/.git/**",
    "**/out/**",
    "**/.turbo/**",
  ]

  // 1. Read package.json
  const packageJson =
    (await readJsonSafe<Record<string, unknown>>(path.join(projectRoot, "package.json"))) ?? {}

  // 2. Read env files — names only, never values
  const envFileNames = [".env", ".env.local", ".env.example", ".env.development"]
  const envVarSets = await Promise.all(
    envFileNames.map(async (name) => {
      const content = await readFileSafe(path.join(projectRoot, name))
      return content ? extractEnvVarNames(content) : []
    })
  )
  const envVars = [...new Set(envVarSets.flat())]

  // 3. List all source files
  const sourceFiles = await glob("**/*.{ts,tsx,js,jsx,prisma}", {
    cwd: projectRoot,
    ignore,
    nodir: true,
  })

  // 4. Detect route paths from Next.js page files
  const appRouterPages = await glob("**/page.{tsx,ts,jsx,js}", {
    cwd: projectRoot,
    ignore,
    nodir: true,
  })

  const pagesRouterPages = await glob("pages/**/*.{tsx,ts,jsx,js}", {
    cwd: projectRoot,
    ignore: [...ignore, "**/pages/api/**"],
    nodir: true,
  })

  const srcPagesRouterPages = await glob("src/pages/**/*.{tsx,ts,jsx,js}", {
    cwd: projectRoot,
    ignore: [...ignore, "**/pages/api/**"],
    nodir: true,
  })

  const allPageFiles = [...new Set([...appRouterPages, ...pagesRouterPages, ...srcPagesRouterPages])]
  const routePaths = [...new Set(allPageFiles.map(filePathToRoute))].filter(
    // Remove pure auth routes
    (r) =>
      !/^\/(login|register|signup|sign-in|sign-up|forgot-password|reset-password|callback|auth|verify)(\/|$)/i.test(
        r
      )
  )

  // 5. Directory structure — first and second level dirs
  const allDirs = await glob("**/", {
    cwd: projectRoot,
    ignore,
  })

  const dirStructure = [
    ...new Set(
      allDirs
        .map((d) => d.replace(/\/$/, ""))
        .filter((d) => {
          const depth = d.split("/").length
          return depth >= 1 && depth <= 2
        })
    ),
  ].sort()

  // 6. readFile helper
  const readFile = (relativePath: string): Promise<string | null> =>
    readFileSafe(path.join(projectRoot, relativePath))

  return {
    packageJson,
    envVars,
    filePaths: sourceFiles,
    routePaths,
    dirStructure,
    readFile,
  }
}

// ---------------------------------------------------------------------------
// Helper for analyzer: read a targeted subset of files
// ---------------------------------------------------------------------------

const MAX_FILE_CHARS = 8000

export async function readFilesForAnalysis(
  snapshot: ProjectSnapshot,
  targets: string[]
): Promise<Record<string, string>> {
  const entries = await Promise.all(
    targets.map(async (relativePath) => {
      const content = await snapshot.readFile(relativePath)
      if (!content) return null
      return [relativePath, content.slice(0, MAX_FILE_CHARS)] as const
    })
  )
  return Object.fromEntries(entries.filter((e): e is [string, string] => e !== null))
}
