import { existsSync } from "fs"
import { join } from "path"
import type { UIAdapterPlugin } from "../../types/plugin.js"
import type {
  DetectedUI,
  DetectionResult,
  GeneratedFile,
  ProjectAnalysis,
  ProjectFiles,
} from "../../analyzer/types.js"
import { PLUGIN_CONTRACT_VERSION } from "../../types/plugin.js"

export const REQUIRED_SHADCN_COMPONENTS = [
  "button",
  "dialog",
  "select",
  "tabs",
  "textarea",
  "skeleton",
  "badge",
  "scroll-area",
] as const

export type ShadcnComponent = (typeof REQUIRED_SHADCN_COMPONENTS)[number]

const WIDGET_COMPONENT_CONTENT = `"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"

type FeedbackType = "bug" | "feature" | "improvement" | "question"
type FeedbackPriority = "low" | "medium" | "high" | "critical"

export function FeedbackWizardWidget() {
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<FeedbackType>("improvement")
  const [priority, setPriority] = useState<FeedbackPriority>("medium")
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      const res = await fetch("/api/fw/improvements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description, type, priority }),
      })
      if (!res.ok) throw new Error("Failed to submit")
      setOpen(false)
      setTitle("")
      setDescription("")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Reportar
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Enviar comentario</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Tabs value={type} onValueChange={(v) => setType(v as FeedbackType)}>
            <TabsList className="w-full">
              <TabsTrigger value="bug">Bug</TabsTrigger>
              <TabsTrigger value="feature">Feature</TabsTrigger>
              <TabsTrigger value="improvement">Mejora</TabsTrigger>
              <TabsTrigger value="question">Pregunta</TabsTrigger>
            </TabsList>
            <TabsContent value={type} className="mt-4 space-y-3">
              <input
                type="text"
                placeholder="Título"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
              <Textarea
                placeholder="Descripción detallada..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
                rows={4}
              />
              <Select value={priority} onValueChange={(v) => setPriority(v as FeedbackPriority)}>
                <SelectTrigger>
                  <SelectValue placeholder="Prioridad" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">
                    <Badge variant="outline">Baja</Badge>
                  </SelectItem>
                  <SelectItem value="medium">
                    <Badge variant="secondary">Media</Badge>
                  </SelectItem>
                  <SelectItem value="high">
                    <Badge variant="destructive">Alta</Badge>
                  </SelectItem>
                  <SelectItem value="critical">
                    <Badge className="bg-red-700 text-white">Crítica</Badge>
                  </SelectItem>
                </SelectContent>
              </Select>
            </TabsContent>
          </Tabs>
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "Enviando..." : "Enviar"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function FeedbackWizardList({
  items,
}: {
  items: Array<{
    id: string
    title: string
    type: string
    status: string
    priority: string
    createdAt: string
  }>
}) {
  return (
    <ScrollArea className="h-[400px] pr-4">
      <div className="space-y-2">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center justify-between rounded-lg border p-3 text-sm"
          >
            <span className="font-medium">{item.title}</span>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{item.type}</Badge>
              <Badge variant="secondary">{item.status}</Badge>
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  )
}
`

export const ShadcnAdapter: UIAdapterPlugin = {
  meta: {
    id: "ui:shadcn",
    name: "shadcn/ui",
    description: "Adapter for shadcn/ui — generates Radix-based widget components",
    contractVersion: PLUGIN_CONTRACT_VERSION,
    kind: "ui",
  },

  async detect(files: ProjectFiles): Promise<DetectionResult<DetectedUI>> {
    const evidence: string[] = []
    let confidence = 0

    const hasShadcnComponents = files.filePaths.some(
      (p) => p.includes("components/ui/button") || p.includes("components/ui/dialog"),
    )
    if (hasShadcnComponents) {
      evidence.push("Found shadcn/ui component files in components/ui/")
      confidence += 60
    }

    const pkg = files.packageJson as Record<string, Record<string, string>>
    const deps = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    }
    if ("@radix-ui/react-dialog" in deps) {
      evidence.push("Found @radix-ui/react-dialog — shadcn/ui dependency")
      confidence += 30
    }

    const componentPath = files.filePaths
      .filter((p) => p.includes("components/ui/"))
      .map((p) => {
        const idx = p.indexOf("components/ui/")
        return p.slice(0, idx + "components/ui/".length)
      })[0] ?? "src/components/ui"

    return {
      data: {
        provider: "shadcn",
        confidence,
        componentPath,
      },
      confidence,
      evidence,
      category: "ui",
    }
  },

  async generateWidgetComponent(analysis: ProjectAnalysis): Promise<GeneratedFile[]> {
    const basePath = analysis.hasSrcDir ? "src/components/fw" : "components/fw"
    return [
      {
        path: `${basePath}/feedback-widget.tsx`,
        content: WIDGET_COMPONENT_CONTENT,
        overwritePolicy: "always",
      },
    ]
  },

  async generateProviderFiles(_analysis: ProjectAnalysis): Promise<GeneratedFile[]> {
    return []
  },
}

// ---------------------------------------------------------------------------
// Component availability helpers
// ---------------------------------------------------------------------------

export function getMissingShadcnComponents(projectRoot: string): ShadcnComponent[] {
  const uiDir = existsSync(join(projectRoot, "src", "components", "ui"))
    ? join(projectRoot, "src", "components", "ui")
    : join(projectRoot, "components", "ui")

  return REQUIRED_SHADCN_COMPONENTS.filter((component) => {
    const tsPath = join(uiDir, `${component}.tsx`)
    const jsPath = join(uiDir, `${component}.jsx`)
    return !existsSync(tsPath) && !existsSync(jsPath)
  })
}

export function getShadcnInstallCommand(missing: ShadcnComponent[]): string {
  if (missing.length === 0) return ""
  return `npx shadcn@latest add ${missing.join(" ")}`
}
