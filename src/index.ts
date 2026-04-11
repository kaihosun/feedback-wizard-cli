// Public API surface of @feedback-wizard/cli
// Other packages that depend on this package import from here.

export { logger } from "./utils/logger.js"
export { readFileSafe, readJsonSafe, fileExists, ensureDir, readDirRecursive, copyTemplate } from "./utils/fs.js"
export { resolveWithFallback, CONFIDENCE_THRESHOLD } from "./utils/confidence.js"
export type { FallbackQuestion } from "./utils/confidence.js"
export { BackupManager } from "./installer/rollback.js"

export type {
  DetectionConfidence,
  DetectedAuth,
  DetectedORM,
  DetectedStorage,
  DetectedUI,
  DetectedModule,
  DetectedLayout,
  DetectedRoles,
  RouterType,
  ProjectAnalysis,
  DetectionResult,
  ProjectFiles,
  GeneratedFile,
} from "./analyzer/types.js"

export type {
  PluginMeta,
  AuthAdapterPlugin,
  ORMAdapterPlugin,
  StorageAdapterPlugin,
  UIAdapterPlugin,
  FeedbackWizardPlugin,
  PluginFactory,
  RegisteredPlugin,
  PluginContractVersion,
} from "./types/plugin.js"

export { isPluginFactory, PLUGIN_CONTRACT_VERSION } from "./types/plugin.js"
