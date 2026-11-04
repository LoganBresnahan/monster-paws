/**
 * The raw bytes, or null past the limit: a missing or false content-length must not get a whole body
 * into memory on a public path. Bytes, never `request.text()`, which strips a BOM a signature covers.
 */
export async function readBoundedBody(request: Request, maxBytes: number): Promise<Buffer | null> {
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes) return null;
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  const reader = request.body?.getReader();
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
