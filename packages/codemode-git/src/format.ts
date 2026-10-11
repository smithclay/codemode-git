// The on-disk shape of one Code Mode execution. Shared by the agent-side
// plugin (which writes it) and the curator (which reads it back), so this
// module stays free of Workers-only imports.

import type { ExecutionEndStatus, ExecutionState } from "@cloudflare/codemode";

export const FILES = {
  code: "run.js",
  calls: "calls.jsonl",
  result: "result.json"
} as const;

export const TRAILERS = {
  execution: "Codemode-Execution",
  status: "Codemode-Status",
  connectors: "Codemode-Connectors",
  snippets: "Codemode-Snippets",
  skillsRef: "Codemode-Skills-Ref",
  /** On a marker commit: the sha of the run that produced the agent's final result. */
  final: "Codemode-Final"
} as const;

export type CommitContent = {
  message: string;
  files: Record<string, string>;
  /** Epoch ms. The commit is dated when the run happened, not when it was pushed. */
  timestamp: number;
};

/** Snippet names the code invokes via `codemode.run("name", ...)`. */
export function snippetsUsed(code: string): string[] {
  const names = new Set<string>();
  for (const match of code.matchAll(/codemode\.run\(\s*["'`]([^"'`]+)["'`]/g)) {
    names.add(match[1]!);
  }
  return [...names];
}

/** Default intent: the code's leading `//` comment, else its first line. */
export function defaultIntent(exec: ExecutionState): string {
  const lines = exec.code.split("\n").map((l) => l.trim()).filter(Boolean);
  const comment = lines.find((l) => l.startsWith("//"));
  const intent = comment ? comment.replace(/^\/\/\s*/, "") : (lines[0] ?? "codemode run");
  return intent.length > 72 ? `${intent.slice(0, 69)}...` : intent;
}

export function toCommit(
  exec: ExecutionState,
  status: ExecutionEndStatus,
  intent: string,
  extraTrailers: Record<string, string> = {}
): CommitContent {
  const trailers: [string, string][] = [
    [TRAILERS.execution, exec.id],
    [TRAILERS.status, status],
    [TRAILERS.connectors, (exec.connectors ?? []).join(", ")],
    [TRAILERS.snippets, snippetsUsed(exec.code).join(", ")],
    ...Object.entries(extraTrailers)
  ];
  const message = [
    intent.split("\n")[0],
    "",
    ...trailers.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`)
  ].join("\n");

  const files = {
    [FILES.code]: exec.code.endsWith("\n") ? exec.code : `${exec.code}\n`,
    [FILES.calls]: exec.log.map((entry) => JSON.stringify(entry)).join("\n") + (exec.log.length ? "\n" : ""),
    [FILES.result]: `${JSON.stringify(
      { status, result: exec.result, error: exec.error, logs: exec.logs },
      null,
      2
    )}\n`
  };

  return { message, files, timestamp: exec.updatedAt };
}

/**
 * A marker commit saying which earlier run produced the agent's final result,
 * e.g. the answer to its task. Lets a curator learn from solutions rather than
 * from every exploratory step.
 */
export function toFinalCommit(runSha: string, title: string, files: Record<string, string>): CommitContent {
  return {
    message: `${title.split("\n")[0]}\n\n${TRAILERS.final}: ${runSha}`,
    files,
    timestamp: Date.now()
  };
}

export function parseTrailers(message: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of message.split("\n")) {
    const match = /^(Codemode-[A-Za-z-]+):\s*(.*)$/.exec(line);
    if (match) out[match[1]!] = match[2]!;
  }
  return out;
}
