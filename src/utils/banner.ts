import chalk from "chalk"

// ─── Arte del wizard ──────────────────────────────────────────────────────────

const WIZARD = `
        *   ·   *   ·   *
      ·   *   ·   *   ·
            _____
        *  /·   ·\\  *
          / /\\   /\\ \\
         / /  \\ /  \\ \\
        /_/ *  V  * \\_\\
        |   (o) (o)  |
        |    \\___/   |
        |  ~~~~~~~~~  |
         \\___________/
              | |
             /| |\\
`

const WIZARD_DONE = `
      /^\\     /^\\
    < ( ·   · ) >
      (  ~w~  )
       \`-----´
`

// ─── Colores temáticos ────────────────────────────────────────────────────────

const star  = chalk.yellow("✦")
const dim   = chalk.dim
const bold  = chalk.bold
const cyan  = chalk.cyan
const green = chalk.green
const gray  = chalk.gray

// ─── Banner de inicio ─────────────────────────────────────────────────────────

export function printStartBanner(version: string): void {
  // Colorear el ASCII art línea por línea
  const wizardLines = WIZARD.split("\n").map((line) => {
    // estrellas y puntos → amarillo
    let colored = line
      .replace(/\*/g, chalk.yellow("*"))
      .replace(/·/g, chalk.yellow("·"))
    // ojos → cyan brillante
    colored = colored.replace(/\(o\)/g, chalk.cyanBright("(o)"))
    // boca → magenta
    colored = colored.replace(/\\___\//g, chalk.magenta("\\___/"))
    // ondas del cuerpo → azul
    colored = colored.replace(/~~~~~~~~~/g, chalk.blue("~~~~~~~~~"))
    // sombrero (líneas que tienen / \ V) → indigo/blue
    if (line.includes("/\\") || line.includes("V") || line.includes("_____")) {
      colored = chalk.hex("#818cf8")(colored)
    }
    return gray("  ") + colored
  })

  console.log()
  console.log(wizardLines.join("\n"))
  console.log()
  console.log(
    "  " +
    star + "  " +
    bold(chalk.hex("#818cf8")("feedback-wizard")) +
    "  " +
    dim(`v${version}`) +
    "  " +
    star
  )
  console.log(
    "  " +
    dim("Instala el wizard de feedback en tu app Next.js")
  )
  console.log(
    "  " +
    dim("Install the feedback wizard in your Next.js app")
  )
  console.log()
  console.log(
    "  " +
    dim("by ") +
    chalk.hex("#818cf8")("github.com/kaihosun")
  )
  console.log()
}

// ─── Banner de éxito ──────────────────────────────────────────────────────────

export function printSuccessBanner(): void {
  const doneLines = WIZARD_DONE.split("\n").map((line) => {
    let colored = line
      .replace(/·/g, chalk.cyanBright("·"))
      .replace(/~w~/g, chalk.magenta("~w~"))
      .replace(/\^/g, chalk.hex("#818cf8")("^"))
    return "  " + colored
  })

  console.log()
  console.log(
    "  " +
    green("─".repeat(46))
  )
  console.log(
    "  " +
    green("✓") + "  " +
    bold(green("¡Wizard instalado exitosamente!"))
  )
  console.log(
    "  " +
    green("─".repeat(46))
  )
  console.log(doneLines.join("\n"))
  console.log(
    "  " + dim("Busca el ícono flotante ") +
    chalk.hex("#818cf8")("◉") +
    dim(" en la esquina de tu app.")
  )
  console.log()
  console.log(
    "  " + dim("¿Te sirvió? Dale una ⭐ en GitHub:")
  )
  console.log(
    "  " + chalk.hex("#818cf8")("github.com/kaihosun/feedback-wizard-cli")
  )
  console.log()
}

// ─── Banner de error ──────────────────────────────────────────────────────────

export function printErrorBanner(message: string): void {
  console.log()
  console.log(
    "  " + chalk.red("✗") + "  " + chalk.bold(chalk.red("Instalación cancelada"))
  )
  console.log(
    "  " + chalk.dim(message)
  )
  console.log(
    "  " + chalk.dim("Todos los cambios fueron revertidos.")
  )
  console.log(
    "  " + chalk.dim("Reporta el bug en: ") +
    chalk.hex("#818cf8")("github.com/kaihosun/feedback-wizard-cli/issues")
  )
  console.log()
}
