import {
  CodemodeConnector,
  truncateResult,
  type CodemodeRuntimeHandle,
  type ConnectorTools,
  type ExecutionEndStatus,
  type ExecutionState
} from "@cloudflare/codemode";
import { defaultIntent, FILES, toCommit, type CommitContent } from "./format";
import type { GitSink } from "./sink";

export type GitHistoryOptions = {
  sink: GitSink;
  /** One-line intent for the commit subject. Defaults to the code's leading `//` comment. */
  describe?: (exec: ExecutionState) => string | Promise<string>;
  /** Scrub an execution before it's committed. Defaults to truncating large values. */
  redact?: (exec: ExecutionState) => ExecutionState;
  /** Sandbox namespace for the read-only history tools. Defaults to "history". */
  name?: string;
};

type CommitRow = {
  seq: number;
  execution_id: string;
  status: string;
  intent: string;
  content: string | null;
  sha: string | null;
  error: string | null;
  created_at: number;
};

const TABLE = "codemode_git_commits";

// One drain at a time per Durable Object, even if the host builds a new
// connector per request. Commits must land in the order runs finished.
const drains = new WeakMap<DurableObjectState, Promise<void>>();

function truncateValues(exec: ExecutionState): ExecutionState {
  const cap = (value: unknown) => truncateResult(value, { maxChars: 16_000 });
  return {
    ...exec,
    result: cap(exec.result),
    log: exec.log.map((entry) => ({ ...entry, args: cap(entry.args), result: cap(entry.result) }))
  };
}

/**
 * Records every Code Mode execution as a git commit.
 *
 * Add it to the runtime's connectors and `bind()` it to the runtime handle.
 * When an execution reaches a terminal state, `disposeExecution` writes the
 * commit to a durable outbox in the agent's SQLite, then drains the outbox to
 * the sink in order. The outbox makes it idempotent (one commit per execution
 * and status) and crash-safe (anything unpushed is retried on the next drain).
 *
 * The model also gets read-only `history.log()` and `history.show()` so it can
 * look back past the runtime's execution retention.
 */
export class GitHistoryConnector extends CodemodeConnector {
  readonly #state: DurableObjectState;
  readonly #options: GitHistoryOptions;
  #runtime?: CodemodeRuntimeHandle;

  constructor(state: DurableObjectState, env: unknown, options: GitHistoryOptions) {
    super(state, env);
    this.#state = state;
    this.#options = options;
    state.storage.sql.exec(`CREATE TABLE IF NOT EXISTS ${TABLE} (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      execution_id TEXT NOT NULL,
      status TEXT NOT NULL,
      intent TEXT NOT NULL,
      content TEXT,
      sha TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE (execution_id, status)
    )`);
  }

  /** Give the connector the runtime it records. Returns the runtime for chaining. */
  bind<T extends CodemodeRuntimeHandle>(runtime: T): T {
    this.#runtime = runtime;
    return runtime;
  }

  name() {
    return this.#options.name ?? "history";
  }

  protected instructions() {
    return "Read-only history of this agent's past code runs, one git commit per run.";
  }

  protected tools(): ConnectorTools {
    return {
      log: {
        description: "List recent past runs, newest first: sha, intent, status.",
        inputSchema: {
          type: "object",
          properties: { limit: { type: "number", description: "Max runs to return (default 20)" } }
        },
        execute: (args) => {
          const limit = Number((args as { limit?: number })?.limit ?? 20);
          return this.commits(limit).map((row) => ({
            sha: row.sha,
            executionId: row.execution_id,
            status: row.status,
            intent: row.intent,
            at: new Date(row.created_at).toISOString()
          }));
        }
      },
      show: {
        description: "Code, tool calls and result of one past run, by sha or execution id.",
        inputSchema: {
          type: "object",
          properties: { ref: { type: "string", description: "Commit sha or execution id" } },
          required: ["ref"]
        },
        execute: async (args) => {
          const ref = String((args as { ref: string }).ref);
          const sha = this.#lookupSha(ref) ?? ref;
          const [code, calls, result] = await Promise.all(
            [FILES.code, FILES.calls, FILES.result].map((path) => this.#options.sink.read(sha, path))
          );
          if (code === null) return { error: `No run found for "${ref}".` };
          return { sha, code, calls, result: result && JSON.parse(result) };
        }
      }
    };
  }

  override async disposeExecution(executionId: string, status: ExecutionEndStatus): Promise<void> {
    if (!this.#runtime) {
      console.warn("codemode-git: GitHistoryConnector was never bound to a runtime; skipping commit");
      return;
    }
    const exec = (await this.#runtime.executions()).find((e) => e.id === executionId);
    if (!exec) return;
    const redacted = (this.#options.redact ?? truncateValues)(exec);
    const intent = (await this.#options.describe?.(exec)) ?? defaultIntent(exec);
    const content = toCommit(redacted, status, intent);
    this.#state.storage.sql.exec(
      `INSERT OR IGNORE INTO ${TABLE} (execution_id, status, intent, content, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      executionId,
      status,
      intent,
      JSON.stringify(content),
      exec.updatedAt
    );
    // Don't hold up the tool result on a network push.
    this.#state.waitUntil(this.flush());
  }

  /** Push every pending commit, oldest first. Safe to call any time (e.g. from an alarm). */
  flush(): Promise<void> {
    const next = (drains.get(this.#state) ?? Promise.resolve()).then(() => this.#drain());
    drains.set(this.#state, next.catch(() => {}));
    return next;
  }

  /** Recorded commits, newest first. Pending ones have `sha: null`. */
  commits(limit = 50): CommitRow[] {
    return this.#state.storage.sql
      .exec<CommitRow>(`SELECT * FROM ${TABLE} ORDER BY seq DESC LIMIT ?`, limit)
      .toArray();
  }

  async #drain(): Promise<void> {
    const pending = this.#state.storage.sql
      .exec<CommitRow>(`SELECT * FROM ${TABLE} WHERE sha IS NULL ORDER BY seq`)
      .toArray();
    for (const row of pending) {
      try {
        const sha = await this.#options.sink.commit(JSON.parse(row.content!) as CommitContent);
        this.#state.storage.sql.exec(
          `UPDATE ${TABLE} SET sha = ?, content = NULL, error = NULL WHERE seq = ?`,
          sha,
          row.seq
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.#state.storage.sql.exec(`UPDATE ${TABLE} SET error = ? WHERE seq = ?`, message, row.seq);
        console.error(`codemode-git: failed to push ${row.execution_id}/${row.status}`, err);
        return; // keep order: later commits wait for this one
      }
    }
  }

  #lookupSha(executionId: string): string | null {
    const row = this.#state.storage.sql
      .exec<{ sha: string | null }>(
        `SELECT sha FROM ${TABLE} WHERE execution_id = ? AND sha IS NOT NULL ORDER BY seq DESC LIMIT 1`,
        executionId
      )
      .toArray()[0];
    return row?.sha ?? null;
  }
}
