/**
 * Atomic JSON file write, shared by the on-disk input stores.
 *
 * The USCG Light List, USCG Local Notice to Mariners, and NOAA CO-OPS stores
 * all persist their index by the same crash-safe recipe, so it lives here once
 * rather than as three byte-identical copies.
 */

import { renameSync } from 'node:fs'
import { rm, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'

export interface AtomicWriteJsonOptions {
  /** Rechecked immediately before the atomic rename. */
  shouldCommit?: () => boolean
}

/**
 * Atomically write JSON to `filePath` by writing a sibling temp file and
 * renaming it over the target. The temp filename carries the process id and a
 * per-call random nonce so two concurrent writers to the same target (a
 * stop+start race during an in-flight refresh) do not collide on a shared temp
 * path. A failed write or rename unlinks the temp file so no debris is left
 * behind. Returns false when `shouldCommit` vetoes the rename.
 */
export async function atomicWriteJson (
  filePath: string,
  value: unknown,
  options: AtomicWriteJsonOptions = {}
): Promise<boolean> {
  const tempPath = `${filePath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  try {
    await writeFile(tempPath, JSON.stringify(value), 'utf8')
    if (options.shouldCommit?.() === false) {
      await rm(tempPath, { force: true })
      return false
    }
    // Keep the lifecycle check and commit in one event-loop turn. A close()
    // callback cannot interleave between them and publish a stale run's file.
    renameSync(tempPath, filePath)
    return true
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {})
    throw error
  }
}
