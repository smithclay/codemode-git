import { runAi } from "./ai";
import { DurableObject } from "cloudflare:workers";
import { DynamicWorkerExecutor, type CodemodeConnector, type ResolvedProvider } from "@cloudflare/codemode";
import {
  ArtifactsSink,
  FILES,
  parseTrailers,
  SKILLS_INDEX,
  skillPath,
  snippetsUsed,
  TRAILERS,
  type SkillMeta,
  type SkillsIndex
} from "codemode-git";
import { coveringSkill, reusability, sameTask } from "./clef";
import { Generalizer, type Proposal, type SourceRun } from "./generalize";
import { fixtureProviders, parseCalls, replay, type CallRecord } from "./verify";

/** What the curator itself needs. Hosts add their own bindings on top. */
export type Env = {
  ARTIFACTS: Artifacts;
  AI: Ai;
  LOADER: WorkerLoader;
};

/** Which repos a curator watches and where it publishes. One curator, one scope. */
export type CuratorScope = { repoPrefix: string; skillsRepo: string };
export type CuratorPolicy = typeof POLICY;
export const DEFAULT_SCOPE: CuratorScope = { repoPrefix: "agent-", skillsRepo: "skills" };
const EMBEDDING_MODEL = "@cf/qwen/qwen3-embedding-0.6b";

/** Tunables. Defaults; a curator can override them with configure(). */
export const POLICY = {
  /** A cluster needs this many distinct agents before it becomes a skill. */
  minRepos: 3,
  /**
   * Cluster only runs that agents marked as producing their final result
   * (Codemode-Final marker commits), not every exploratory step. For multi-step
   * agents, where most runs are scaffolding.
   */
  finalRunsOnly: false,
  /** Embedding similarity to make Clef's shortlist. Loose on purpose: Clef makes the call. */
  shortlist: 0.5,
  shortlistSize: 12,
  /** Clef probability needed to call two runs the same task, or a run covered by a skill. */
  decide: 0.8,
  /** Clef's expected reusability score (0 one-off .. 2 broadly reusable) a cluster needs. */
  minReusability: 1,
  /** Fraction of source runs the skill must reproduce exactly. */
  minPassRate: 1,
  repairAttempts: 1,
  maxClusterSize: 5
};

/** The bits of a `cf.artifacts.repo.pushed` event the curator uses. */
export type PushedEvent = {
  type: "cf.artifacts.repo.pushed";
  source: { namespace: string; repoName: string };
  payload: { ref: string; before: string; after: string };
};

type RunRow = {
  repo: string;
  sha: string;
  intent: string;
  status: string;
  code: string;
  calls: string;
  result: string;
  embedding: string;
  skill: string | null;
  used_skills: string;
  committed_at: number;
  final?: number;
};

type SkillRow = {
  name: string;
  description: string;
  input_schema: string;
  connectors: string;
  code: string;
  embedding: string;
  sources: string;
  verified: string;
  reusability: number;
  commit_sha: string | null;
  uses: number;
  created_at: number;
};

export type Attempt = {
  id: number;
  repos: string[];
  outcome: "published" | "rejected" | "error";
  skill: string | null;
  detail: string;
  at: number;
};

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

/**
 * One curator per scope: a set of agent repos (by name prefix) and the skills
 * repo it publishes to. It is the only writer to that skills repo. Agents
 * never wait on it: it consumes push events after the fact.
 */
export class Curator<E extends Env = Env> extends DurableObject<E> {
  #sink?: ArtifactsSink;
  #executor: DynamicWorkerExecutor;
  #queue: Promise<unknown> = Promise.resolve();

  /**
   * Connectors to verify skills against for real, instead of replaying recorded
   * results. Use for deterministic, read-only data (e.g. a static dataset),
   * where recordings may be truncated. Everything else replays from calls.jsonl.
   */
  protected liveConnectors(): CodemodeConnector[] {
    return [];
  }

