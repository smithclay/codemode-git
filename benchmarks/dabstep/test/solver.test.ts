import { describe, expect, it } from "vitest";
import { actionsFrom, clip, malformedAnswer, parseArgs } from "../src/solver";

const call = (name: string, args: unknown, id = "c1") => ({
  id,
  type: "function" as const,
  function: { name, arguments: args as string }
});

describe("agent loop parsing", () => {
  it("reads code and final answers from tool calls", () => {
    expect(actionsFrom("", [call("codemode", JSON.stringify({ code: "async () => 1" }))])).toEqual([
      { kind: "code", code: "async () => 1", callId: "c1" }
    ]);
    expect(actionsFrom("", [call("final_answer", JSON.stringify({ answer: "NL" }))])).toEqual([
      { kind: "answer", answer: "NL", callId: "c1" }
    ]);
  });

  it("accepts tool arguments that arrive already parsed", () => {
    expect(actionsFrom("", [call("codemode", { code: "async () => 2" })])[0]).toMatchObject({ code: "async () => 2" });
  });

  it("ignores malformed tool arguments instead of throwing", () => {
    expect(parseArgs("{not json")).toEqual({});
    expect(parseArgs('"a string"')).toEqual({});
    expect(actionsFrom("", [call("codemode", "{not json")])).toEqual([]);
  });

  it("falls back to fenced code, raw tool-call tokens, and FINAL ANSWER text", () => {
    expect(actionsFrom("```js\nasync () => 3\n```", [])[0]).toMatchObject({ kind: "code", code: "async () => 3" });
    const raw = '<|tool_call_argument_begin|>{"code": "async () => 4"}<|tool_call_end|>';
    expect(actionsFrom(raw, [])[0]).toMatchObject({ kind: "code", code: "async () => 4" });
    expect(actionsFrom("FINAL ANSWER: B. BE", [])[0]).toMatchObject({ kind: "answer", answer: "B. BE" });
  });

  it("clips results without crashing on undefined, and keeps a whole manual", () => {
    expect(clip(undefined)).toBe("undefined");
    expect(clip("x".repeat(22_000))).toHaveLength(22_000);
    expect(clip("x".repeat(30_000))).toContain("truncated");
  });

  it("flags prose or markdown final answers, not normal ones", () => {
    expect(malformedAnswer('**ACI "B"**\n\nReasoning: ...')).toBe(true);
    expect(malformedAnswer("E:13.57")).toBe(false);
    expect(malformedAnswer("36, 51, 53, 64")).toBe(false);
    expect(malformedAnswer("Not Applicable")).toBe(false);
  });
});
