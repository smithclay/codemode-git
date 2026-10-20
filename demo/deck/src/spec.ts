// A slide, as the model's Code Mode program returns it: a few elements on a
// 1920×1080 canvas, drawn by the client with the demo video's look. Shared by
// the Worker (which checks a spec before accepting it) and the client (which
// draws it), so "fits on the slide" means the same thing in both.

import { token } from "./design/tokens";

export const W = 1920;
export const H = 1080;
export const MARGIN = 60;
export const MAX_WORDS = 45;
export const MAX_ELEMENTS = 40;
/** Where the kicker label sits: its vertical middle at y. Its size is a design token. */
export const KICKER = { x: 120, y: 110, size: token("kicker-size") };

export const COLORS = ["text", "muted", "orange", "amber", "green", "red"] as const;
export type Color = (typeof COLORS)[number];

export type Text = {
  type: "text";
  x: number;
  y: number;
  text: string;
  size?: number;
  color?: Color;
  align?: "start" | "middle" | "end";
  bold?: boolean;
  mono?: boolean;
};
export type Box = { type: "box"; x: number; y: number; w: number; h: number; label?: string; sub?: string; color?: Color; dashed?: boolean };
export type Arrow = { type: "arrow"; x1: number; y1: number; x2: number; y2: number; color?: Color; dashed?: boolean };
export type Agent = { type: "agent"; x: number; y: number; r?: number; color?: Color; label?: string };
export type Series = { label: string; values: number[]; color?: Color };
export type Chart = { type: "bars" | "line"; x: number; y: number; w: number; h: number; categories: string[]; series: Series[]; unit?: string };
export type Code = { type: "code"; x: number; y: number; w: number; lines: string[]; title?: string };
export type Element = Text | Box | Arrow | Agent | Chart | Code;

export type Slide = { kicker?: string; elements: Element[] };

/** Where elements end up, in canvas pixels, for bounds and overlap checks. */
type Rect = { x: number; y: number; w: number; h: number; what: string };

export const TEXT_SIZE = token("text-size");
export const textSize = (t: Text) => t.size ?? TEXT_SIZE;
/** A width estimate: good enough to catch text running off the slide. */
export const textWidth = (t: Text) => t.text.length * textSize(t) * (t.mono ? 0.6 : 0.52);
export const CODE_SIZE = token("code-size");
export const CODE_LINE = token("code-line");
export const codeHeight = (c: Code) => (c.title ? 40 : 0) + c.lines.length * CODE_LINE + 40;

function rectOf(e: Element, i: number): Rect | null {
  const what = `elements[${i}] (${e.type})`;
  switch (e.type) {
    case "text": {
      const w = textWidth(e), h = textSize(e) * 1.25;
      const x = e.align === "start" ? e.x : e.align === "end" ? e.x - w : e.x - w / 2;
      return { x, y: e.y - h / 2, w, h, what };
    }
    case "box":
    case "bars":
    case "line":
      return { x: e.x, y: e.y, w: e.w, h: e.h, what };
    case "agent": {
      const r = e.r ?? 46;
      return { x: e.x - r, y: e.y - r, w: 2 * r, h: 2 * r + (e.label ? 50 : 0), what };
    }
    case "code":
      return { x: e.x, y: e.y, w: e.w, h: codeHeight(e), what };
    case "arrow":
      return null;
  }
}

const inside = (a: Rect, b: Rect) => a.x >= b.x - 1 && a.y >= b.y - 1 && a.x + a.w <= b.x + b.w + 1 && a.y + a.h <= b.y + b.h + 1;
const overlap = (a: Rect, b: Rect) =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 4 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 4;

const words = (s: string | undefined) => (s ? s.split(/\s+/).filter(Boolean).length : 0);