  constructor(ctx: DurableObjectState, env: E) {
    super(ctx, env);
    this.#executor = new DynamicWorkerExecutor({ loader: env.LOADER, timeout: 30_000 });
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs (
        repo TEXT NOT NULL, sha TEXT NOT NULL, intent TEXT NOT NULL, status TEXT NOT NULL,
        code TEXT NOT NULL, calls TEXT NOT NULL, result TEXT NOT NULL, embedding TEXT NOT NULL,
        skill TEXT, used_skills TEXT NOT NULL DEFAULT '[]', committed_at INTEGER NOT NULL,
        final INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (repo, sha)
      );
      CREATE TABLE IF NOT EXISTS skills (
        name TEXT PRIMARY KEY, description TEXT NOT NULL, input_schema TEXT NOT NULL,
        connectors TEXT NOT NULL, code TEXT NOT NULL, embedding TEXT NOT NULL, sources TEXT NOT NULL,
        verified TEXT NOT NULL, reusability REAL NOT NULL DEFAULT 0, commit_sha TEXT,
        uses INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT, cluster TEXT NOT NULL, repos TEXT NOT NULL,
        outcome TEXT NOT NULL, skill TEXT, detail TEXT NOT NULL, at INTEGER NOT NULL
      );
    `);
  }

  // ---- entry points -------------------------------------------------------

  /** Set which repos this curator watches, where it publishes, and policy overrides. */
  configure(scope: CuratorScope, policy: Partial<CuratorPolicy> = {}): CuratorScope {
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO config (key, value) VALUES ('scope', ?), ('policy', ?)`,
      JSON.stringify(scope),
      JSON.stringify(policy)
    );
    this.#sink = undefined;
    return scope;
  }

  #policy(): CuratorPolicy {
    const row = this.ctx.storage.sql
      .exec<{ value: string }>(`SELECT value FROM config WHERE key = 'policy'`)
      .toArray()[0];
    return { ...POLICY, ...(row ? (JSON.parse(row.value) as Partial<CuratorPolicy>) : {}) };
  }

  #scope(): CuratorScope {
    const row = this.ctx.storage.sql
      .exec<{ value: string }>(`SELECT value FROM config WHERE key = 'scope'`)
      .toArray()[0];
    return row ? (JSON.parse(row.value) as CuratorScope) : DEFAULT_SCOPE;
  }

  #inScope(repo: string): boolean {
    const { repoPrefix, skillsRepo } = this.#scope();
    return repo.startsWith(repoPrefix) && repo !== skillsRepo;
  }

  #skillsSink(): ArtifactsSink {
    return (this.#sink ??= new ArtifactsSink({
      artifacts: this.env.ARTIFACTS,
      repo: this.#scope().skillsRepo,
      description: "Shared Code Mode skills, curated from agent runs",
      author: { name: "codemode-git curator", email: "curator@codemode-git.local" }
    }));
  }

  /** Handle push events. Serialized, so clustering sees a consistent view. */
  ingest(events: PushedEvent[]): Promise<{ ingested: number; published: string[] }> {
    const run = this.#queue.then(() => this.#ingest(events));
    this.#queue = run.catch(() => {});
    return run;
  }

  /** Synthesize push events for every agent repo's full history (catch-up / local dev). */
  async backfill(): Promise<{ ingested: number; published: string[] }> {
    const events: PushedEvent[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.env.ARTIFACTS.list({ limit: 100, cursor });
      for (const repo of page.repos) {
        if (!this.#inScope(repo.name)) continue;
        const branch = repo.defaultBranch || "main";
        events.push({
          type: "cf.artifacts.repo.pushed",
          source: { namespace: "", repoName: repo.name },
          payload: { ref: `refs/heads/${branch}`, before: "", after: branch }
        });
      }
      cursor = page.cursor;
    } while (cursor);
    return this.ingest(events);
  }

  status() {
    const sql = this.ctx.storage.sql;
    return {
      runs: sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM runs`).one().n,
      repos: sql.exec<{ n: number }>(`SELECT COUNT(DISTINCT repo) AS n FROM runs`).one().n,
      covered: sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM runs WHERE skill IS NOT NULL`).one().n,
      skills: sql
        .exec<SkillRow>(`SELECT * FROM skills ORDER BY reusability DESC, created_at`)
        .toArray()
        .map((s) => ({
          name: s.name,
          description: s.description,
          uses: s.uses,
          sources: JSON.parse(s.sources) as SkillMeta["sources"],
          verified: JSON.parse(s.verified) as SkillMeta["verified"],
          reusability: s.reusability,
          commit: s.commit_sha
        })),
      attempts: sql
        .exec<Attempt & { repos: string }>(
          `SELECT id, repos, outcome, skill, detail, at FROM attempts ORDER BY id DESC LIMIT 20`
        )
        .toArray()
        .map((a) => ({ ...a, repos: JSON.parse(a.repos) as string[] }))
    };
  }

  // ---- ingest -------------------------------------------------------------

  async #ingest(events: PushedEvent[]) {
    let ingested = 0;
    const published: string[] = [];
    for (const event of events) {
      const repo = event.source.repoName;
      if (!this.#inScope(repo)) continue;
      let batch: { rows: RunRow[]; finals: string[] };
      try {
        batch = await this.#newRuns(repo, event.payload);
      } catch (err) {
        console.error(`curator: could not read ${repo}`, err);
        continue;
      }
      const policy = this.#policy();
      for (const run of batch.rows) {
        ingested++;
        this.#countUses(run);
        if (policy.finalRunsOnly) continue;
        const skill = await this.#safeConsider(run, policy);
        if (skill) published.push(skill);
      }
      if (policy.finalRunsOnly) {
        for (const sha of batch.finals) {
          const run = this.ctx.storage.sql
            .exec<RunRow>(`SELECT * FROM runs WHERE repo = ? AND sha = ?`, repo, sha)
            .toArray()[0];
          if (!run) continue;
          const skill = await this.#safeConsider(run, policy);
          if (skill) published.push(skill);
        }
      }
    }
    return { ingested, published };
  }

  /** Commits between `before` and `after`, oldest first, that we haven't seen. */
  async #newRuns(repoName: string, push: PushedEvent["payload"]): Promise<{ rows: RunRow[]; finals: string[] }> {
    const repo = await this.env.ARTIFACTS.get(repoName);
    try {
      const log = await repo.log({ ref: push.after, limit: 200 });
      const commits = [];
      for (const commit of log) {
        if (commit.hash === push.before) break;
        commits.push(commit);
      }
      const rows: RunRow[] = [];
      const finals: string[] = [];
      for (const commit of commits.reverse()) {
        const trailers = parseTrailers(commit.message);
        if (trailers[TRAILERS.final]) {
          // Marker commit: points at the run that produced the agent's result.
          const prefix = trailers[TRAILERS.final]!;
          const target = [...rows].reverse().find((r) => r.sha.startsWith(prefix))?.sha ?? prefix;
          this.ctx.storage.sql.exec(`UPDATE runs SET final = 1 WHERE repo = ? AND sha = ?`, repoName, target);
          finals.push(target);
          continue;
        }
        const seen = this.ctx.storage.sql
          .exec(`SELECT 1 FROM runs WHERE repo = ? AND sha = ?`, repoName, commit.hash)
          .toArray().length;
        if (seen) continue;
        const status = trailers[TRAILERS.status];
        if (!status) continue; // not a Code Mode run
        const [code, calls, result] = await Promise.all(
          [FILES.code, FILES.calls, FILES.result].map(async (path) => {
            const blob = await repo.readFile({ ref: commit.hash, path });
            return blob ? blob.text() : "";
          })
        );
        const intent = commit.message.split("\n")[0]!;
        const row: RunRow = {
          repo: repoName,
          sha: commit.hash,
          intent,
          status,
          code: code!,
          calls: calls!,
          result: JSON.stringify((JSON.parse(result || "{}") as { result?: unknown }).result ?? null),
          embedding: "[]", // computed when the run is considered for clustering
          skill: null,
          used_skills: JSON.stringify(snippetsUsed(code!)),
          committed_at: commit.committedAt * 1000
        };
        this.ctx.storage.sql.exec(
          `INSERT OR IGNORE INTO runs (repo, sha, intent, status, code, calls, result, embedding, skill, used_skills, committed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          row.repo, row.sha, row.intent, row.status, row.code, row.calls, row.result,
          row.embedding, row.skill, row.used_skills, row.committed_at
        );
        rows.push(row);
      }
      return { rows, finals };
    } finally {
      repo[Symbol.dispose]();
    }
  }

  async #embed(text: string): Promise<number[]> {
    const out = (await runAi(this.env.AI, EMBEDDING_MODEL, {
      documents: [text.slice(0, 6000)]
    })) as { data: number[][] };
    return out.data[0]!;
  }

  // ---- cluster → propose → verify → publish ------------------------------

  /** Decide what a new run means for the library. Returns a skill name if one was published. */
  #countUses(run: RunRow) {
    // Reuse: the run called library skills. That's the metric we want to go up.
    for (const name of JSON.parse(run.used_skills) as string[]) {
      this.ctx.storage.sql.exec(`UPDATE skills SET uses = uses + 1 WHERE name = ?`, name);
    }
  }

  /** One run's failure (model, push, sandbox) is recorded, not fatal to the batch. */
  async #safeConsider(run: RunRow, policy: CuratorPolicy): Promise<string | null> {
    try {
      return await this.#consider(run, policy);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`curator: considering ${run.repo}@${run.sha.slice(0, 8)} failed`, err);
      this.#record(`error:${run.sha}`, [run.repo], "error", null, message);
      return null;
    }
  }

  async #consider(run: RunRow, policy: CuratorPolicy): Promise<string | null> {
    const sql = this.ctx.storage.sql;
    if (run.status !== "completed" || (JSON.parse(run.used_skills) as string[]).length) return null;
    if (run.embedding === "[]") {
      run.embedding = JSON.stringify(await this.#embed(`${run.intent}\n${run.code}`));
      sql.exec(`UPDATE runs SET embedding = ? WHERE repo = ? AND sha = ?`, run.embedding, run.repo, run.sha);
    }

    const vector = JSON.parse(run.embedding) as number[];
    const summary = { intent: run.intent, code: run.code };

    // Already covered by an existing skill? Embeddings shortlist, Clef decides.
    const skillShortlist = sql
      .exec<SkillRow>(`SELECT name, description, code, embedding FROM skills`)
      .toArray()
      .map((s) => ({ ...s, sim: cosine(vector, JSON.parse(s.embedding) as number[]) }))
      .filter((s) => s.sim >= policy.shortlist)
      .sort((a, b) => b.sim - a.sim)
      .slice(0, 8);
    if (skillShortlist.length) {
      const covering = await coveringSkill(this.env.AI, summary, skillShortlist);
      if (covering.name && covering.probability >= policy.decide) {
        sql.exec(`UPDATE runs SET skill = ? WHERE repo = ? AND sha = ?`, covering.name, run.repo, run.sha);
        return null;
      }
    }

    // Cluster: shortlist the nearest uncovered run from each other agent by
    // embedding, then let Clef decide which really are the same task.
    const bestPerRepo = new Map<string, { row: RunRow; sim: number }>();
    for (const other of sql
      .exec<RunRow>(
        `SELECT * FROM runs WHERE status = 'completed' AND skill IS NULL AND embedding != '[]' AND repo != ?
         ${policy.finalRunsOnly ? "AND final = 1" : ""}`,
        run.repo
      )
      .toArray()) {
      if ((JSON.parse(other.used_skills) as string[]).length) continue;
      const sim = cosine(vector, JSON.parse(other.embedding) as number[]);
      if (sim < policy.shortlist) continue;
      const best = bestPerRepo.get(other.repo);
      if (!best || sim > best.sim) bestPerRepo.set(other.repo, { row: other, sim });
    }
    const shortlist = [...bestPerRepo.values()]
      .sort((a, b) => b.sim - a.sim)
      .slice(0, policy.shortlistSize)
      .map((n) => n.row);
    if (shortlist.length + 1 < policy.minRepos) return null;

    const probabilities = await sameTask(
      this.env.AI,
      summary,
      shortlist.map((r) => ({ intent: r.intent, code: r.code }))
    );
    // Rank members by Clef's confidence that they're the same task.
    const neighbors = shortlist
      .map((row, i) => ({ row, p: probabilities[i]! }))
      .filter((n) => n.p >= policy.decide)
      .sort((a, b) => b.p - a.p)
      .map((n) => n.row);
    if (neighbors.length + 1 < policy.minRepos) return null;

    const cluster = [run, ...neighbors].slice(0, policy.maxClusterSize);
    return this.#propose(cluster);
  }

  async #propose(cluster: RunRow[]): Promise<string | null> {
    const runs: (SourceRun & { recorded: CallRecord[] })[] = cluster.map((row) => {
      const recorded = parseCalls(row.calls);
      return {
        repo: row.repo,
        sha: row.sha,
        intent: row.intent,
        code: row.code,
        calls: recorded.map(({ connector, method, args }) => ({ connector, method, args })),
        result: JSON.parse(row.result),
        recorded
      };
    });
    const repos = runs.map((r) => r.repo);
    const policy = this.#policy();
    // The same set of source runs is only ever tried once; new evidence makes a new cluster.
    const key = runs.map((r) => r.sha).sort().join(",");
    if (this.ctx.storage.sql.exec(`SELECT 1 FROM attempts WHERE cluster = ?`, key).toArray().length) return null;

    // Rank: is this task worth a shared skill at all?
    const score = await reusability(this.env.AI, runs);
    if (score < policy.minReusability) {
      this.#record(key, repos, "rejected", null, `reusability ${score.toFixed(2)} below ${policy.minReusability}`);
      return null;
    }
    const generalizer = new Generalizer(this.env.AI, runs);

    let proposal: Proposal | null = null;
    let failures: string[] = [];
    let rounds = 0;
    try {
      for (let attempt = 0; attempt <= policy.repairAttempts; attempt++) {
        rounds++;
        proposal = attempt === 0 ? await generalizer.propose() : await generalizer.repair(failures);
        failures = await this.#verify(proposal, runs);
        if (failures.length <= runs.length * (1 - policy.minPassRate)) break;
      }
    } catch (err) {
      this.#record(key, repos, "error", proposal?.name ?? null, err instanceof Error ? err.message : String(err));
      return null;
    }
    if (!proposal || failures.length > runs.length * (1 - policy.minPassRate)) {
      this.#record(key, repos, "rejected", proposal?.name ?? null, `after ${rounds} round(s):\n${failures.join("\n")}`);
      return null;
    }
    return this.#publish(key, proposal, runs, runs.length - failures.length, score, rounds);
  }

  /** Replay the proposal against each source run. Returns one message per failure. */
  async #verify(proposal: Proposal, runs: (SourceRun & { recorded: CallRecord[] })[]): Promise<string[]> {
    const failures: string[] = [];
    for (const [i, run] of runs.entries()) {
      const outcome = await replay(
        this.#executor,
        proposal.code,
        { input: proposal.inputs[i], calls: run.recorded, expected: run.result },
        this.#providers(run.recorded)
      );
      if (!outcome.ok) failures.push(`source ${i + 1} (${run.repo}): ${outcome.error}`);
    }
    return failures;
  }

  async #publish(
    key: string,
    proposal: Proposal,
    runs: (SourceRun & { recorded: CallRecord[] })[],
    passed: number,
    reusabilityScore: number,
    rounds: number
  ) {
    const sql = this.ctx.storage.sql;
    let name = proposal.name;
    for (let n = 2; sql.exec(`SELECT 1 FROM skills WHERE name = ?`, name).toArray().length; n++) {
      name = `${proposal.name}-${n}`;
    }
    const connectors = [...new Set(runs.flatMap((r) => r.calls.map((c) => c.connector)))].sort();
    const meta: SkillMeta = {
      name,
      description: proposal.description,
      inputSchema: proposal.inputSchema,
      connectors,
      sources: runs.map(({ repo, sha }) => ({ repo, sha })),
      verified: { passed, total: runs.length },
      reusability: Math.round(reusabilityScore * 100) / 100
    };
    const embedding = await this.#embed(`${proposal.description}\n${proposal.code}`);
    sql.exec(
      `INSERT INTO skills (name, description, input_schema, connectors, code, embedding, sources, verified, reusability, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      name, meta.description, JSON.stringify(meta.inputSchema), JSON.stringify(connectors), proposal.code,
      JSON.stringify(embedding), JSON.stringify(meta.sources), JSON.stringify(meta.verified), meta.reusability, Date.now()
    );
    for (const run of runs) {
      sql.exec(`UPDATE runs SET skill = ? WHERE repo = ? AND sha = ?`, name, run.repo, run.sha);
    }

    const index: SkillsIndex = {
      // Ranked: most reusable first, so it's what agents see first in codemode.search.
      skills: sql.exec<SkillRow>(`SELECT * FROM skills ORDER BY reusability DESC, name`).toArray().map((s) => ({
        name: s.name,
        description: s.description,
        inputSchema: JSON.parse(s.input_schema),
        connectors: JSON.parse(s.connectors) as string[],
        sources: JSON.parse(s.sources) as SkillMeta["sources"],
        verified: JSON.parse(s.verified) as SkillMeta["verified"],
        reusability: s.reusability
      }))
    };
    const sha = await this.#skillsSink().commit({
      message: [
        `Add skill ${name}`,
        "",
        meta.description,
        "",
        `Codemode-Skill: ${name}`,
        `Codemode-Verified: ${passed}/${runs.length}`,
        ...runs.map((r) => `Codemode-Source: ${r.repo}@${r.sha.slice(0, 12)}`)
      ].join("\n"),
      files: {
        [SKILLS_INDEX]: `${JSON.stringify(index, null, 2)}\n`,
        [skillPath(name, "snippet.js")]: `${proposal.code.trim()}\n`,
        [skillPath(name, "meta.json")]: `${JSON.stringify(meta, null, 2)}\n`,
        [skillPath(name, "provenance.json")]: `${JSON.stringify(
          runs.map((r, i) => ({ repo: r.repo, sha: r.sha, intent: r.intent, input: proposal.inputs[i] })),
          null,
          2
        )}\n`
      },
      timestamp: Date.now()
    });
    sql.exec(`UPDATE skills SET commit_sha = ? WHERE name = ?`, sha, name);
    this.#record(key, runs.map((r) => r.repo), "published", name, `verified ${passed}/${runs.length} after ${rounds} round(s), commit ${sha}`);
    return name;
  }

  /** Live providers for connectors registered as live, recorded fixtures for the rest. */
  #providers(calls: CallRecord[]): ResolvedProvider[] {
    const live = new Map(this.liveConnectors().map((c) => [c.name(), c]));
    const fixtures = fixtureProviders(calls.filter((c) => !live.has(c.connector)));
    const liveProviders: ResolvedProvider[] = [...new Set(calls.map((c) => c.connector))]
      .filter((name) => live.has(name))
      .map((name) => {
        const connector = live.get(name)!;
        const methods = [...new Set(calls.filter((c) => c.connector === name).map((c) => c.method))];
        return {
          name,
          fns: Object.fromEntries(
            methods.map((method) => [method, (...args: unknown[]) => connector.executeTool(method, args[0] ?? {})])
          )
        };
      });
    return [...fixtures, ...liveProviders];
  }

  #record(cluster: string, repos: string[], outcome: Attempt["outcome"], skill: string | null, detail: string) {
    this.ctx.storage.sql.exec(
      `INSERT INTO attempts (cluster, repos, outcome, skill, detail, at) VALUES (?, ?, ?, ?, ?, ?)`,
      cluster,
      JSON.stringify(repos), outcome, skill, detail.slice(0, 4000), Date.now()
    );
  }
}
