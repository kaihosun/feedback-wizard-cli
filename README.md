# @feedback-wizard/cli

> Instala un widget flotante de feedback y reporte de bugs en cualquier proyecto Next.js — sin intervención humana.
>
> Install a floating feedback & bug-reporting widget in any Next.js project — zero human intervention.

```bash
npx @feedback-wizard/cli init
```

```
        *   ·   *   ·   *
      ·   *   ·   *   ·
            _____
        *  /·   ·\  *
          / /\   /\ \
         / /  \ /  \ \
        /_/ *  V  * \_\
        |   (o) (o)  |
        |    \___/   |
        |  ~~~~~~~~~  |
         \___________/
              | |
             /| |\
```

---

## ¿Qué hace? / What does it do?

Analiza tu proyecto Next.js y genera un sistema completo de feedback adaptado a tu stack: widget flotante, modal de reporte, Server Actions, schema de base de datos y storage — todo conectado a tu auth, ORM y storage existentes.

It analyzes your Next.js project and generates a complete feedback system adapted to your stack: floating widget, report modal, Server Actions, database schema, and storage — all wired to your existing auth, ORM, and storage.

---

## Instalación

```bash
# Dentro del directorio de tu proyecto Next.js:
ANTHROPIC_API_KEY=sk-ant-... npx @feedback-wizard/cli init

# Dentro de Claude Code — sin API key:
npx @feedback-wizard/cli init
```

---

## Detección automática de stack

Detecta y adapta el código generado a tu configuración:

| Dimensión | Soportado |
|---|---|
| **Auth** | Supabase · NextAuth v4/v5 · Clerk · Firebase (custom-claims / firestore-roles) |
| **Base de datos** | Prisma · Drizzle · PostgreSQL raw (`pg` / `postgres` / `@vercel/postgres`) |
| **Storage** | Supabase Storage · AWS S3 · Firebase Storage · Local |
| **UI** | shadcn/ui (auto-instala componentes faltantes) · Tailwind CSS puro |

---

## Comandos

| Comando | Descripción |
|---|---|
| `npx @feedback-wizard/cli init` | Instala el sistema en el proyecto actual |
| `npx @feedback-wizard/cli update` | Re-sincroniza templates preservando tu configuración |
| `npx @feedback-wizard/cli uninstall` | Elimina todos los archivos generados |

---

## Flags

| Flag | Descripción |
|---|---|
| `--yes` / `-y` | Salta todas las confirmaciones |
| `--dry-run` | Muestra qué se instalaría sin escribir nada |

---

## Detección de entorno

| Entorno | Comportamiento |
|---|---|
| Dentro de **Claude Code** | IA nativa, sin API key |
| `ANTHROPIC_API_KEY` presente | Claude API para análisis del proyecto |
| Sin clave | Preguntas interactivas para ambigüedades |

---

## Cómo funciona internamente

```
Paso 0: Valida entorno (Next.js, git status)
Paso 1: Análisis AI en paralelo — 6 dimensiones (auth, orm, storage, ui, routes, roles)
Paso 2: Fallback interactivo si confidence < 0.75
Paso 3: Genera archivos desde templates con placeholder substitution
Paso 4: Modifica schema Prisma o genera SQL (tablas fw_ sin conflictos)
Paso 5: Inyecta providers y widget en el layout (ts-morph AST)
Paso 6: Instala dependencias faltantes (detecta npm/pnpm/yarn/bun)
Paso 7: TypeScript check → rollback automático si falla
Paso 8: Ejecuta prisma migrate dev o apply.sh
```

---

## Archivos generados

```
src/
├── components/features/improvements/
│   ├── ImprovementModal.tsx
│   ├── ImprovementWidget.tsx
│   └── ImprovementModalProvider.tsx
├── actions/improvements.ts
└── types/improvements.ts
```

Schema de base de datos con prefijo `fw_` para evitar colisiones con tus tablas existentes.

---

## Sistema de Plugins

Extiende con adaptadores de la comunidad:

```bash
npm install @feedback-wizard/auth0-adapter
```

```typescript
// wizard.config.ts
import { defineConfig } from "@feedback-wizard/cli"
import auth0 from "@feedback-wizard/auth0-adapter"

export default defineConfig({
  plugins: [auth0()],
})
```

### Interfaz mínima para crear un plugin

```typescript
interface AuthAdapterPlugin {
  id: string
  contractVersion: "1.0"
  detect(files: ProjectFiles): Promise<DetectionResult>
  getUserIdBlock(): string
  getUserRoleBlock(): string
  getImportsBlock(): string
  getEnvVarsRequired(): string[]
}
```

Discovery automático: paquetes `@feedback-wizard/*` en `node_modules`, o declarados en `package.json` bajo `feedbackWizard.plugins`.

---

## Requisitos

- Node.js >= 18
- Next.js 13+ (App Router recomendado)

---

## Rollback

Si cualquier paso falla (incluyendo el TypeScript check final), todos los archivos modificados son restaurados y las migraciones no se ejecutan. Nunca quedas con el proyecto en estado inconsistente.

---

## Repositorio

**GitHub:** [github.com/kaihosun/feedback-wizard-cli](https://github.com/kaihosun/feedback-wizard-cli)

¿Te fue útil? Dale una ⭐ en GitHub.

---

## Licencia

MIT © [kaihosun](https://github.com/kaihosun)
