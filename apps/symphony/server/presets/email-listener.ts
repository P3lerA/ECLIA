import type { InstrumentPreset, ConfigFieldSchema } from "../types.js";

const presetConfigSchema: ConfigFieldSchema[] = [
  { key: "host", label: "IMAP Host", type: "string", required: true, placeholder: "imap.gmail.com" },
  { key: "port", label: "IMAP Port", type: "number", required: true, default: 993, placeholder: "993" },
  { key: "secure", label: "Use TLS", type: "boolean", default: true },
  { key: "user", label: "Email / Username", type: "string", required: true, placeholder: "user@example.com" },
  { key: "pass", label: "Password", type: "string", required: true, sensitive: true },
  { key: "mailbox", label: "Mailbox", type: "string", default: "INBOX", placeholder: "INBOX" }
];

export const emailListenerPreset: InstrumentPreset = {
  presetId: "email-listener",
  name: "Email Listener",
  description:
    "Watch an IMAP mailbox for new mail. An LLM evaluates each email against " +
    "your criterion and notifies you on Discord/Telegram if it's worth attention.",

  triggerKinds: ["email-imap"],
  actionKinds: ["llm-triage"],
  configSchema: presetConfigSchema
};
