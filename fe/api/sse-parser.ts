export type ParsedSSEFrame = {
  event: string;
  data: string;
  id?: string;
  retry?: number;
};

/** Incremental SSE parser. It never consumes an incomplete frame. */
export class SSEFrameParser {
  private buffer = '';

  push(chunk: string): ParsedSSEFrame[] {
    this.buffer += chunk;
    const frames: ParsedSSEFrame[] = [];

    while (true) {
      const separator = this.buffer.match(/\r?\n\r?\n|\r\r/);
      if (!separator || separator.index === undefined) break;

      const block = this.buffer.slice(0, separator.index);
      this.buffer = this.buffer.slice(separator.index + separator[0].length);
      const frame = this.parseBlock(block);
      if (frame) frames.push(frame);
    }

    return frames;
  }

  reset(): void {
    this.buffer = '';
  }

  private parseBlock(block: string): ParsedSSEFrame | null {
    let event = 'message';
    let id: string | undefined;
    let retry: number | undefined;
    const data: string[] = [];

    for (const line of block.split(/\r?\n|\r/)) {
      if (!line || line.startsWith(':')) continue;
      const colonIndex = line.indexOf(':');
      const field = colonIndex === -1 ? line : line.slice(0, colonIndex);
      let value = colonIndex === -1 ? '' : line.slice(colonIndex + 1);
      if (value.startsWith(' ')) value = value.slice(1);

      if (field === 'event') event = value || 'message';
      else if (field === 'data') data.push(value);
      else if (field === 'id') id = value;
      else if (field === 'retry' && /^\d+$/.test(value)) retry = Number(value);
    }

    if (data.length === 0) return null;
    return { event, data: data.join('\n'), id, retry };
  }
}
