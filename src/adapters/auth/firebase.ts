import type { AuthAdapterPlugin } from "../../types/plugin.js"
import type {
  DetectedAuth,
  DetectionResult,
  GeneratedFile,
  ProjectAnalysis,
  ProjectFiles,
} from "../../analyzer/types.js"
import { PLUGIN_CONTRACT_VERSION } from "../../types/plugin.js"

export type FirebaseAuthVariant = "custom-claims" | "firestore-roles" | "no-roles"

const FIREBASE_ADMIN_HELPER_CONTENT = `// Singleton initializer para firebase-admin
import { getApps, initializeApp, cert } from "firebase-admin/app"

export function initFirebaseAdmin(): void {
  if (getApps().length === 0) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\\\n/g, "\\n"),
      }),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    })
  }
}
`

function buildFirebaseAdapter(variant: FirebaseAuthVariant): AuthAdapterPlugin {
  return {
    meta: {
      id: "auth:firebase",
      name: "Firebase Auth",
      description: `Adapter for Firebase Auth — variant: ${variant}`,
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

      if ("firebase-admin" in deps) {
        evidence.push("Found firebase-admin in dependencies")
        confidence += 50
      }
      if ("firebase" in deps) {
        evidence.push("Found firebase in dependencies")
        confidence += 20
      }

      const hasFirebaseAdminFile = files.filePaths.some(
        (p) => p.includes("firebase-admin") || p.includes("firebase/admin"),
      )
      if (hasFirebaseAdminFile) {
        evidence.push("Found firebase-admin helper file")
        confidence += 20
      }

      const hasFirebaseEnv = files.envFiles.some((line) =>
        line.includes("FIREBASE_PROJECT_ID"),
      )
      if (hasFirebaseEnv) {
        evidence.push("Found FIREBASE_PROJECT_ID in env files")
        confidence += 10
      }

      return {
        data: {
          provider: "firebase",
          confidence,
          evidence,
          variant,
        },
        confidence,
        evidence,
        category: "auth",
      }
    },

    generateGetUserIdSnippet(_analysis: ProjectAnalysis): string {
      const baseBlock = [
        `import { headers } from "next/headers"`,
        `import { getAuth as getAdminAuth } from "firebase-admin/auth"`,
        `import { initFirebaseAdmin } from "@/lib/firebase-admin"`,
        ``,
        `initFirebaseAdmin()`,
        `const authorization = (await headers()).get("Authorization")`,
        `if (!authorization?.startsWith("Bearer ")) return { success: false, error: "No autenticado" }`,
        `const idToken = authorization.slice(7)`,
        `let decodedToken`,
        `try {`,
        `  decodedToken = await getAdminAuth().verifyIdToken(idToken)`,
        `} catch {`,
        `  return { success: false, error: "Token inválido o expirado" }`,
        `}`,
        `const userId = decodedToken.uid`,
      ]

      if (variant === "custom-claims") {
        return [
          ...baseBlock,
          `const userRole = (decodedToken.role as string) ?? "viewer"`,
        ].join("\n")
      }

      if (variant === "firestore-roles") {
        return [
          ...baseBlock,
          `import { getFirestore } from "firebase-admin/firestore"`,
          `const db = getFirestore()`,
          `const userDoc = await db.collection("users").doc(userId).get()`,
          `const userRole = (userDoc.data()?.role as string) ?? "viewer"`,
        ].join("\n")
      }

      // no-roles
      return [
        ...baseBlock,
        `const userRole = "viewer"`,
      ].join("\n")
    },

    async generateFiles(_analysis: ProjectAnalysis): Promise<GeneratedFile[]> {
      return [
        {
          path: "lib/firebase-admin.ts",
          content: FIREBASE_ADMIN_HELPER_CONTENT,
          overwritePolicy: "skip-if-exists",
        },
      ]
    },

    requiredEnvVars(_analysis: ProjectAnalysis): string[] {
      const base = [
        "FIREBASE_PROJECT_ID",
        "FIREBASE_CLIENT_EMAIL",
        "FIREBASE_PRIVATE_KEY",
      ]
      if (variant === "firestore-roles" || variant === "custom-claims") {
        return base
      }
      return base
    },
  }
}

export const FirebaseCustomClaimsAdapter: AuthAdapterPlugin =
  buildFirebaseAdapter("custom-claims")
export const FirebaseFirestoreRolesAdapter: AuthAdapterPlugin =
  buildFirebaseAdapter("firestore-roles")
export const FirebaseNoRolesAdapter: AuthAdapterPlugin =
  buildFirebaseAdapter("no-roles")

export function createFirebaseAdapter(
  variant: FirebaseAuthVariant,
): AuthAdapterPlugin {
  return buildFirebaseAdapter(variant)
}

// ---------------------------------------------------------------------------
// Helper blocks
// ---------------------------------------------------------------------------

export function getFirebaseImportsBlock(variant: FirebaseAuthVariant): string {
  const base = [
    `import { headers } from "next/headers"`,
    `import { getAuth as getAdminAuth } from "firebase-admin/auth"`,
    `import { initFirebaseAdmin } from "@/lib/firebase-admin"`,
  ]
  if (variant === "firestore-roles") {
    base.push(`import { getFirestore } from "firebase-admin/firestore"`)
  }
  return base.join("\n")
}

export function getFirebaseAdminHelperContent(): string {
  return FIREBASE_ADMIN_HELPER_CONTENT
}

export function getFirebaseAdminHelperFile(): GeneratedFile {
  return {
    path: "lib/firebase-admin.ts",
    content: FIREBASE_ADMIN_HELPER_CONTENT,
    overwritePolicy: "skip-if-exists",
  }
}
