/**
 * 极简 SSE 解析器：
 * - 按 \n\n 分割 event block
 * - 识别 event: / data:
 * - data 可以多行，按 \n join
 *
 * 注意：这是“够用的版本”，真实生产里可以更严格地处理：
 * - retry/id/comment 行
 * - \r\n 兼容
 */
export function parseSSE(input: string): {
  events: Array<{ event: string | null; data: string }>;
  rest: string;
} {
  const normalized = input.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n\n");

  // 最后一段可能是不完整 block，留到下一轮
  const rest = parts.pop() ?? "";

  const events: Array<{ event: string | null; data: string }> = [];

  for (const part of parts) {
    const lines = part.split("\n").filter(Boolean);
    let eventName: string | null = null;
    const dataLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith("event:")) {
        eventName = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trimStart());
      }
    }

    events.push({ event: eventName, data: dataLines.join("\n") });
  }

  return { events, rest };
}
