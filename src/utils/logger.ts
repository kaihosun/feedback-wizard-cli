import chalk from "chalk"
import ora, { type Ora } from "ora"

export interface SpinnerHandle {
  succeed: (msg?: string) => void
  fail: (msg?: string) => void
  update: (msg: string) => void
  stop: () => void
}

function info(msg: string): void {
  process.stdout.write(chalk.blue(`  ${msg}\n`))
}

function success(msg: string): void {
  process.stdout.write(chalk.green(`  ✓ ${msg}\n`))
}

function warn(msg: string): void {
  process.stdout.write(chalk.yellow(`  ⚠ ${msg}\n`))
}

function error(msg: string): void {
  process.stderr.write(chalk.red(`  ✗ ${msg}\n`))
}

function step(n: number, total: number, msg: string): void {
  const counter = chalk.gray(`[ ${String(n).padStart(String(total).length)}/${total} ]`)
  process.stdout.write(`  ${counter} ${chalk.gray(msg)}\n`)
}

function spinner(msg: string): SpinnerHandle {
  const s: Ora = ora({
    text: msg,
    color: "cyan",
    indent: 2,
  }).start()

  return {
    succeed: (successMsg?: string) => {
      s.succeed(successMsg !== undefined ? chalk.green(successMsg) : undefined)
    },
    fail: (failMsg?: string) => {
      s.fail(failMsg !== undefined ? chalk.red(failMsg) : undefined)
    },
    update: (updateMsg: string) => {
      s.text = updateMsg
    },
    stop: () => {
      s.stop()
    },
  }
}

function section(title: string): void {
  const line = "─".repeat(Math.max(0, 50 - title.length - 2))
  process.stdout.write(`\n  ${chalk.bold(title)} ${chalk.gray(line)}\n\n`)
}

function code(snippet: string): void {
  const lines = snippet.split("\n")
  const padding = "  "
  process.stdout.write("\n")
  for (const line of lines) {
    process.stdout.write(chalk.bgGray.white(`${padding}${line}\n`))
  }
  process.stdout.write("\n")
}

export const logger = {
  info,
  success,
  warn,
  error,
  step,
  spinner,
  section,
  code,
}
