// Minimal in-memory filesystem implementing the subset of `fs.promises`
// that isomorphic-git needs. Workers have no disk, so the working tree and
// object store live here for as long as the Durable Object stays warm.

type Entry =
  | { kind: "file"; data: Uint8Array; mtimeMs: number }
  | { kind: "dir"; mtimeMs: number };

class FsError extends Error {
  constructor(
    readonly code: string,
    path: string
  ) {
    super(`${code}: ${path}`);
  }
}

class Stats {
  constructor(private entry: Entry) {}
  get size() {
    return this.entry.kind === "file" ? this.entry.data.byteLength : 0;
  }
  get mode() {
    return this.entry.kind === "file" ? 0o100644 : 0o040000;
  }
  get mtimeMs() {
    return this.entry.mtimeMs;
  }
  get ctimeMs() {
    return this.entry.mtimeMs;
  }
  readonly ino = 0;
  readonly uid = 0;
  readonly gid = 0;
  readonly dev = 0;
  isFile() {
    return this.entry.kind === "file";
  }
  isDirectory() {
    return this.entry.kind === "dir";
  }
  isSymbolicLink() {
    return false;
  }
}

function normalize(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

function parentOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i <= 0 ? "/" : path.slice(0, i);
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class MemoryFS {
  #entries = new Map<string, Entry>([["/", { kind: "dir", mtimeMs: Date.now() }]]);

  readonly promises = {
    readFile: this.readFile.bind(this),
    writeFile: this.writeFile.bind(this),
    unlink: this.unlink.bind(this),
    readdir: this.readdir.bind(this),
    mkdir: this.mkdir.bind(this),
    rmdir: this.rmdir.bind(this),
    stat: this.stat.bind(this),
    lstat: this.stat.bind(this),
    readlink: async (path: string): Promise<never> => {
      throw new FsError("ENOENT", path);
    },
    symlink: async (_target: string, path: string): Promise<never> => {
      throw new FsError("EPERM", path);
    },
    chmod: async () => {}
  };

  #get(path: string): Entry {
    const entry = this.#entries.get(normalize(path));
    if (!entry) throw new FsError("ENOENT", path);
    return entry;
  }

  async readFile(path: string, options?: string | { encoding?: string }) {
    const entry = this.#get(path);
    if (entry.kind !== "file") throw new FsError("EISDIR", path);
    const encoding = typeof options === "string" ? options : options?.encoding;
    if (encoding === "utf8" || encoding === "utf-8") return decoder.decode(entry.data);
    // isomorphic-git expects Buffers; Workers provide them under nodejs_compat.
    const NodeBuffer = (globalThis as { Buffer?: { from(data: Uint8Array): Uint8Array } }).Buffer;
    return NodeBuffer ? NodeBuffer.from(entry.data) : entry.data.slice();
  }

  async writeFile(path: string, data: string | Uint8Array) {
    const target = normalize(path);
    await this.mkdir(parentOf(target), { recursive: true });
    const bytes = typeof data === "string" ? encoder.encode(data) : new Uint8Array(data);
    this.#entries.set(target, { kind: "file", data: bytes, mtimeMs: Date.now() });
  }

  async unlink(path: string) {
    if (this.#get(path).kind !== "file") throw new FsError("EISDIR", path);
    this.#entries.delete(normalize(path));
  }

  async readdir(path: string): Promise<string[]> {
    const dir = normalize(path);
    if (this.#get(dir).kind !== "dir") throw new FsError("ENOTDIR", path);
    const prefix = dir === "/" ? "/" : `${dir}/`;
    const names: string[] = [];
    for (const key of this.#entries.keys()) {
      if (key !== dir && key.startsWith(prefix) && !key.slice(prefix.length).includes("/")) {
        names.push(key.slice(prefix.length));
      }
    }
    return names;
  }

  async mkdir(path: string, options?: { recursive?: boolean }) {
    const target = normalize(path);
    const existing = this.#entries.get(target);
    if (existing) {
      if (existing.kind === "dir" && options?.recursive) return;
      throw new FsError("EEXIST", path);
    }
    const parent = parentOf(target);
    if (!this.#entries.has(parent)) {
      if (!options?.recursive) throw new FsError("ENOENT", parent);
      await this.mkdir(parent, { recursive: true });
    }
    this.#entries.set(target, { kind: "dir", mtimeMs: Date.now() });
  }

  async rmdir(path: string) {
    if ((await this.readdir(path)).length > 0) throw new FsError("ENOTEMPTY", path);
    this.#entries.delete(normalize(path));
  }

  async stat(path: string) {
    return new Stats(this.#get(path));
  }
}
