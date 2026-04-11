import type { ORMAdapterPlugin } from "../../types/plugin.js"
import type {
  DetectedORM,
  DetectionResult,
  GeneratedFile,
  ProjectAnalysis,
  ProjectFiles,
} from "../../analyzer/types.js"
import { PLUGIN_CONTRACT_VERSION } from "../../types/plugin.js"

const PRISMA_SCHEMA_APPEND = `// ---------------------------------------------------------------------------
// feedback-wizard — append to your existing schema.prisma
// ---------------------------------------------------------------------------

enum ImprovementStatus {
  open
  in_progress
  resolved
  closed
}

enum ImprovementType {
  bug
  feature
  improvement
  question
}

enum ImprovementPriority {
  low
  medium
  high
  critical
}

enum AttachmentType {
  image
  video
  document
  other
}

model FwImprovement {
  id          String              @id @default(cuid())
  title       String
  description String
  type        ImprovementType
  status      ImprovementStatus   @default(open)
  priority    ImprovementPriority @default(medium)
  createdById String
  assignedToId String?
  moduleSlug  String?
  metadata    Json?
  createdAt   DateTime            @default(now())
  updatedAt   DateTime            @updatedAt

  comments    FwComment[]
  attachments FwAttachment[]
  statusHistory FwStatusHistory[]
}

model FwComment {
  id             String        @id @default(cuid())
  improvementId  String
  authorId       String
  body           String
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt

  improvement    FwImprovement @relation(fields: [improvementId], references: [id], onDelete: Cascade)
}

model FwAttachment {
  id            String         @id @default(cuid())
  improvementId String
  uploadedById  String
  filePath      String
  fileName      String
  mimeType      String
  sizeBytes     Int
  type          AttachmentType @default(other)
  createdAt     DateTime       @default(now())

  improvement   FwImprovement  @relation(fields: [improvementId], references: [id], onDelete: Cascade)
}

model FwStatusHistory {
  id            String            @id @default(cuid())
  improvementId String
  changedById   String
  fromStatus    ImprovementStatus?
  toStatus      ImprovementStatus
  createdAt     DateTime          @default(now())

  improvement   FwImprovement     @relation(fields: [improvementId], references: [id], onDelete: Cascade)
}
`

const QUERY_HELPERS_CONTENT = `import { prisma } from "@/lib/prisma"
import type {
  ImprovementStatus,
  ImprovementType,
  ImprovementPriority,
} from "@prisma/client"

export async function listImprovements(filters?: {
  status?: ImprovementStatus
  type?: ImprovementType
  priority?: ImprovementPriority
  moduleSlug?: string
  createdById?: string
}) {
  return prisma.fwImprovement.findMany({
    where: {
      status: filters?.status,
      type: filters?.type,
      priority: filters?.priority,
      moduleSlug: filters?.moduleSlug,
      createdById: filters?.createdById,
    },
    include: {
      comments: { orderBy: { createdAt: "asc" } },
      attachments: true,
      statusHistory: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { createdAt: "desc" },
  })
}

export async function getImprovementById(id: string) {
  return prisma.fwImprovement.findUnique({
    where: { id },
    include: {
      comments: { orderBy: { createdAt: "asc" } },
      attachments: true,
      statusHistory: { orderBy: { createdAt: "asc" } },
    },
  })
}

export async function createImprovement(data: {
  title: string
  description: string
  type: ImprovementType
  priority: ImprovementPriority
  createdById: string
  moduleSlug?: string
  metadata?: Record<string, unknown>
}) {
  return prisma.$transaction(async (tx) => {
    const improvement = await tx.fwImprovement.create({ data })
    await tx.fwStatusHistory.create({
      data: {
        improvementId: improvement.id,
        changedById: data.createdById,
        fromStatus: null,
        toStatus: "open",
      },
    })
    return improvement
  })
}

export async function updateImprovementStatus(
  improvementId: string,
  toStatus: ImprovementStatus,
  changedById: string,
) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.fwImprovement.findUniqueOrThrow({
      where: { id: improvementId },
      select: { status: true },
    })
    const updated = await tx.fwImprovement.update({
      where: { id: improvementId },
      data: { status: toStatus },
    })
    await tx.fwStatusHistory.create({
      data: {
        improvementId,
        changedById,
        fromStatus: current.status,
        toStatus,
      },
    })
    return updated
  })
}
`

export const PrismaORMAdapter: ORMAdapterPlugin = {
  meta: {
    id: "orm:prisma",
    name: "Prisma ORM",
    description: "Adapter for Prisma — appends models to existing schema.prisma",
    contractVersion: PLUGIN_CONTRACT_VERSION,
    kind: "orm",
  },

  async detect(files: ProjectFiles): Promise<DetectionResult<DetectedORM>> {
    const evidence: string[] = []
    let confidence = 0

    const pkg = files.packageJson as Record<string, Record<string, string>>
    const deps = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    }

    if ("@prisma/client" in deps) {
      evidence.push("Found @prisma/client in dependencies")
      confidence += 50
    }
    if ("prisma" in deps) {
      evidence.push("Found prisma in devDependencies")
      confidence += 20
    }

    const schemaPath = files.filePaths.find((p) => p.endsWith("schema.prisma"))
    if (schemaPath) {
      evidence.push(`Found schema.prisma at ${schemaPath}`)
      confidence += 30
    }

    return {
      data: {
        provider: "prisma",
        confidence,
        schemaPath: schemaPath ?? "prisma/schema.prisma",
      },
      confidence,
      evidence,
      category: "orm",
    }
  },

  async generateMigration(_analysis: ProjectAnalysis): Promise<GeneratedFile[]> {
    return [
      {
        path: "prisma/schema.prisma",
        content: PRISMA_SCHEMA_APPEND,
        overwritePolicy: "ask",
      },
    ]
  },

  async generateQueryHelpers(_analysis: ProjectAnalysis): Promise<GeneratedFile[]> {
    return [
      {
        path: "lib/fw/queries/improvements.ts",
        content: QUERY_HELPERS_CONTENT,
        overwritePolicy: "always",
      },
    ]
  },

  postInstallCommands(_analysis: ProjectAnalysis): string[] {
    return ["npx prisma migrate dev --name add-feedback-wizard"]
  },

  getImportsBlock(_analysis: ProjectAnalysis): string {
    return `import { prisma } from "@/lib/prisma"`
  },

  getClientInitBlock(_analysis: ProjectAnalysis): string {
    return ""
  },

  getEnumImportBlock(tablePrefix: string): string {
    if (!tablePrefix) {
      return [
        `import {`,
        `  ImprovementStatus,`,
        `  ImprovementType,`,
        `  ImprovementPriority,`,
        `  AttachmentType,`,
        `} from "@prisma/client"`,
      ].join("\n")
    }

    return [
      `import {`,
      `  ${tablePrefix}ImprovementStatus,`,
      `  ${tablePrefix}ImprovementType,`,
      `  ${tablePrefix}ImprovementPriority,`,
      `  ${tablePrefix}AttachmentType,`,
      `} from "@prisma/client"`,
    ].join("\n")
  },
}

// ---------------------------------------------------------------------------
// Helper exports
// ---------------------------------------------------------------------------

export function getPrismaMigrationInstructions(): string {
  return "Run: npx prisma migrate dev --name add-feedback-wizard"
}

export function getPrismaSchemaAppend(): string {
  return PRISMA_SCHEMA_APPEND
}
