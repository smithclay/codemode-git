import { normalizeCode, type Executor, type ResolvedProvider } from "@cloudflare/codemode";

// Verification by replay. A candidate skill is run in a real sandbox, but its
// connectors are fixtures that answer from a source run's recorded tool-call
// log (calls.jsonl). If the skill, given the input the generalizer claims
// reproduces that run, makes calls the run never made, or returns a
// different result, it fails. This is the "code review" of the curator.

export type CallRecord = {
  connector: string;
  method: string;
  args: unknown;
  result?: unknown;
  state?: string;
};

export type ReplayCase = { input: unknown; calls: CallRecord[]; expected: unknown };
export type ReplayOutcome = { ok: boolean; result?: unknown; error?: string };

/** JSON with sorted keys, so equal values compare equal regardless of key order. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v
  );
}

export function parseCalls(jsonl: string): CallRecord[] {
  return jsonl
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as CallRecord)
    .filter((call) => call.connector !== "__step" && call.state !== "reverted");
}

/** One provider per connector, each method answering from the recording. */
export function fixtureProviders(calls: CallRecord[]): ResolvedProvider[] {
  const used = new Set<number>();
  const byConnector = new Map<string, Set<string>>();
  for (const call of calls) {
    if (!byConnector.has(call.connector)) byConnector.set(call.connector, new Set());
    byConnector.get(call.connector)!.add(call.method);
  }
  return [...byConnector].map(([connector, methods]) => ({
    name: connector,
    fns: Object.fromEntries(
      [...methods].map((method) => [
        method,
        async (...args: unknown[]) => {
          const key = stableStringify(args[0] ?? {});
          const index = calls.findIndex(
            (c, i) =>
              !used.has(i) &&
              c.connector === connector &&
              c.method === method &&
              stableStringify(c.args ?? {}) === key
          );
          if (index === -1) {
            throw new Error(`replay: the source run never called ${connector}.${method}(${key})`);
          }
          used.add(index);
          return calls[index]!.result;
        }
      ])
    )
  }));
}

/** Run `snippetCode` the way `codemode.run(name, input)` does, against fixtures. */
export async function replay(executor: Executor, snippetCode: string, testCase: ReplayCase): Promise<ReplayOutcome> {
  const code = `async () => {\n  const snippet = (${normalizeCode(snippetCode)});\n  return await snippet(${JSON.stringify(testCase.input ?? null)});\n}`;
  const out = await executor.execute(code, fixtureProviders(testCase.calls));
  if (out.error) return { ok: false, error: out.error };
  if (stableStringify(out.result) !== stableStringify(testCase.expected)) {
    return {
      ok: false,
      result: out.result,
      error: `returned ${stableStringify(out.result).slice(0, 300)}, expected ${stableStringify(testCase.expected).slice(0, 300)}`
    };
  }
  return { ok: true, result: out.result };
}
