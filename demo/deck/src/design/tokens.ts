import css from "./tokens.css?raw";

// The numbers layout depends on, read from tokens.css so there's one source:
// the Worker's layout check and the renderer both use these.

/** A numeric token from tokens.css, e.g. token("code-size") → 26. */
export function token(name: string): number {
  const m = new RegExp(`--${name}:\\s*(-?[\\d.]+)`).exec(css);
  if (!m) throw new Error(`no numeric --${name} in tokens.css`);
  return Number(m[1]);
}
