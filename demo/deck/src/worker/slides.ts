import { CodemodeConnector, type ConnectorTools, type Executor } from "@cloudflare/codemode";
import type { ArtifactsSink } from "@smithclay/codemode-git";
import { accuracy, learningCurve, walkthrough } from "../../../video/src/data";
import { outline } from "../outline";
import { check, type Slide } from "../spec";

// The deck is a git repo in Cloudflare Artifacts:
//   slides/<id>.js    the program that draws the slide: `async () => ({ kicker, elements })`
//   slides/<id>.json  what it returned, which the presenter renders
//   deck.json         { order: [...] }, the slide order (defaults to outline.md)
// The agent edits slides by writing programs; every write is a commit.

const DATA = { accuracy, learningCurve, walkthrough };
type DataName = keyof typeof DATA;

export const slidePath = (id: string) => `slides/${id}.js`;
const specPath = (id: string) => `slides/${id}.json`;
const ID = /^[a-z0-9-]{1,48}$/;

export type StoredSlide = { id: string; code: string; slide: Slide; sha: string | null; updatedAt: string };

/** Slide programs see `deck.data(...)` and `deck.check(...)`, nothing else. */
function deckFns(): Record<string, (...args: unknown[]) => Promise<unknown>> {
  return {
    // Models pass either deck.data("x") or deck.data({ name: "x" }).
    data: async (args) => {
      const name = (typeof args === "string" ? args : (args as { name?: string })?.name) as DataName;
      return DATA[name] ?? { error: `unknown data "${String(name)}"; use one of ${Object.keys(DATA).join(", ")}` };
    },
    check: async (args) => check(args && typeof args === "object" && "slide" in args ? (args as { slide: unknown }).slide : args)
  };
}

/** Run a slide program in a fresh isolate: the slide it returns, or why it's not a valid one. */
export async function renderSlide(executor: Executor, code: string): Promise<{ slide: Slide } | { problems: string[] }> {
  const out = await executor.execute(code, [{ name: "deck", fns: deckFns() }]);
  if (out.error) return { problems: [`the program threw: ${out.error}`] };
  const problems = check(out.result);
  return problems.length ? { problems } : { slide: out.result as Slide };
}

/**
 * The slides repo, with a SQLite copy in the Durable Object so the presenter
 * never waits on git. The repo is the source of truth: an empty copy (a new
 * Durable Object, or a reset) is filled from it.
 */
export class SlidesRepo {
  constructor(
    private readonly sql: SqlStorage,
    private readonly sink: ArtifactsSink
  ) {
    sql.exec("CREATE TABLE IF NOT EXISTS slides (id TEXT PRIMARY KEY, code TEXT NOT NULL, slide TEXT NOT NULL, sha TEXT, updated_at TEXT NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  }

  #meta(key: string): string | null {
    return this.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = ?", key).toArray()[0]?.value ?? null;
  }

  #setMeta(key: string, value: string) {
    this.sql.exec("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", key, value);
  }

  /** Fill the local copy from the repo once; afterwards writes keep both in step. */
  async hydrate(): Promise<void> {
    if (this.#meta("hydrated")) return;
    const read = (path: string) => this.sink.read("main", path).catch(() => null);
    const order = await read("deck.json");
    if (order) this.#setMeta("order", JSON.stringify((JSON.parse(order) as { order: string[] }).order));
    const ids = new Set([...this.order(), ...outline.map((s) => s.id)]);
    await Promise.all(
      [...ids].map(async (id) => {
        const [code, spec] = await Promise.all([read(slidePath(id)), read(specPath(id))]);
        if (code && spec) this.#put({ id, code, slide: JSON.parse(spec) as Slide, sha: null, updatedAt: new Date().toISOString() });
      })
    );
    this.#setMeta("hydrated", new Date().toISOString());
  }

  /** Drop the local copy so the next read refills it from the repo (after another writer committed). */
  reload() {
    this.sql.exec("DELETE FROM slides");
    this.sql.exec("DELETE FROM meta");
  }

  /** Slide ids in presentation order. */
  order(): string[] {
    const stored = this.#meta("order");
    return stored ? (JSON.parse(stored) as string[]) : outline.map((s) => s.id);
  }

  get(id: string): StoredSlide | null {
    const row = this.sql.exec<{ id: string; code: string; slide: string; sha: string | null; updated_at: string }>("SELECT * FROM slides WHERE id = ?", id).toArray()[0];
    return row ? { id: row.id, code: row.code, slide: JSON.parse(row.slide) as Slide, sha: row.sha, updatedAt: row.updated_at } : null;
  }

  #put(s: StoredSlide) {
    this.sql.exec("INSERT OR REPLACE INTO slides (id, code, slide, sha, updated_at) VALUES (?, ?, ?, ?, ?)", s.id, s.code, JSON.stringify(s.slide), s.sha, s.updatedAt);
  }

  async write(id: string, code: string, slide: Slide, message: string): Promise<string> {
    const files: Record<string, string> = { [slidePath(id)]: `${code.trim()}\n`, [specPath(id)]: `${JSON.stringify(slide, null, 2)}\n` };
    // A new slide joins the end of the deck.
    const order = this.order();
    if (!order.includes(id)) files["deck.json"] = `${JSON.stringify({ order: [...order, id] }, null, 2)}\n`;
    const sha = await this.sink.commit({ message, files, timestamp: Date.now() });
    if (files["deck.json"]) this.#setMeta("order", JSON.stringify([...order, id]));
    this.#put({ id, code, slide, sha, updatedAt: new Date().toISOString() });
    return sha;
  }

