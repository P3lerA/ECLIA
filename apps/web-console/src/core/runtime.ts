import { BlockRendererRegistry } from "./renderer/BlockRendererRegistry";
import { registerDefaultBlockRenderers } from "./renderer/defaultRenderers";
import { ToolRegistry, registerDefaultTools } from "./tools/ToolRegistry";
import { TransportRegistry } from "./transport/TransportRegistry";
import { MockTransport } from "./transport/MockTransport";
import { SSEFetchTransport } from "./transport/SSEFetchTransport";

export type Runtime = {
  blocks: BlockRendererRegistry;
  tools: ToolRegistry;
  transports: TransportRegistry;
};

export const runtime: Runtime = (() => {
  const blocks = new BlockRendererRegistry();
  registerDefaultBlockRenderers(blocks);

  const tools = new ToolRegistry();
  registerDefaultTools(tools);

  const transports = new TransportRegistry();
  transports.register("mock", new MockTransport());
  transports.register("sse", new SSEFetchTransport({ endpoint: "/api/chat" }));

  return { blocks, tools, transports };
})();
