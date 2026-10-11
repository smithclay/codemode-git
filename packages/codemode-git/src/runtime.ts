import { CodemodeRuntime as BaseRuntime } from "@cloudflare/codemode";

export type InstallableSnippet = {
  name: string;
  description: string;
  /** An async function source, e.g. `async (input) => { ... }`. */
  code: string;
  inputSchema?: unknown;
  /** Connector names the snippet calls. `codemode.run` refuses it if any are missing. */
  connectors?: string[];
};

/**
 * Drop-in replacement for codemode's `CodemodeRuntime` facet that can install
 * snippets whose code came from somewhere other than this runtime's own runs
 * (the stock `saveSnippet` can only promote a local execution).
 *
 * Export it from the Worker entry instead of the stock class:
 *
 *   export { CodemodeRuntime } from "codemode-git";
 *
 * This writes to the facet's own `cm_snippets` table, so it tracks
 * @cloudflare/codemode's storage layout. It's meant to be upstreamed as
 * `runtime.installSnippet()`.
 */
export class CodemodeRuntime extends BaseRuntime {
  async installSnippet(snippet: InstallableSnippet): Promise<void> {
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO cm_snippets
         (name, description, code, saved_at, input_schema, connectors)
       VALUES (?, ?, ?, ?, ?, ?)`,
      snippet.name,
      snippet.description,
      snippet.code,
      Date.now(),
      snippet.inputSchema === undefined ? null : JSON.stringify(snippet.inputSchema),
      snippet.connectors ? JSON.stringify(snippet.connectors) : null
    );
  }
}

type FacetCapableState = DurableObjectState & {
  exports?: { CodemodeRuntime?: unknown };
  facets: { get(name: string, init: () => { class: unknown }): unknown };
};

/**
 * The runtime facet for `name`, the same one `createCodemodeRuntime({ ctx, name })`
 * uses. Mirrors codemode's internal facet naming (`codemode:<name>`).
 */
export function runtimeFacet(ctx: DurableObjectState, name = "default"): CodemodeRuntime {
  const state = ctx as FacetCapableState;
  const runtimeClass = state.exports?.CodemodeRuntime;
  if (!runtimeClass) {
    throw new Error('CodemodeRuntime is not exported from this Worker entry. Add: export { CodemodeRuntime } from "codemode-git";');
  }
  return state.facets.get(`codemode:${name}`, () => ({ class: runtimeClass })) as CodemodeRuntime;
}
