// Small file helpers shared by the stores.
import { renameSync, writeFileSync } from "node:fs"

/**
 * Write a whole file so that a reader never sees half of it: a temporary file next to it, then a rename (atomic on one
 * file system). A process killed part-way (kill -9, out of memory, a full disk) leaves the old file, not a cut one.
 * Within one process the write is synchronous, so the pid is enough to keep the temporary name to one writer.
 */
export function writeWhole(file: string, text: string): void {
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, text)
  renameSync(tmp, file)
}