/** Every problem that would make the slide look broken, or [] when it's fine. */
export function check(slide: unknown): string[] {
  const problems: string[] = [];
  const s = slide as Slide;
  if (!s || typeof s !== "object" || !Array.isArray(s.elements)) return ["return { kicker?, elements: [...] }"];
  if (!s.elements.length) problems.push("elements is empty");
  if (s.elements.length > MAX_ELEMENTS) problems.push(`${s.elements.length} elements; keep it under ${MAX_ELEMENTS}`);

  let total = words(s.kicker);
  // The kicker is drawn top-left (see SlideView), so elements must leave it room.
  const rects: Rect[] = s.kicker ? [{ x: KICKER.x, y: KICKER.y - 20, w: s.kicker.length * KICKER.size * 0.62, h: 40, what: "the kicker" }] : [];
  s.elements.forEach((e, i) => {
    const what = `elements[${i}]`;
    if (!e || typeof e !== "object") return problems.push(`${what} is not an object`);
    if (!["text", "box", "arrow", "agent", "bars", "line", "code"].includes(e.type)) return problems.push(`${what}.type "${(e as { type: unknown }).type}" is unknown`);
    if ("color" in e && e.color !== undefined && !COLORS.includes(e.color)) problems.push(`${what}.color must be one of ${COLORS.join(", ")}`);
    const nums = Object.entries(e).filter(([k]) => ["x", "y", "w", "h", "x1", "y1", "x2", "y2", "r", "size"].includes(k));
    if (nums.some(([, v]) => typeof v !== "number" || !Number.isFinite(v))) return problems.push(`${what} has a non-numeric position or size`);
    if (e.type === "text") {
      if (typeof e.text !== "string" || !e.text) return problems.push(`${what}.text is empty`);
      total += words(e.text);
      if (/\b(null|undefined|NaN)\b|\[object /.test(e.text)) problems.push(`${what}.text "${e.text.slice(0, 40)}" looks like debug output; inspect data with console.log, and return only the finished slide`);
    }
    if (e.type === "box") total += words(e.label) + words(e.sub);
    if (e.type === "agent") total += words(e.label);
    if (e.type === "bars" || e.type === "line") {
      if (!Array.isArray(e.categories) || !Array.isArray(e.series) || !e.series.length) return problems.push(`${what} needs categories and series`);
      for (const sr of e.series) {
        if (!Array.isArray(sr.values) || sr.values.length !== e.categories.length) problems.push(`${what} series "${sr.label}" needs one value per category`);
      }
    }
    if (e.type === "code" && (!Array.isArray(e.lines) || !e.lines.length)) return problems.push(`${what}.lines is empty`);
    if (e.type === "code") {
      const longest = Math.max(...e.lines.map((l) => l.length));
      if (longest * CODE_SIZE * 0.6 + 60 > e.w) problems.push(`${what}: a ${longest}-char line is wider than w=${e.w}; widen it or shorten lines`);
    }
    if (e.type === "arrow") {
      for (const [x, y] of [[e.x1, e.y1], [e.x2, e.y2]] as const) {
        if (x < MARGIN || x > W - MARGIN || y < MARGIN || y > H - MARGIN) problems.push(`${what} (arrow) ends off the slide at (${x}, ${y})`);
      }
    }
    const r = rectOf(e, i);
    if (!r) return;
    if (r.x < MARGIN || r.y < MARGIN || r.x + r.w > W - MARGIN || r.y + r.h > H - MARGIN) {
      problems.push(`${r.what} runs off the slide: spans x ${Math.round(r.x)}–${Math.round(r.x + r.w)}, y ${Math.round(r.y)}–${Math.round(r.y + r.h)}; keep inside ${MARGIN}–${W - MARGIN} × ${MARGIN}–${H - MARGIN}`);
    }
    rects.push(r);
  });
  if (total > MAX_WORDS) problems.push(`${total} words on the slide; keep it under ${MAX_WORDS}. The speaker notes carry the detail.`);

  // Overlaps, except an element drawn inside a box or chart on purpose.
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i]!, b = rects[j]!;
      if (overlap(a, b) && !inside(a, b) && !inside(b, a)) problems.push(`${a.what} overlaps ${b.what}`);
    }
  }
  return problems;
}
