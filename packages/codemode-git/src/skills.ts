import { runtimeFacet, type InstallableSnippet } from "./runtime";

// Layout of the shared skills repo. The curator writes it; agents read it.
export const SKILLS_INDEX = "index.json";
export const skillPath = (name: string, file: "snippet.js" | "meta.json" | "provenance.json") =>
  `skills/${name}/${file}`;

export type SkillMeta = Omit<InstallableSnippet, "code"> & {
  /** Agent commits the skill was mined from. */
  sources: { repo: string; sha: string }[];
  /** How many source runs the skill reproduced when it was verified. */
  verified: { passed: number; total: number };
  /** Curator's expected reusability, 0 (one-off) to 2 (broadly reusable). The index is sorted by it. */
  reusability?: number;
};

export type SkillsIndex = { skills: SkillMeta[] };

export type SyncSkillsOptions = {
  ctx: DurableObjectState;
  artifacts: Artifacts;
  /** Skills repo name. Defaults to "skills". */
  repo?: string;
  /** Branch, tag or sha to read. Defaults to "main". Pin a sha for reproducible agents. */
  ref?: string;
  /** Connector names this agent has. Skills needing others are skipped. */
  connectors: string[];
  /** Runtime name, if the agent uses a non-default one. */
  runtimeName?: string;
};

export type SyncSkillsResult = {
  /** The commit the skills were read from. */
  sha: string | null;
  installed: string[];
  skipped: { name: string; missing: string[] }[];
};

/**
 * Install the shared skill library into this agent's runtime as snippets, so
 * the model finds them with `codemode.search` and runs them with
 * `codemode.run(name, input)`. A missing skills repo is not an error: it just
 * means nothing has been curated yet.
 */
export async function syncSkills(options: SyncSkillsOptions): Promise<SyncSkillsResult> {
  const { artifacts, ref = "main", connectors } = options;
  const result: SyncSkillsResult = { sha: null, installed: [], skipped: [] };

  let repo: ArtifactsRepo;
  try {
    repo = await artifacts.get(options.repo ?? "skills");
  } catch {
    return result;
  }
  try {
    const [head] = await repo.log({ ref, limit: 1 }).catch(() => []);
    if (!head) return result;
    result.sha = head.hash;

    const indexFile = await repo.readFile({ ref: head.hash, path: SKILLS_INDEX });
    if (!indexFile) return result;
    const index = JSON.parse(await indexFile.text()) as SkillsIndex;

    const runtime = runtimeFacet(options.ctx, options.runtimeName);
    const available = new Set(connectors);
    for (const meta of index.skills) {
      const missing = (meta.connectors ?? []).filter((c) => !available.has(c));
      if (missing.length) {
        result.skipped.push({ name: meta.name, missing });
        continue;
      }
      const code = await repo.readFile({ ref: head.hash, path: skillPath(meta.name, "snippet.js") });
      if (!code) continue;
      await runtime.installSnippet({
        name: meta.name,
        description: meta.description,
        code: await code.text(),
        inputSchema: meta.inputSchema,
        connectors: meta.connectors
      });
      result.installed.push(meta.name);
    }
    return result;
  } finally {
    repo[Symbol.dispose]();
  }
}
