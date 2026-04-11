/**
 * Central registry of all template placeholders.
 * Each placeholder maps to the method/adapter that provides its value.
 */
export const PLACEHOLDERS = {
  // Auth
  AUTH_IMPORTS_BLOCK: "{{AUTH_IMPORTS_BLOCK}}",
  AUTH_GET_USER_BLOCK: "{{AUTH_GET_USER_BLOCK}}",
  AUTH_GET_CURRENT_USER_ID_BLOCK: "{{AUTH_GET_CURRENT_USER_ID_BLOCK}}",

  // ORM
  ORM_IMPORTS_BLOCK: "{{ORM_IMPORTS_BLOCK}}",
  ORM_CLIENT_INIT_BLOCK: "{{ORM_CLIENT_INIT_BLOCK}}",
  ORM_CLIENT_ENUMS_IMPORT: "{{ORM_CLIENT_ENUMS_IMPORT}}",
  ORM_TYPE_IMPORTS_BLOCK: "{{ORM_TYPE_IMPORTS_BLOCK}}",

  // Storage
  STORAGE_UPLOAD_BLOCK: "{{STORAGE_UPLOAD_BLOCK}}",
  STORAGE_GET_URL_BLOCK: "{{STORAGE_GET_URL_BLOCK}}",
  STORAGE_BUCKET_NAME: "{{STORAGE_BUCKET_NAME}}",

  // Project
  DETECTED_MODULES: "{{DETECTED_MODULES}}",
  APP_DASHBOARD_PATH: "{{APP_DASHBOARD_PATH}}",
  PROJECT_NAME: "{{PROJECT_NAME}}",

  // Schema / DB
  TABLE_PREFIX: "{{TABLE_PREFIX}}",
  DB_TABLE_PREFIX: "{{DB_TABLE_PREFIX}}",
  USER_MODEL: "{{USER_MODEL}}",
  USER_ID_FIELD: "{{USER_ID_FIELD}}",

  // Roles
  // DetectedRoles only exposes adminValue and viewerValue — there is no editorValue.
  // ROLE_VIEWER_VALUE is used in Server Actions to deny write access to viewers.
  ROLE_ADMIN_VALUE: "{{ROLE_ADMIN_VALUE}}",
  ROLE_VIEWER_VALUE: "{{ROLE_VIEWER_VALUE}}",
} as const

export type PlaceholderKey = keyof typeof PLACEHOLDERS
export type PlaceholderValue = (typeof PLACEHOLDERS)[PlaceholderKey]
