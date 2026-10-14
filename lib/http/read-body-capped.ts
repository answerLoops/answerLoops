/**
 * Reads a request body while counting actual bytes, aborting as soon as the
 * cap is crossed. Do not simplify this to `req.text()` plus a length check:
 * that buffers the whole body before the check can run, and a string `.length`
 * counts UTF-16 code units rather than bytes, so the cap would not hold.
 * Returns null when the cap is exceeded.
 *
 * Shared by every public, pre-auth POST endpoint (MCP, Agent API, widget) so
 * the limit stays identical across them.
 *
 * Takes anything with a body — NextRequest and plain Request both qualify.
 */
export async function readBodyCapped(req: { body: ReadableStream<Uint8Array> | null }, maxBytes: number): Promise<string | null> {
  const bytes = await readBodyBytesCapped(req, maxBytes)
  return bytes === null ? null : bytes.toString('utf8')
}

/**
 * Same byte-counting read as readBodyCapped, returning the raw bytes — for
 * bodies that are not UTF-8 text (multipart form data). Returns null when the
 * cap is exceeded.
 */
export async function readBodyBytesCapped(req: { body: ReadableStream<Uint8Array> | null }, maxBytes: number): Promise<Buffer | null> {
  const reader = req.body?.getReader()
  if (!reader) return Buffer.alloc(0)
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}
