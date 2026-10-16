/**
 * Minimal reader for a zip file's central directory. It reports how many
 * entries the archive declares and their combined compressed and uncompressed
 * sizes, without extracting anything.
 */

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_ENTRY_SIGNATURE = 0x02014b50
const EOCD_MIN_LENGTH = 22
const CENTRAL_ENTRY_FIXED_LENGTH = 46
// The end record is followed by an optional comment of at most 65535 bytes.
const MAX_COMMENT_LENGTH = 0xffff

export type ZipInspection =
  | { ok: true; entries: number; compressedBytes: number; uncompressedBytes: number }
  | { ok: false }

export function inspectZipArchive(buffer: Buffer): ZipInspection {
  if (buffer.length < EOCD_MIN_LENGTH) return { ok: false }

  const earliest = Math.max(0, buffer.length - EOCD_MIN_LENGTH - MAX_COMMENT_LENGTH)
  let eocd = -1
  for (let i = buffer.length - EOCD_MIN_LENGTH; i >= earliest; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i
      break
    }
  }
  if (eocd === -1) return { ok: false }

  const declaredEntries = buffer.readUInt16LE(eocd + 10)
  const directorySize = buffer.readUInt32LE(eocd + 12)
  const directoryOffset = buffer.readUInt32LE(eocd + 16)
  // Sentinel values mean the real numbers live in a zip64 record, which is
  // not read here; such archives are reported as "many entries, huge".
  if (declaredEntries === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    return { ok: true, entries: Number.MAX_SAFE_INTEGER, compressedBytes: 0, uncompressedBytes: Number.MAX_SAFE_INTEGER }
  }
  if (directoryOffset + directorySize > buffer.length) return { ok: false }

  let offset = directoryOffset
  const end = directoryOffset + directorySize
  let entries = 0
  let compressedBytes = 0
  let uncompressedBytes = 0
  while (offset < end) {
    if (offset + CENTRAL_ENTRY_FIXED_LENGTH > end) return { ok: false }
    if (buffer.readUInt32LE(offset) !== CENTRAL_ENTRY_SIGNATURE) return { ok: false }
    compressedBytes += buffer.readUInt32LE(offset + 20)
    uncompressedBytes += buffer.readUInt32LE(offset + 24)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    offset += CENTRAL_ENTRY_FIXED_LENGTH + nameLength + extraLength + commentLength
    entries++
  }
  if (offset !== end || entries !== declaredEntries) return { ok: false }
  return { ok: true, entries, compressedBytes, uncompressedBytes }
}
