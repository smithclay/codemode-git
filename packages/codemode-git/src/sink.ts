import git from "isomorphic-git";
import http from "isomorphic-git/http/web";
import type { CommitContent } from "./format.js";
import { MemoryFS } from "./memory-fs.js";

/** A commit to write: like CommitContent, but a `null` file deletes that path. */
export type SinkCommit = Omit<CommitContent, "files"> & { files: Record<string, string | null> };

/** Where commits go. Swappable so the plugin isn't tied to one git host. */
export interface GitSink {
  /** Commit `content` on top of the branch head and publish it. Returns the commit sha. */
  commit(content: SinkCommit): Promise<string>;
  /** Read a file at a ref, or null if it doesn't exist. */
  read(ref: string, path: string): Promise<string | null>;
}

export type ArtifactsSinkOptions = {
  artifacts: Artifacts;
  /** Repo name inside the binding's namespace. Created on first commit if missing. */
  repo: string;
  description?: string;
  branch?: string;
  author?: { name: string; email: string };
};

const DIR = "/repo";
const TOKEN_TTL_SECONDS = 3600;
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** Artifacts tokens carry expiry metadata: `art_v1_<secret>?expires=<unix_seconds>`. */
function tokenSecret(token: string): string {
  return token.split("?expires=")[0]!;
}

// The binding throws ArtifactsError with code NOT_FOUND, but the code can be
// lost when the error crosses an RPC boundary (e.g. a remote binding in local
// dev), leaving only the message.
function isNotFound(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  return e?.code === "NOT_FOUND" || /not found/i.test(e?.message ?? "");
}

/**
 * Commits to a Cloudflare Artifacts repo with isomorphic-git over HTTPS.
 *
 * The Artifacts binding can create repos and mint tokens but can't write
 * commits, so writes go through the git smart-HTTP protocol. A shallow clone
 * of the branch is kept in memory and reused across commits while the
 * Durable Object stays warm, so each commit is a local commit plus an
 * incremental push. The owning agent is the only writer, so pushes don't race;
 * if one is rejected anyway, the clone is discarded and the commit retried once.
 */
export class ArtifactsSink implements GitSink {
  readonly #options: Required<Omit<ArtifactsSinkOptions, "description">> &
    Pick<ArtifactsSinkOptions, "description">;
  #fs?: MemoryFS;
  #remote?: string;
  #token?: { secret: string; expiresAt: number };
  #queue: Promise<unknown> = Promise.resolve();

  constructor(options: ArtifactsSinkOptions) {
    this.#options = {
      branch: "main",
      author: { name: "codemode", email: "codemode@codemode-git.local" },
      ...options
    };
  }

  commit(content: SinkCommit): Promise<string> {
    const run = this.#queue.then(async () => {
      try {
        return await this.#commitOnce(content);
      } catch (err) {
        console.warn(`codemode-git: commit to ${this.#options.repo} failed, recloning`, err);
        this.#fs = undefined;
        return await this.#commitOnce(content);
      }
    });
    this.#queue = run.catch(() => {});
    return run;
  }

  async read(ref: string, path: string): Promise<string | null> {
    const repo = await this.#options.artifacts.get(this.#options.repo);
    try {
      const blob = await repo.readFile({ ref, path });
      return blob ? await blob.text() : null;
    } finally {
      repo[Symbol.dispose]();
    }
  }

  async #commitOnce({ message, files, timestamp }: SinkCommit): Promise<string> {
    const fs = await this.#checkout();
    for (const [path, contents] of Object.entries(files)) {
      if (contents === null) {
        await fs.promises.unlink(`${DIR}/${path}`).catch(() => {});
        await git.remove({ fs, dir: DIR, filepath: path });
        continue;
      }
      await fs.promises.writeFile(`${DIR}/${path}`, contents);
      await git.add({ fs, dir: DIR, filepath: path });
    }
    const signature = {
      ...this.#options.author,
      timestamp: Math.floor(timestamp / 1000),
      timezoneOffset: 0
    };
    const sha = await git.commit({ fs, dir: DIR, message, author: signature, committer: signature });
    const auth = await this.#auth();
    const push = await git.push({
      fs,
      http,
      dir: DIR,
      url: this.#remote!,
      ref: this.#options.branch,
      onAuth: () => auth
    });
    if (!push.ok) throw new Error(`push rejected: ${push.error ?? JSON.stringify(push.refs)}`);
    return sha;
  }

  /** The warm clone, or a fresh one (creating the repo if it doesn't exist yet). */
  async #checkout(): Promise<MemoryFS> {
    if (this.#fs) return this.#fs;
    const { branch } = this.#options;
    const fs = new MemoryFS();
    const created = await this.#ensureRepo();
    const auth = await this.#auth();
    // Ask the remote whether the branch exists rather than trusting the repo's
    // lastPushAt, which Artifacts can leave null after git pushes: a cold
    // start would then init a new root commit and every push would be rejected.
    const hasBranch = !created && (await this.#remoteHasBranch(auth));
    if (hasBranch) {
      await git.clone({
        fs,
        http,
        dir: DIR,
        url: this.#remote!,
        ref: branch,
        singleBranch: true,
        depth: 1,
        noCheckout: false,
        onAuth: () => auth
      });
    } else {
      await git.init({ fs, dir: DIR, defaultBranch: branch });
    }
    this.#fs = fs;
    return fs;
  }

  async #remoteHasBranch(auth: { username: string; password: string }): Promise<boolean> {
    const ref = `refs/heads/${this.#options.branch}`;
    const refs = await git.listServerRefs({ http, url: this.#remote!, prefix: ref, onAuth: () => auth });
    return refs.some((r) => r.ref === ref);
  }

  /** Make sure the repo exists and we know its remote. Returns whether it was just created (and so is empty). */
  async #ensureRepo(): Promise<boolean> {
    const { artifacts, repo: name, description, branch } = this.#options;
    let repo: ArtifactsRepo;
    try {
      repo = await artifacts.get(name);
    } catch (err) {
      if (!isNotFound(err)) throw err;
      const created = await artifacts.create(name, { description, setDefaultBranch: branch });
      this.#remote = created.remote;
      this.#setToken(created.token);
      return true;
    }
    try {
      this.#remote = (await repo.info()).remote;
      return false;
    } finally {
      repo[Symbol.dispose]();
    }
  }

  async #auth(): Promise<{ username: string; password: string }> {
    if (!this.#token || this.#token.expiresAt - Date.now() < TOKEN_REFRESH_MARGIN_MS) {
      const repo = await this.#options.artifacts.get(this.#options.repo);
      try {
        const token = await repo.createToken("write", TOKEN_TTL_SECONDS);
        this.#token = { secret: tokenSecret(token.plaintext), expiresAt: Date.parse(token.expiresAt) };
      } finally {
        repo[Symbol.dispose]();
      }
    }
    // Git Basic auth: any non-empty username, token secret as the password.
    return { username: "x", password: this.#token.secret };
  }

  #setToken(token: string) {
    const expires = Number(new URL(`http://x/?${token.split("?")[1] ?? ""}`).searchParams.get("expires"));
    this.#token = {
      secret: tokenSecret(token),
      expiresAt: expires ? expires * 1000 : Date.now() + TOKEN_TTL_SECONDS * 1000
    };
  }
}
