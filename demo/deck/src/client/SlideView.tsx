import { token } from "../design/tokens";
import { codeHeight, COLORS, H, KICKER, textSize, W, CODE_LINE, type Chart, type Color, type Element, type Slide } from "../spec";

// Draws a slide spec as SVG: positions come from the spec, and the look comes
// from ../design/slide.css (classes) and ../design/tokens.css. The style
// follows the demo video: rounded panels, orange arrows, robots in rings.

const RADIUS = token("radius-panel");
const BAR_RADIUS = token("radius-bar");
const c = (color: Color | undefined) => (color ? `c-${color}` : "");
const cls = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(" ");

export function SlideView({ slide }: { slide: Slide }) {
  return (
    <svg className="slide" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
      <defs>
        {/* Markers draw in their own context, so each color gets one. */}
        {COLORS.map((color) => (
          <marker key={color} id={`arrow-${color}`} className={c(color)} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path className="arrowhead" d="M0 0 L10 5 L0 10 z" />
          </marker>
        ))}
      </defs>
      {slide.kicker && (
        <text className="kicker" x={KICKER.x} y={KICKER.y}>
          {slide.kicker}
        </text>
      )}
      {slide.elements.map((e, i) => (
        <El key={i} e={e} />
      ))}
    </svg>
  );
}

function El({ e }: { e: Element }) {
  switch (e.type) {
    case "text":
      return (
        <text className={cls("t", e.bold && "bold", e.mono && "mono", c(e.color))} x={e.x} y={e.y} fontSize={textSize(e)} textAnchor={e.align ?? "middle"}>
          {e.text}
        </text>
      );
    case "box":
      return (
        <g className={cls("box", e.dashed && "dashed", c(e.color))}>
          <rect x={e.x} y={e.y} width={e.w} height={e.h} rx={RADIUS} />
          {e.label && <text className="label" x={e.x + e.w / 2} y={e.y + e.h / 2 - (e.sub ? 16 : 0)} textAnchor="middle">{e.label}</text>}
          {e.sub && <text className="sub mono" x={e.x + e.w / 2} y={e.y + e.h / 2 + 24} textAnchor="middle">{e.sub}</text>}
        </g>
      );
    case "arrow": {
      const color = e.color ?? "orange";
      return <line className={cls("arrow", e.dashed && "dashed", c(color))} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} markerEnd={`url(#arrow-${color})`} />;
    }
    case "agent": {
      const r = e.r ?? 46;
      return (
        <g className={cls("agent", c(e.color))}>
          <circle cx={e.x} cy={e.y} r={r} />
          <text x={e.x} y={e.y + r * 0.06} fontSize={r * 1.15} textAnchor="middle">🤖</text>
          {e.label && <text className="label mono" x={e.x} y={e.y + r + 30} textAnchor="middle">{e.label}</text>}
        </g>
      );
    }
    case "bars":
      return <Bars c={e} />;
    case "line":
      return <Line c={e} />;
    case "code": {
      const top = e.y + (e.title ? 40 : 0) + 20;
      return (
        <g className="code">
          <rect x={e.x} y={e.y} width={e.w} height={codeHeight(e)} rx={RADIUS} />
          {e.title && <text className="title mono" x={e.x + 30} y={e.y + 32}>{e.title}</text>}
          {e.lines.map((l, i) => (
            <text key={i} className={cls("line mono", l.startsWith("$") && "cmd", /error|✗/i.test(l) && "err")} x={e.x + 30} y={top + CODE_LINE * (i + 0.5)}>
              {l}
            </text>
          ))}
        </g>
      );
    }
  }
}

// Series colors when the spec doesn't name them: the baseline reads muted, the result orange.
const seriesColor = (ch: Chart, i: number): Color => ch.series[i]!.color ?? (["muted", "orange", "amber", "green"] as const)[i % 4];
const fmt = (v: number, unit = "") => `${Number.isInteger(v) ? v : v.toFixed(1)}${unit}`;

function Legend({ ch }: { ch: Chart }) {
  return (
    <g>
      {ch.series.map((s, i) => (
        <g key={s.label} className={c(seriesColor(ch, i))}>
          <rect className="swatch" x={ch.x + ch.w - 300} y={ch.y + i * 40} width={22} height={22} rx={5} />
          <text className="legend" x={ch.x + ch.w - 266} y={ch.y + 11 + i * 40}>{s.label}</text>
        </g>
      ))}
    </g>
  );
}

function Bars({ c: ch }: { c: Chart }) {
  const max = Math.max(...ch.series.flatMap((s) => s.values)) * 1.15 || 1;
  const base = ch.y + ch.h - 50, top = ch.y + 60 + ch.series.length * 40;
  const group = ch.w / ch.categories.length;
  const bar = Math.min(150, (group * 0.7) / ch.series.length);
  return (
    <g className="chart">
      <Legend ch={ch} />
      <line className="axis" x1={ch.x} y1={base} x2={ch.x + ch.w} y2={base} />
      {ch.categories.map((cat, ci) => {
        const gx = ch.x + ci * group + (group - bar * ch.series.length - 16 * (ch.series.length - 1)) / 2;
        return (
          <g key={cat}>
            {ch.series.map((s, si) => {
              const v = s.values[ci] ?? 0;
              const h = (v / max) * (base - top);
              const x = gx + si * (bar + 16);
              return (
                <g key={s.label} className={c(seriesColor(ch, si))}>
                  <rect className="bar" x={x} y={base - h} width={bar} height={h} rx={BAR_RADIUS} />
                  <text className="value" x={x + bar / 2} y={base - h - 30} textAnchor="middle">{fmt(v, ch.unit)}</text>
                </g>
              );
            })}
            <text className="category" x={ch.x + ci * group + group / 2} y={base + 30} textAnchor="middle">{cat}</text>
          </g>
        );
      })}
    </g>
  );
}

function Line({ c: ch }: { c: Chart }) {
  const max = Math.max(...ch.series.flatMap((s) => s.values)) * 1.1 || 1;
  const base = ch.y + ch.h - 50, top = ch.y + 40 + ch.series.length * 40;
  const xs = ch.categories.map((_, i) => ch.x + 60 + (i * (ch.w - 120)) / Math.max(1, ch.categories.length - 1));
  const yOf = (v: number) => base - (v / max) * (base - top);
  return (
    <g className="chart">
      <Legend ch={ch} />
      <line className="axis" x1={ch.x} y1={base} x2={ch.x + ch.w} y2={base} />
      {ch.categories.map((cat, i) => (
        <text key={cat} className="tick" x={xs[i]!} y={base + 30} textAnchor="middle">{cat}</text>
      ))}
      {ch.series.map((s, si) => (
        <g key={s.label} className={cls("series", si > 0 && "accent", c(seriesColor(ch, si)))}>
          <path d={s.values.map((v, i) => `${i ? "L" : "M"}${xs[i]} ${yOf(v)}`).join(" ")} />
          {s.values.map((v, i) => (
            <circle key={i} cx={xs[i]} cy={yOf(v)} r={8} />
          ))}
        </g>
      ))}
    </g>
  );
}
