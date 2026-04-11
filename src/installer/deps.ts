import path from "path"
import { execa } from "execa"
import { fileExists, readJsonSafe } from "../utils/fs.js"
import { logger } from "../utils/logger.js"
import type { AdapterStack } from "../adapters/index.js"

// ---------------------------------------------------------------------------
// Package manager detection
// ---------------------------------------------------------------------------

export async function detectPackageManager(
  projectRoot: string,
): Promise<"npm" | "pnpm" | "yarn" | "bun"> {
  const [hasBun, hasPnpm, hasYarn] = await Promise.all([
    fileExists(path.join(projectRoot, "bun.lockb")),
    fileExists(path.join(projectRoot, "pnpm-lock.yaml")),
    fileExists(path.join(projectRoot, "yarn.lock")),
  ])

  if (hasBun) return "bun"
  if (hasPnpm) return "pnpm"
  if (hasYarn) return "yarn"
  return "npm"
}

// ---------------------------------------------------------------------------
// Required dependencies by adapter stack
// ---------------------------------------------------------------------------

export async function getRequiredDependencies(adapters: AdapterStack): Promise<string[]> {
  // Always required — used by generated components and actions
  const required: string[] = ["zod", "lucide-react"]

  // Auth-specific deps
  if (adapters.auth.meta.id === "auth:firebase") {
    required.push("firebase-admin")
  }

  // Storage-specific deps
  if (adapters.storage.meta.id === "storage:s3") {
    required.push("@aws-sdk/client-s3", "@aws-sdk/s3-request-presigner")
  }

  // ORM-specific deps
  if (adapters.orm.meta.id === "orm:drizzle") {
    required.push("drizzle-orm")
  }

  // shadcn components are installed via their own CLI adapter — not here

  return required
}

// ---------------------------------------------------------------------------
// Detect which required packages are missing from the target project
// ---------------------------------------------------------------------------

type PackageJson = {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

export async function getMissingDependencies(
  projectRoot: string,
  required: string[],
): Promise<string[]> {
  const pkgPath = path.join(projectRoot, "package.json")
  const pkg = await readJsonSafe<PackageJson>(pkgPath)

  if (pkg === null) {
    logger.warn("Could not read package.json — assuming all dependencies are missing")
    return required
  }

  const installed = new Set<string>([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ])

  return required.filter((dep) => !installed.has(dep))
}

// ---------------------------------------------------------------------------
// Install missing dependencies
// ---------------------------------------------------------------------------

export async function installDependencies(
  projectRoot: string,
  packages: string[],
  packageManager: "npm" | "pnpm" | "yarn" | "bun",
): Promise<void> {
  if (packages.length === 0) return

  const commands: Record<typeof packageManager, string[]> = {
    npm: ["install", ...packages],
    pnpm: ["add", ...packages],
    yarn: ["add", ...packages],
    bun: ["add", ...packages],
  }

  const args = commands[packageManager]
  logger.info(`Running: ${packageManager} ${args.join(" ")}`)

  try {
    await execa(packageManager, args, {
      cwd: projectRoot,
      stdio: "inherit",
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error(`Failed to install dependencies: ${message}`)
    throw err
  }
}
