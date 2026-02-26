import net from "node:net";

/**
 * Preflight port bind to detect common Windows issues:
 * - EACCES: reserved/excluded port (admin does not always help)
 * - EADDRINUSE: already used
 */
export async function preflightListen(host: string, port: number): Promise<{ ok: true } | { ok: false; error: string; hint?: string }> {
  return await new Promise((resolve) => {
    const srv = net.createServer();
    const onError = (err: any) => {
      const code = String(err?.code ?? "ERR");
      if (code === "EACCES") {
        resolve({
          ok: false,
          error: "permission_denied",
          hint: `Cannot bind ${host}:${port} (EACCES). On Windows this often means the port is reserved/excluded. Try a higher port (e.g. 5173, 3000, 8080).`
        });
      } else if (code === "EADDRINUSE") {
        resolve({
          ok: false,
          error: "port_in_use",
          hint: `Port ${port} is already in use. Choose another port.`
        });
      } else if (code === "EADDRNOTAVAIL") {
        resolve({
          ok: false,
          error: "host_unavailable",
          hint: `Host ${host} is not available on this machine.`
        });
      } else {
        resolve({
          ok: false,
          error: code,
          hint: `Cannot bind ${host}:${port} (${code}).`
        });
      }
    };

    srv.once("error", onError);
    srv.listen({ host, port }, () => {
      srv.close(() => resolve({ ok: true }));
    });
  });
}
