import { RagError } from "./policy";
// Bound successful and error bodies; never log provider bodies or credentials.
export async function readAiJson(response: Response): Promise<any> {
  const reader = response.body?.getReader();
  if (!reader) throw new RagError("AI_INVALID_RESPONSE");
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    size += r.value.length;
    if (size > 2 * 1024 * 1024) {
      await reader.cancel();
      throw new RagError("AI_RESPONSE_LIMIT");
    }
    parts.push(r.value);
  }
  try {
    return JSON.parse(Buffer.concat(parts).toString("utf8"));
  } catch {
    throw new RagError("AI_INVALID_RESPONSE");
  }
}
