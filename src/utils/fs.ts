import { promises as fsPromises } from "fs"
import path from "path"
import fsExtra from "fs-extra"
import { glob } from "glob"

/**
 * Reads a file safely. Returns null if the file does not exist or cannot be read.
 */
export async function readFileSafe(filePath: string): Promise<string | null> {
  try {
    return await fsPromises.readFile(filePath, "utf-8")
  } catch {
    return null
  }
}

/**
 * Reads and parses a JSON file safely. Returns null if the file does not exist
 * or its contents are not valid JSON.
 */
export async function readJsonSafe<T>(filePath: string): Promise<T | null> {
  const content = await readFileSafe(filePath)
  if (content === null) return null
  try {
    return JSON.parse(content) as T
  } catch {
    return null
  }
}

/**
 * Returns true if the path exists (file or directory).
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fsPromises.access(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * Ensures a directory exists, creating it (and any parents) if necessary.
 */
export async function ensureDir(dirPath: string): Promise<void> {
  await fsExtra.ensureDir(dirPath)
}

/**
 * Recursively lists all files under `dir` whose extension is in `extensions`.
 * Extensions should be provided without a leading dot, e.g. ["ts", "tsx"].
 */
export async function readDirRecursive(
  dir: string,
  extensions: string[]
): Promise<string[]> {
  const patterns = extensions.map((ext) => `**/*.${ext}`)
  const results: string[] = []

  for (const pattern of patterns) {
    const matches = await glob(pattern, {
      cwd: dir,
      absolute: true,
      ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**"],
    })
    results.push(...matches)
  }

  // Deduplicate in case multiple patterns match the same file
  return [...new Set(results)]
}

/**
 * Copies a template file to `destPath`, replacing all `{{KEY}}` placeholders
 * with the corresponding values from `replacements`.
 */
export async function copyTemplate(
  templatePath: string,
  destPath: string,
  replacements: Record<string, string>
): Promise<void> {
  const content = await readFileSafe(templatePath)
  if (content === null) {
    throw new Error(`Template not found: ${templatePath}`)
  }

  let result = content
  for (const [key, value] of Object.entries(replacements)) {
    // Replace all occurrences of {{KEY}}
    result = result.replaceAll(`{{${key}}}`, value)
  }

  await ensureDir(path.dirname(destPath))
  await fsPromises.writeFile(destPath, result, "utf-8")
}
