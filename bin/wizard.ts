#!/usr/bin/env node
import { Command } from "commander"
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import { logger } from "../src/utils/logger.js"
import { initCommand } from "../src/commands/init.js"
import { updateCommand } from "../src/commands/update.js"
import { uninstallCommand } from "../src/commands/uninstall.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(
  readFileSync(join(__dirname, "../package.json"), "utf-8")
) as { version: string }

const program = new Command()

program
  .name("feedback-wizard")
  .description("Install a feedback wizard in your Next.js project")
  .version(pkg.version)

program
  .command("init")
  .description("Install feedback-wizard in the current Next.js project")
  .option("--yes", "Skip all confirmations")
  .option("--dry-run", "Preview changes without writing files")
  .action(async (options: { yes?: boolean; dryRun?: boolean }) => {
    try {
      await initCommand({ yes: options.yes, dryRun: options.dryRun })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error(`init failed: ${message}`)
      process.exit(1)
    }
  })

program
  .command("update")
  .description("Update feedback-wizard templates to the latest version")
  .action(async () => {
    try {
      await updateCommand()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error(`update failed: ${message}`)
      process.exit(1)
    }
  })

program
  .command("uninstall")
  .description("Remove feedback-wizard from the current project")
  .action(async () => {
    try {
      await uninstallCommand()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error(`uninstall failed: ${message}`)
      process.exit(1)
    }
  })

program.parse()
