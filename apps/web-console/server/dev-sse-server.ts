import http from "node:http";

const PORT = Number(process.env.PORT ?? 8787);

type ReqBody = {
  sessionId?: string;
  model?: string;
  userText?: string;
};

function readJson(req: http.IncomingMessage): Promise<ReqBody> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += String(chunk)));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

function sseHeaders() {
  return {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };
}

function send(res: http.ServerResponse, event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

const server = http.createServer(async (req, res) => {
  const url = req.url ?? "/";
  if (req.method === "OPTIONS") {
    res.writeHead(204, sseHeaders());
    res.end();
    return;
  }

  if (url === "/api/chat" && req.method === "POST") {
    const body = await readJson(req);
    const sessionId = String(body.sessionId ?? "");
    const model = String(body.model ?? "");
    const userText = String(body.userText ?? "");

    res.writeHead(200, sseHeaders());

    send(res, "meta", { at: Date.now(), sessionId, model });

    // Simulate chunked output (replace this with a real LLM/router/tool runtime).
    const chunks = [
      `Received: ${userText.slice(0, 120)}${userText.length > 120 ? "..." : ""}`,
      "This is a demo SSE server: response is text/event-stream, messages are sent as event/data blocks.",
      "In a real system, you can also stream tool_call / tool_result / citations / retrieval as events."
    ];

    for (const c of chunks) {
      await sleep(260);
      send(res, "delta", { at: Date.now(), text: c + "\n\n" });
    }

    await sleep(180);
    send(res, "tool_call", { at: Date.now(), name: "echo", args: { upper: userText.toUpperCase() } });
    await sleep(240);
    send(res, "tool_result", { at: Date.now(), name: "echo", ok: true, result: { ok: true } });

    await sleep(120);
    send(res, "done", { at: Date.now() });
    res.end();

    // Cleanup when the client disconnects (no interval here; just a structural example).
    req.on("close", () => {
      // In real streaming generation, you'd cancel the model inference here.
    });

    return;
  }

  res.writeHead(404, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify({ error: "not_found" }));
});

server.listen(PORT, () => {
  console.log(`[sse] listening on http://localhost:${PORT}`);
  console.log(`[sse] POST http://localhost:${PORT}/api/chat`);
});
