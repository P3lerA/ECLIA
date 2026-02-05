export type SSEWrite = (event: string, data: unknown) => void;

export function createSSE(res: import("node:http").ServerResponse): {
  write: SSEWrite;
  comment: (text: string) => void;
  close: () => void;
} {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  // Some proxies require a first write to flush headers.
  res.flushHeaders?.();

  const write: SSEWrite = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const comment = (text: string) => {
    res.write(`: ${text.replace(/\n/g, " ")}\n\n`);
  };

  const close = () => {
    try {
      res.end();
    } catch {
      // ignore
    }
  };

  return { write, comment, close };
}
