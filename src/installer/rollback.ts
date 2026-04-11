import path from "path"
import { promises as fsPromises } from "fs"
import fsExtra from "fs-extra"
import { fileExists, ensureDir } from "../utils/fs.js"
import { logger } from "../utils/logger.js"

const BACKUP_DIR_NAME = ".wizard-backup"

/**
 * Manages file backups so the installer can roll back all changes if anything
 * goes wrong mid-installation.
 *
 * Workflow:
 *  1. Before overwriting a file: call `save(filePath)`
 *  2. After creating a new file that did not previously exist: call `saveNew(filePath)`
 *  3. On error: call `rollbackAll()` to restore the original state
 *  4. On success: call `commit()` to remove the backup directory
 */
export class BackupManager {
  private readonly backupRoot: string
  /** Original files that were backed up (absolute paths in the project). */
  private readonly savedPaths: string[] = []
  /** New files created by the installer (absolute paths in the project). */
  private readonly newFilePaths: string[] = []

  constructor(private readonly projectRoot: string) {
    this.backupRoot = path.join(projectRoot, BACKUP_DIR_NAME)
  }

  /**
   * Copies an existing file to the backup directory, preserving its path
   * relative to the project root. If the file has already been backed up,
   * this is a no-op (first write wins).
   */
  async save(filePath: string): Promise<void> {
    const absolute = path.resolve(this.projectRoot, filePath)

    if (!(await fileExists(absolute))) {
      // Nothing to back up — the file does not exist yet.
      return
    }

    if (this.savedPaths.includes(absolute)) {
      // Already backed up during this session.
      return
    }

    const relative = path.relative(this.projectRoot, absolute)
    const backupDest = path.join(this.backupRoot, relative)

    await ensureDir(path.dirname(backupDest))
    await fsExtra.copy(absolute, backupDest, { overwrite: false })

    this.savedPaths.push(absolute)
  }

  /**
   * Registers a newly created file so it can be removed during rollback.
   * Call this after writing a file that did not previously exist.
   */
  async saveNew(filePath: string): Promise<void> {
    const absolute = path.resolve(this.projectRoot, filePath)
    if (!this.newFilePaths.includes(absolute)) {
      this.newFilePaths.push(absolute)
    }
  }

  /**
   * Restores all backed-up files to their original locations and deletes any
   * files that were newly created by the installer.
   */
  async rollbackAll(): Promise<void> {
    logger.warn("Rolling back all changes…")

    // Restore backed-up files
    for (const originalPath of this.savedPaths) {
      const relative = path.relative(this.projectRoot, originalPath)
      const backupSource = path.join(this.backupRoot, relative)

      if (await fileExists(backupSource)) {
        await ensureDir(path.dirname(originalPath))
        await fsExtra.copy(backupSource, originalPath, { overwrite: true })
        logger.info(`  Restored: ${relative}`)
      }
    }

    // Remove newly created files
    for (const newFile of this.newFilePaths) {
      if (await fileExists(newFile)) {
        await fsPromises.unlink(newFile)
        const relative = path.relative(this.projectRoot, newFile)
        logger.info(`  Removed:  ${relative}`)
      }
    }

    // Clean up the backup directory itself
    await this._cleanBackupDir()

    logger.success("Rollback complete. Your project is unchanged.")
  }

  /**
   * Removes the `.wizard-backup/` directory after a successful installation.
   */
  async commit(): Promise<void> {
    await this._cleanBackupDir()
    logger.success("Installation committed. Backup directory removed.")
  }

  /**
   * Returns the absolute paths of all files that have been backed up.
   */
  getSavedPaths(): string[] {
    return [...this.savedPaths]
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async _cleanBackupDir(): Promise<void> {
    if (await fileExists(this.backupRoot)) {
      await fsExtra.remove(this.backupRoot)
    }
  }
}
