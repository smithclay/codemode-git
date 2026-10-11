import git from "isomorphic-git";
import http from "isomorphic-git/http/web";
import type { CommitContent } from "./format";
import { MemoryFS } from "./memory-fs";

/** Where commits go. Swappable so the plugin isn't tied to one git host. */
export interface GitSink {
  /** Commit `content` on top of the branch head and publish it. Returns the commit sha. */
  commit(content: CommitContent): Promise<string>;
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

function isNotFound(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "NOT_FOUND";
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

  commit(content: CommitContent): Promise<string> {
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

  async #commitOnce({ message, files, timestamp }: CommitContent): Promise<string> {
    const fs = await this.#checkout();
    for (const [path, contents] of Object.entries(files)) {
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
    const pushedBefore = await this.#ensureRepo();
    if (pushedBefore) {
      const auth = await this.#auth();
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

  /** Make sure the repo exists and we know its remote. Returns whether it has ever been pushed to. */
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
      return false;
    }
    try {
      const info = await repo.info();
      this.#remote = info.remote;
      return info.lastPushAt !== null;
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
