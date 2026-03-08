import type { Registry } from "../registry.js";
import { emailImapFactory } from "./email-imap.js";
import { llmProcessFactory } from "./llm-process.js";
import { gateFactory } from "./gate.js";
import { gatewayNotifyFactory } from "./gateway-notify.js";

/** Register all built-in node kinds. */
export function registerBuiltins(registry: Registry): void {
  registry.register(emailImapFactory);
  registry.register(llmProcessFactory);
  registry.register(gateFactory);
  registry.register(gatewayNotifyFactory);
}
