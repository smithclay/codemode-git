import { describe, expect, it } from "vitest";
import { fixtureProviders, parseCalls, stableStringify } from "../src/verify";

const calls = parseCalls(
  [
    { seq: 0, connector: "catalog", method: "search", args: { category: "rugs", cursor: null }, result: { page: 1 }, state: "applied" },
    { seq: 1, connector: "__step", method: "now", args: null, result: 1, state: "applied" },
    { seq: 2, connector: "catalog", method: "search", args: { cursor: "10", category: "rugs" }, result: { page: 2 }, state: "applied" }
  ]
    .map((c) => JSON.stringify(c))
    .join("\n")
);

describe("replay fixtures", () => {
  it("drops codemode.step entries", () => {
    expect(calls.map((c) => c.connector)).toEqual(["catalog", "catalog"]);
  });

  it("compares objects regardless of key order", () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(stableStringify({ a: { c: 3, d: 2 }, b: 1 }));
  });

  it("answers recorded calls by arguments and rejects unrecorded ones", async () => {
    const [catalog] = fixtureProviders(calls);
    const search = catalog!.fns.search!;
    expect(await search({ category: "rugs", cursor: "10" })).toEqual({ page: 2 });
    expect(await search({ category: "rugs", cursor: null })).toEqual({ page: 1 });
    await expect(search({ category: "rugs", cursor: null })).rejects.toThrow(/never called/);
    await expect(search({ category: "lamps", cursor: null })).rejects.toThrow(/never called/);
  });
});
