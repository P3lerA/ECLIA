import type { InstrumentPreset } from "../types.js";

export const emailListenerPreset: InstrumentPreset = {
  presetId: "email-listener",
  name: "Email Listener",
  description:
    "Watch an IMAP mailbox for new mail. An LLM evaluates each email against " +
    "your criterion and notifies you on Discord/Telegram if it's worth attention.",

  triggerKinds: ["email-imap"],
  actionKinds: ["llm-triage"]
};
