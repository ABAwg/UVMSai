export type SseFrame = {
  event: string;
  data: unknown;
};

export function parseSseBuffer(buffer: string): { frames: SseFrame[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const blocks = normalized.split('\n\n');
  const rest = blocks.pop() ?? '';
  const frames: SseFrame[] = [];

  for (const block of blocks) {
    if (!block.trim()) continue;
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of block.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      if (line.startsWith('event:')) {
        event = line.slice(6).trim() || 'message';
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
    if (!dataLines.length) continue;
    const raw = dataLines.join('\n');
    let data: unknown = raw;
    try {
      data = JSON.parse(raw);
    } catch {
      // Plain text SSE payloads are still valid; leave the raw value intact.
    }
    frames.push({ event, data });
  }

  return { frames, rest };
}

export async function consumeSse(
  response: Response,
  onFrame: (frame: SseFrame) => void | Promise<void>,
): Promise<void> {
  const body = response.body;
  if (!body || typeof body.getReader !== 'function') {
    throw new Error('Streaming is not supported by this runtime. Update Expo Go or use a development build.');
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parsed = parseSseBuffer(buffer);
      buffer = parsed.rest;
      for (const frame of parsed.frames) await onFrame(frame);
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      const parsed = parseSseBuffer(`${buffer}\n\n`);
      for (const frame of parsed.frames) await onFrame(frame);
    }
  } finally {
    try { await reader.cancel(); } catch { /* already closed */ }
    try { reader.releaseLock(); } catch { /* no-op */ }
  }
}
