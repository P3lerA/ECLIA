// Thin re-export wrapper.
//
// Historical note:
// - This file used to contain the gateway client implementation.
// - It now lives in @eclia/gateway-client so non-adapter services (memory, plugins, …)
//   can share the exact same logic without deep relative imports.

export * from "@eclia/gateway-client";
