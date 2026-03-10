/**
 * math — Process node.
 *
 * Performs one of the four basic arithmetic operations on two numbers.
 * The operator is selected via config.  Operand b is connectable.
 *
 * Input ports:
 *   a : number
 *
 * Output ports:
 *   result : number
 *
 * Config:
 *   op : select — +, −, ×, ÷
 *   b  : number (connectable) — second operand
 */

import type { NodeFactory } from "../types.js";

export const factory: NodeFactory = {
  kind: "math",
  label: "Math",
  role: "process",
  description: "Basic arithmetic: +, −, ×, ÷",

  inputPorts: [
    { key: "a", label: "A", type: "number" },
  ],
  outputPorts: [
    { key: "result", label: "Result", type: "number" },
  ],

  configSchema: [
    { key: "op", label: "Operator", type: "select", options: ["+", "−", "×", "÷"], default: "+" },
    { key: "b", label: "B", type: "number", default: 0, connectable: true },
  ],

  create(id, config) {
    return {
      role: "process" as const,
      id,
      kind: "math",

      async execute(ctx) {
        const a = Number(ctx.inputs.a ?? 0);
        // Runtime transparently merges cfg: wires into config before execute().
        const b = Number(config.b ?? 0);
        const op = String(config.op || "+");
        let result: number;
        switch (op) {
          case "−": result = a - b; break;
          case "×": result = a * b; break;
          case "÷": result = b !== 0 ? a / b : 0; break;
          default:  result = a + b; break;
        }
        return { result };
      }
    };
  }
};