  /** Delete a slide: its files go from the repo (git history keeps them) and it leaves the order. */
  async remove(id: string, message: string): Promise<string> {
    const order = this.order().filter((x) => x !== id);
    const sha = await this.sink.commit({
      message,
      files: { [slidePath(id)]: null, [specPath(id)]: null, "deck.json": `${JSON.stringify({ order }, null, 2)}\n` },
      timestamp: Date.now()
    });
    this.#setMeta("order", JSON.stringify(order));
    this.sql.exec("DELETE FROM slides WHERE id = ?", id);
    return sha;
  }

  async setOrder(ids: string[], message: string): Promise<string> {
    const sha = await this.sink.commit({ message, files: { "deck.json": `${JSON.stringify({ order: ids }, null, 2)}\n` }, timestamp: Date.now() });
    this.#setMeta("order", JSON.stringify(ids));
    return sha;
  }
}

/** What the deck agent's programs can do to the deck: `slides.*` in the sandbox. */
export class SlidesConnector extends CodemodeConnector {
  constructor(
    ctx: DurableObjectState,
    env: unknown,
    private readonly repo: SlidesRepo,
    private readonly executor: Executor,
    /** The request being worked on, for commit messages. */
    private readonly request: string
  ) {
    super(ctx, env);
  }

  name() {
    return "slides";
  }

  protected instructions() {
    return "Read and write the deck's slides. Each slide is a program in the slides repo.";
  }

  protected tools(): ConnectorTools {
    const idOf = (args: unknown) => (typeof args === "string" ? args : (args as { id?: string })?.id) ?? "";
    return {
      outline: {
        description: "The outline: every planned slide's id, the prompt it should be written from, and the speaker notes.",
        inputSchema: { type: "object", properties: {} },
        execute: () => outline
      },
      list: {
        description: "Slides in presentation order: id, whether a program exists yet, and its last commit.",
        inputSchema: { type: "object", properties: {} },
        execute: () => this.repo.order().map((id) => {
          const s = this.repo.get(id);
          return { id, built: !!s, sha: s?.sha?.slice(0, 12) ?? null, kicker: s?.slide.kicker ?? null };
        })
      },
      read: {
        description: "A slide's program (code) and the spec it returns (slide), or null if it has no program yet.",
        inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        execute: (args) => {
          const s = this.repo.get(idOf(args));
          return s && { id: s.id, code: s.code, slide: s.slide };
        }
      },
      write: {
        description:
          "Save a slide's program. code is the source of an async arrow function that returns { kicker?, elements }. It is run in a fresh sandbox and layout-checked; if it passes it is committed, else you get the problems and nothing is saved.",
        inputSchema: { type: "object", properties: { id: { type: "string" }, code: { type: "string" }, message: { type: "string" } }, required: ["id", "code"] },
        execute: async (args) => {
          const { id, code, message } = args as { id?: string; code?: string; message?: string };
          if (!id || !ID.test(id)) return { ok: false, problems: ["id must match [a-z0-9-]{1,48}"] };
          if (!code?.trim()) return { ok: false, problems: ["code is empty"] };
          const out = await renderSlide(this.executor, code);
          if ("problems" in out) return { ok: false, problems: out.problems };
          const sha = await this.repo.write(id, code, out.slide, `slide ${id}: ${(message ?? this.request).slice(0, 160)}`);
          return { ok: true, sha: sha.slice(0, 12) };
        }
      },
      remove: {
        description: "Delete a slide from the deck. Its program stays in git history, so it can be brought back by reading an old commit.",
        inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        execute: async (args) => {
          const id = idOf(args);
          if (!this.repo.order().includes(id) && !this.repo.get(id)) return { ok: false, problems: [`no slide "${id}"`] };
          const sha = await this.repo.remove(id, `remove ${id}: ${this.request.slice(0, 160)}`);
          return { ok: true, sha: sha.slice(0, 12) };
        }
      },
      order: {
        description: "Set the presentation order. ids must all be slides that have programs.",
        inputSchema: { type: "object", properties: { ids: { type: "array", items: { type: "string" } } }, required: ["ids"] },
        execute: async (args) => {
          const ids = (Array.isArray(args) ? args : (args as { ids?: string[] })?.ids) ?? [];
          const missing = ids.filter((id) => !this.repo.get(id));
          if (!ids.length || missing.length) return { ok: false, problems: [missing.length ? `no program for ${missing.join(", ")}` : "ids is empty"] };
          const sha = await this.repo.setOrder(ids, `order: ${this.request.slice(0, 160)}`);
          return { ok: true, sha: sha.slice(0, 12) };
        }
      },
      data: {
        description: `Benchmark data, the same that slide programs get from deck.data(name). name is one of: ${Object.keys(DATA).join(", ")}.`,
        inputSchema: { type: "object", properties: { name: { type: "string", enum: Object.keys(DATA) } }, required: ["name"] },
        execute: (args) => deckFns().data!(args)
      }
    };
  }
}
