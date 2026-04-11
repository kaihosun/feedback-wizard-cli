// ---------------------------------------------------------------------------
// Prompt builders for each analysis dimension.
//
// Every function returns a self-contained prompt string that instructs
// Claude to respond with ONLY a JSON object (no prose, no markdown fences).
// ---------------------------------------------------------------------------

function formatFiles(files: Record<string, string>): string {
  const entries = Object.entries(files)
  if (entries.length === 0) return "(no files provided)"
  return entries
    .map(([name, content]) => `--- FILE: ${name} ---\n${content}`)
    .join("\n\n")
}

function formatDeps(packageJson: Record<string, unknown>): string {
  const deps = {
    ...(typeof packageJson.dependencies === "object" && packageJson.dependencies !== null
      ? (packageJson.dependencies as Record<string, string>)
      : {}),
    ...(typeof packageJson.devDependencies === "object" && packageJson.devDependencies !== null
      ? (packageJson.devDependencies as Record<string, string>)
      : {}),
  }
  return Object.keys(deps).join(", ")
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export function buildAuthPrompt(
  files: Record<string, string>,
  packageJson: Record<string, unknown>
): string {
  const deps = formatDeps(packageJson)
  const fileContents = formatFiles(files)

  return `You are a code analysis tool. Detect the authentication provider used in this Next.js project.

## Installed packages (dependencies + devDependencies)
${deps}

## Relevant files
${fileContents}

## Detection rules (apply in order, stop at first match)
1. If \`@supabase/ssr\` OR \`@supabase/auth-helpers-nextjs\` is in packages → provider "supabase", confidence 0.95
2. If \`@clerk/nextjs\` is in packages → provider "clerk", confidence 0.95
3. If \`next-auth\` OR \`@auth/core\` is in packages → provider "nextauth", confidence 0.90
   - version 5 if imports use \`from "@auth/nextjs"\` or \`from "next-auth/v5"\` or the package version starts with \`^5\`
   - version 4 otherwise
4. If \`firebase\` AND \`firebase-admin\` are in packages → provider "firebase", confidence 0.95
   - variant "custom-claims" if any file references \`customClaims\` or \`setCustomUserClaims\`
   - variant "firestore-roles" if roles are stored in a Firestore \`/users\` collection
   - variant "no-roles" otherwise
5. If only \`firebase\` (no firebase-admin) → provider "firebase", confidence 0.60, variant "no-roles"
6. If none of the above but auth logic is detected → provider "custom", confidence 0.50
   - Try to extract a getUserIdSnippet: 1-3 lines of code that retrieve the current user's ID from request context

## Output format — respond with ONLY this JSON object, no other text:
{
  "provider": "supabase" | "nextauth" | "clerk" | "firebase" | "custom",
  "confidence": <number 0.0–1.0>,
  "evidence": ["<short string describing what you found>"],
  "version": <4 | 5 | null>,
  "variant": "custom-claims" | "firestore-roles" | "no-roles" | null,
  "getUserIdSnippet": "<string | null>"
}

If no auth is detected at all, use provider "custom", confidence 0.10, and null for optional fields.`
}

// ---------------------------------------------------------------------------
// ORM
// ---------------------------------------------------------------------------

export function buildORMPrompt(
  files: Record<string, string>,
  packageJson: Record<string, unknown>
): string {
  const deps = formatDeps(packageJson)
  const fileContents = formatFiles(files)

  return `You are a code analysis tool. Detect the ORM or database client used in this Next.js project.

## Installed packages
${deps}

## Relevant files
${fileContents}

## Detection rules (apply in order, stop at first match)
1. If \`@prisma/client\` is in packages → provider "prisma", confidence 0.98
   - schemaPath: look for the \`prisma.schemaFileLocation\` field in package.json, or default to "prisma/schema.prisma"
2. If \`drizzle-orm\` is in packages → provider "drizzle", confidence 0.98
   - schemaPath: look for \`drizzle.config.ts\` content or default to "src/db/schema.ts"
3. If \`pg\`, \`postgres\`, or \`@vercel/postgres\` is in packages (without prisma/drizzle) → provider "pg-raw", confidence 0.85
   - pgClient: "vercel-postgres" if \`@vercel/postgres\` present, "postgres" if \`postgres\` present, "pg" otherwise
4. None of the above → provider "none", confidence 0.90

## Output format — respond with ONLY this JSON object, no other text:
{
  "provider": "prisma" | "drizzle" | "pg-raw" | "none",
  "confidence": <number 0.0–1.0>,
  "evidence": ["<short string>"],
  "schemaPath": "<string | null>",
  "pgClient": "pg" | "postgres" | "vercel-postgres" | null
}`
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export function buildStoragePrompt(
  files: Record<string, string>,
  packageJson: Record<string, unknown>,
  envVarNames: string[]
): string {
  const deps = formatDeps(packageJson)
  const fileContents = formatFiles(files)
  const envList = envVarNames.join(", ")

  return `You are a code analysis tool. Detect the file storage provider used in this Next.js project.

## Installed packages
${deps}

## Environment variable names (values NOT shown — names only)
${envList || "(none found)"}

## Relevant files
${fileContents}

## Detection rules (apply in order, stop at first match)
1. If \`@supabase/ssr\` or \`@supabase/auth-helpers-nextjs\` is in packages AND any file contains \`supabase.storage\` or \`.from(\` with a bucket call → provider "supabase", confidence 0.90
   - bucketName: look for the string argument to \`.from(\` in the files, or check env vars like \`SUPABASE_STORAGE_BUCKET\`, \`STORAGE_BUCKET\`
2. If \`@aws-sdk/client-s3\` or \`aws-sdk\` is in packages → provider "s3", confidence 0.95
   - region: check env vars for \`AWS_REGION\`, \`S3_REGION\`; check S3Client config in files
   - bucketName: check env vars for \`S3_BUCKET\`, \`STORAGE_BUCKET\`, \`AWS_S3_BUCKET\`
3. If \`firebase-admin/storage\` or \`firebase/storage\` appears in any file or package → provider "firebase", confidence 0.90
   - bucketName: check env vars for \`FIREBASE_STORAGE_BUCKET\`
4. Default → provider "local", confidence 0.40, no bucket or region

## Output format — respond with ONLY this JSON object, no other text:
{
  "provider": "supabase" | "s3" | "firebase" | "local",
  "confidence": <number 0.0–1.0>,
  "evidence": ["<short string>"],
  "bucketName": "<string | null>",
  "region": "<string | null>"
}`
}

// ---------------------------------------------------------------------------
// UI library
// ---------------------------------------------------------------------------

export function buildUIPrompt(
  files: Record<string, string>,
  packageJson: Record<string, unknown>
): string {
  const deps = formatDeps(packageJson)
  const fileContents = formatFiles(files)

  return `You are a code analysis tool. Detect the UI component library used in this Next.js project.

## Installed packages
${deps}

## Relevant files
${fileContents}

## Detection rules (apply in order, stop at first match)
1. If a \`components.json\` file is present (its content is shown above) → provider "shadcn", confidence 0.99
   - componentPath: use the \`aliases.components\` path from components.json, or default to "src/components/ui"
2. If \`@mui/material\` is in packages → provider "mui", confidence 0.95
   - muiVersion: parse the semver to determine major version (5 or 6)
   - componentPath: null (MUI uses package imports)
3. If \`tailwindcss\` is in packages but NOT shadcn and NOT mui → provider "tailwind-only", confidence 0.85
   - componentPath: null
4. None → provider "tailwind-only", confidence 0.30

## Output format — respond with ONLY this JSON object, no other text:
{
  "provider": "shadcn" | "mui" | "tailwind-only",
  "confidence": <number 0.0–1.0>,
  "evidence": ["<short string>"],
  "componentPath": "<string | null>",
  "muiVersion": <5 | 6 | null>
}`
}

// ---------------------------------------------------------------------------
// Modules
// ---------------------------------------------------------------------------

export function buildModulesPrompt(routes: string[], dirNames: string[]): string {
  const routeList = routes.length > 0 ? routes.join("\n") : "(no routes detected)"
  const dirList = dirNames.length > 0 ? dirNames.join(", ") : "(none)"

  return `You are a code analysis tool. Derive a concise list of application modules from the URL routes and directory names of a Next.js project.

## URL routes
${routeList}

## Directory names (first and second level)
${dirList}

## Instructions
- Group related routes under a single module name (e.g. /tickets, /tickets/:id → "Tickets")
- Use the same language implied by the route/directory names (if Spanish → Spanish names)
- Exclude authentication routes: /login, /register, /signup, /sign-in, /sign-up, /forgot-password, /reset-password, /callback, /verify
- Always include "General" as the last entry
- Return a maximum of 12 module names
- If only one non-auth route exists, return ["<ModuleName>", "General"]
- If zero non-auth routes exist, return ["General"]
- If no routes are provided or all are auth routes, return ["General"]

## Output format — respond with ONLY this JSON array, no other text:
["ModuleName1", "ModuleName2", "General"]`
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export function buildRolesPrompt(
  files: Record<string, string>,
  packageJson: Record<string, unknown>
): string {
  const deps = formatDeps(packageJson)
  const fileContents = formatFiles(files)

  return `You are a code analysis tool. Detect the role/permissions system used in this Next.js project.

## Installed packages
${deps}

## Relevant files
${fileContents}

## What to look for
- Enums in Prisma schema (e.g. \`enum Role { admin user viewer }\`)
- TypeScript union types or const objects with role values
- Role checks in middleware or auth utilities (e.g. \`user.role === "admin"\`, \`metadata.role\`)
- JWT claims or Supabase user_metadata fields

## Detection logic
- roleField: the property name used to store the role (e.g. "role", "user_role", "type")
- adminValue: the string/enum value that represents an admin (e.g. "admin", "ADMIN", "superuser")
- viewerValue: the string/enum value that represents a read-only user (e.g. "user", "viewer", "MEMBER")
- source:
  - "db" if roles come from a database table/model field
  - "jwt" if roles come from a JWT claim
  - "metadata" if roles come from auth provider metadata (e.g. Supabase user_metadata, Clerk publicMetadata)
- confidence: how certain you are based on evidence found
- If no role system is found, use defaults: roleField "role", adminValue "admin", viewerValue "user", source "db", confidence 0.30

## Output format — respond with ONLY this JSON object, no other text:
{
  "confidence": <number 0.0–1.0>,
  "evidence": ["<short string>"],
  "roleField": "<string>",
  "adminValue": "<string>",
  "viewerValue": "<string>",
  "source": "db" | "jwt" | "metadata"
}`
}
