/**
 * Atomic JSON file write, shared by the on-disk input stores.
 *
 * The USCG Light List, USCG Local Notice to Mariners, and NOAA CO-OPS stores
 * all persist their index by the same crash-safe recipe, so it lives here once
 * rather than as three byte-identical copies.
 */

import { rename, rm, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'

/**
 * Atomically write JSON to `filePath` by writing a sibling temp file and
 * renaming it over the target. The temp filename carries the process id and a
 * per-call random nonce so two concurrent writers to the same target (a
 * stop+start race during an in-flight refresh) do not collide on a shared temp
 * path. A failed rename unlinks the temp file so no debris is left behind.
 */
export async function atomicWriteJson (filePath: string, value: unknown): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  await writeFile(tempPath, JSON.stringify(value), 'utf8')
  try {
    await rename(tempPath, filePath)
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {})
    throw error
  }
}
