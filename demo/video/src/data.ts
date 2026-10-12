// DABstep full1 (docs/experiments.md): official per-task scores and median tokens by run position.
export const learningCurve = [
  { tasks: "1–8", baseline: 315, examples: 320, note: "no memory yet" },
  { tasks: "9–24", baseline: 341, examples: 217, note: "" },
  { tasks: "25–48", baseline: 215, examples: 45, note: "" },
  { tasks: "49–96", baseline: 141, examples: 41, note: "" },
  { tasks: "97–450", baseline: 186, examples: 60, note: "" }
];

export const accuracy = [
  { level: "Easy (72)", baseline: 77.8, examples: 86.1 },
  { level: "Hard (378)", baseline: 23.5, examples: 38.6 },
  { level: "Overall (450)", baseline: 32.2, examples: 46.2 }
];

// michelle → matthew on the lava lamp wall. Illustrative until filled in from
// a recorded run of examples/agent/scripts/walkthrough.mjs.
export const walkthrough = {
  illustrative: true,
  michelle: { runs: ["error", "ok", "ok"] as ("error" | "ok")[], tokens: 3 },
  matthew: { runs: ["ok"] as ("error" | "ok")[], tokens: 1 }
};
