// Minimal stand-in for the `cloudflare:workers` module so pure helpers that
// import @cloudflare/codemode can be unit-tested under Node.
export class DurableObject {}
export class WorkerEntrypoint {}
export class RpcTarget {}
export const env = {};
