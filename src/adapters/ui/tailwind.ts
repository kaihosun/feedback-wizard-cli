import type { UIAdapterPlugin } from "../../types/plugin.js"
import type {
  DetectedUI,
  DetectionResult,
  GeneratedFile,
  ProjectAnalysis,
  ProjectFiles,
} from "../../analyzer/types.js"
import { PLUGIN_CONTRACT_VERSION } from "../../types/plugin.js"

const TAILWIND_WIDGET_CONTENT = `"use client"

import { useState } from "react"

type FeedbackType = "bug" | "feature" | "improvement" | "question"
type FeedbackPriority = "low" | "medium" | "high" | "critical"

const TYPE_LABELS: Record<FeedbackType, string> = {
  bug: "Bug",
  feature: "Feature",
  improvement: "Mejora",
  question: "Pregunta",
}

const PRIORITY_LABELS: Record<FeedbackPriority, string> = {
  low: "Baja",
  medium: "Media",
  high: "Alta",
  critical: "Crítica",
}

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
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
      >
        Reportar
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Enviar comentario</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="flex gap-1 rounded-md border p-1">
                {(Object.keys(TYPE_LABELS) as FeedbackType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setType(t)}
                    className={\`flex-1 rounded py-1 text-sm \${
                      type === t
                        ? "bg-gray-900 text-white"
                        : "text-gray-600 hover:bg-gray-100"
                    }\`}
                  >
                    {TYPE_LABELS[t]}
                  </button>
                ))}
              </div>

              <input
                type="text"
                placeholder="Título"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
              />

              <textarea
                placeholder="Descripción detallada..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
                rows={4}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
              />

              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as FeedbackPriority)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
              >
                {(Object.keys(PRIORITY_LABELS) as FeedbackPriority[]).map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABELS[p]}
                  </option>
                ))}
              </select>

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
              >
                {submitting ? "Enviando..." : "Enviar"}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
`

export const TailwindAdapter: UIAdapterPlugin = {
  meta: {
    id: "ui:tailwind",
    name: "Tailwind CSS",
    description: "Adapter for plain Tailwind CSS — no component library required",
    contractVersion: PLUGIN_CONTRACT_VERSION,
    kind: "ui",
  },

  async detect(files: ProjectFiles): Promise<DetectionResult<DetectedUI>> {
    const evidence: string[] = []
    let confidence = 0

    const hasTailwindConfig = files.filePaths.some(
      (p) =>
        p.endsWith("tailwind.config.ts") ||
        p.endsWith("tailwind.config.js") ||
        p.endsWith("tailwind.config.mjs"),
    )
    if (hasTailwindConfig) {
      evidence.push("Found tailwind.config file")
      confidence += 70
    }

    const pkg = files.packageJson as Record<string, Record<string, string>>
    const deps = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    }
    if ("tailwindcss" in deps) {
      evidence.push("Found tailwindcss in dependencies")
      confidence += 30
    }

    return {
      data: {
        provider: "tailwind-only",
        confidence,
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
        content: TAILWIND_WIDGET_CONTENT,
        overwritePolicy: "always",
      },
    ]
  },

  async generateProviderFiles(_analysis: ProjectAnalysis): Promise<GeneratedFile[]> {
    return []
  },
}
