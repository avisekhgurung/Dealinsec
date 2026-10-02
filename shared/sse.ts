/**
 * A small Server-Sent Events parser for `fetch` streams (EventSource can't
 * POST). Feed it text as it arrives; it calls back once per complete event.
 * Tolerates \r\n, comment lines (keep-alives), multi-line data, and an event
 * split across any number of chunks.
 */
export interface SseMessage {
  event: string;
  data: string;
}

export function createSseParser(onMessage: (m: SseMessage) => void) {
  let buffer = "";

  const dispatch = (block: string) => {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (!line || line.startsWith(":")) continue; // blank or comment (keep-alive)
      const i = line.indexOf(":");
      const field = i < 0 ? line : line.slice(0, i);
      const value = i < 0 ? "" : line.slice(i + 1).replace(/^ /, "");
      if (field === "event") event = value;
      else if (field === "data") data.push(value);
    }
    if (data.length) onMessage({ event, data: data.join("\n") });
  };

  return {
    push(chunk: string) {
      buffer += chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      let i: number;
      while ((i = buffer.indexOf("\n\n")) >= 0) {
        dispatch(buffer.slice(0, i));
        buffer = buffer.slice(i + 2);
      }
    },
    /** Call when the stream ends: a final event with no trailing blank line is still delivered. */
    flush() {
      if (buffer.trim()) dispatch(buffer);
      buffer = "";
    },
  };
}
