import inquirer from "inquirer"
import type { DetectionResult } from "../analyzer/types.js"
import { logger } from "./logger.js"

export const CONFIDENCE_THRESHOLD = 0.75

export type FallbackQuestion<T> = {
  message: string
  choices?: Array<{ name: string; value: T }>
  default?: T
}

/**
 * Resolves a detected value or falls back to an interactive prompt.
 *
 * If `result.confidence >= CONFIDENCE_THRESHOLD`, returns the detected value
 * directly and logs the detection as confirmed.
 *
 * If `result.confidence < CONFIDENCE_THRESHOLD`, warns the user with the
 * evidence found and launches an inquirer prompt with the detected value
 * pre-selected as the default so the user can confirm or correct it.
 */
export async function resolveWithFallback<T>(
  result: DetectionResult<T>,
  category: string,
  fallback: FallbackQuestion<T>
): Promise<T> {
  if (result.confidence >= CONFIDENCE_THRESHOLD) {
    logger.success(
      `${category}: auto-detected (confidence ${Math.round(result.confidence * 100)}%)`
    )
    return result.data
  }

  // Low confidence — warn and prompt
  logger.warn(
    `${category}: low confidence (${Math.round(result.confidence * 100)}%). Evidence found:`
  )
  for (const evidence of result.evidence) {
    process.stdout.write(`       • ${evidence}\n`)
  }

  if (fallback.choices !== undefined && fallback.choices.length > 0) {
    const answer = await inquirer.prompt<{ value: T }>([
      {
        type: "list",
        name: "value",
        message: fallback.message,
        choices: fallback.choices,
        default: fallback.default ?? result.data,
      },
    ])
    return answer.value
  }

  // NOTE: free-form input is only valid when T extends string.
  // For complex types (DetectedAuth, DetectedORM, etc.) always provide choices[].
  if (!fallback.choices || fallback.choices.length === 0) {
    throw new Error(
      `resolveWithFallback: choices are required for non-string type "${category}". ` +
        `Free-form input is not safe for complex types.`
    )
  }

  const answer = await inquirer.prompt<{ value: string }>([
    {
      type: "input",
      name: "value",
      message: fallback.message,
      default: String(fallback.default ?? result.data ?? ""),
    },
  ])

  return answer.value as T
}
