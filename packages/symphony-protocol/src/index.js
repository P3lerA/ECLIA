/** Maps ConfigFieldSchema.type → PortType for connectable config fields. */
export const CFG_TO_PORT = {
  string: "string", text: "string", number: "number", boolean: "boolean",
  select: "string", model: "string",
};
