import type { ChatTransport } from "./ChatTransport";

export type TransportId = "mock" | "sse";

export class TransportRegistry {
  private map = new Map<TransportId, ChatTransport>();

  register(id: TransportId, transport: ChatTransport) {
    this.map.set(id, transport);
  }

  get(id: TransportId): ChatTransport {
    const t = this.map.get(id);
    if (!t) throw new Error(`Unknown transport: ${id}`);
    return t;
  }

  list(): TransportId[] {
    return [...this.map.keys()];
  }
}
