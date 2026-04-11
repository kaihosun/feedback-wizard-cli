import { resolve, dirname } from "path"
import { promises as fsPromises } from "fs"
import { Project, SyntaxKind } from "ts-morph"
import type { ProjectAnalysis } from "../analyzer/types.js"
import type { BackupManager } from "../installer/rollback.js"
import { readFileSafe, ensureDir, fileExists } from "../utils/fs.js"
import { logger } from "../utils/logger.js"

const IMPROVEMENT_IMPORTS = [
  `import { ImprovementModalProvider } from "@/components/features/improvements/ImprovementModalProvider"`,
  `import { ImprovementModal } from "@/components/features/improvements/ImprovementModal"`,
  `import { ImprovementWidget } from "@/components/features/improvements/ImprovementWidget"`,
].join("\n")

const ALREADY_INJECTED_MARKER = "ImprovementModalProvider"

// ---------------------------------------------------------------------------
// ts-morph based injection
// ---------------------------------------------------------------------------

/**
 * Attempts to inject the wizard providers into the layout file using ts-morph
 * for AST-level accuracy. Returns the modified source text on success, or
 * `null` if the layout structure cannot be parsed reliably.
 */
function injectWithTsMorph(sourceText: string, filePath: string): string | null {
  try {
    const project = new Project({ useInMemoryFileSystem: true })
    const sourceFile = project.createSourceFile(filePath, sourceText, {
      overwrite: true,
    })

    // Add the three imports at the top of the file, after existing imports
    sourceFile.addImportDeclarations([
      {
        moduleSpecifier:
          "@/components/features/improvements/ImprovementModalProvider",
        namedImports: ["ImprovementModalProvider"],
      },
      {
        moduleSpecifier: "@/components/features/improvements/ImprovementModal",
        namedImports: ["ImprovementModal"],
      },
      {
        moduleSpecifier:
          "@/components/features/improvements/ImprovementWidget",
        namedImports: ["ImprovementWidget"],
      },
    ])

    // Find the default export function / arrow function / class
    const defaultExportSymbol = sourceFile.getDefaultExportSymbol()
    if (!defaultExportSymbol) return null

    const declarations = defaultExportSymbol.getDeclarations()
    if (declarations.length === 0) return null

    const declaration = declarations[0]

    // Walk the declaration looking for the JSX return statement
    let returnStatement: import("ts-morph").ReturnStatement | undefined

    const body =
      "getBody" in declaration
        ? (declaration as { getBody(): import("ts-morph").Node | undefined }).getBody()
        : undefined

    if (body && "getStatements" in body) {
      const stmts = (
        body as { getStatements(): import("ts-morph").Statement[] }
      ).getStatements()
      returnStatement = stmts
        .filter((s): s is import("ts-morph").ReturnStatement => s.getKind() === SyntaxKind.ReturnStatement)
        .at(-1)
    }

    if (!returnStatement) return null

    const returnExpression = returnStatement.getExpression()
    if (!returnExpression) return null

    const innerJsx = returnExpression.getText()

    // Wrap the existing JSX
    const wrappedJsx = [
      `<ImprovementModalProvider>`,
      `      ${innerJsx}`,
      `      <ImprovementModal />`,
      `      <ImprovementWidget />`,
      `    </ImprovementModalProvider>`,
    ].join("\n    ")

    returnExpression.replaceWithText(wrappedJsx)

    return sourceFile.getFullText()
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// String-replacement fallback
// ---------------------------------------------------------------------------

/**
 * Naive string-replacement fallback used when ts-morph cannot parse the layout.
 * Finds the outermost `return (` or `return <` and wraps its contents.
 */
function injectWithStringReplacement(sourceText: string): string {
  // Insert the imports right before the first `export` keyword
  const importsInserted = sourceText.replace(
    /^(export\s)/m,
    `${IMPROVEMENT_IMPORTS}\n\n$1`,
  )

  // Match `return (\n  <SomeJsx...>\n)` or `return <SomeJsx.../>`
  // Strategy: find `return (` and the matching closing `)` — or `return <...>`
  const returnParenPattern = /(\breturn\s*\()([\s\S]*?)(\n\s*\))/

  if (returnParenPattern.test(importsInserted)) {
    return importsInserted.replace(
      returnParenPattern,
      (_, openReturn: string, inner: string, closeReturn: string) => {
        const indented = inner
          .split("\n")
          .map((line) => `  ${line}`)
          .join("\n")
        return [
          `${openReturn}`,
          `    <ImprovementModalProvider>`,
          `  ${inner.trimStart()}`,
          `      <ImprovementModal />`,
          `      <ImprovementWidget />`,
          `    </ImprovementModalProvider>`,
          `${closeReturn}`,
        ].join("\n")
      },
    )
  }

  // Fallback for `return <SingleLineJsx />`
  const returnSingleLinePattern = /(\breturn\s+)(<[^;]+>)/
  if (returnSingleLinePattern.test(importsInserted)) {
    return importsInserted.replace(
      returnSingleLinePattern,
      (_match: string, ret: string, jsx: string) =>
        `${ret}(\n    <ImprovementModalProvider>\n      ${jsx}\n      <ImprovementModal />\n      <ImprovementWidget />\n    </ImprovementModalProvider>\n  )`,
    )
  }

  // If nothing matched, append a comment so the developer knows what to do
  return (
    importsInserted +
    `\n\n// feedback-wizard: could not auto-inject providers.\n` +
    `// Manually wrap your layout's root JSX with <ImprovementModalProvider>.\n`
  )
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function injectIntoLayout(
  analysis: ProjectAnalysis,
  backup: BackupManager,
): Promise<{ modified: boolean; layoutPath: string }> {
  const layoutRelative = analysis.layout.filePath
  const layoutAbsolute = resolve(analysis.projectRoot, layoutRelative)

  if (!(await fileExists(layoutAbsolute))) {
    logger.warn(`Layout file not found at ${layoutRelative} — skipping injection.`)
    return { modified: false, layoutPath: layoutRelative }
  }

  const sourceText = await readFileSafe(layoutAbsolute)
  if (sourceText === null) {
    logger.warn(`Could not read layout at ${layoutRelative} — skipping injection.`)
    return { modified: false, layoutPath: layoutRelative }
  }

  // Idempotency check
  if (sourceText.includes(ALREADY_INJECTED_MARKER)) {
    return { modified: false, layoutPath: layoutRelative }
  }

  // Backup original
  await backup.save(layoutRelative)

  // Try ts-morph first, fall back to string replacement
  let modifiedText = injectWithTsMorph(sourceText, layoutAbsolute)

  if (modifiedText === null) {
    logger.warn(
      `ts-morph could not parse ${layoutRelative} — using string-replacement fallback.`,
    )
    modifiedText = injectWithStringReplacement(sourceText)
  }

  await ensureDir(dirname(layoutAbsolute))
  await fsPromises.writeFile(layoutAbsolute, modifiedText, "utf-8")

  return { modified: true, layoutPath: layoutRelative }
}
