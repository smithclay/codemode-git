import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { accuracy, learningCurve } from "../data";
import type { AgentCard, Visual as VisualSpec } from "../script";
import { theme, WAX } from "../theme";

export function Visual({ visual }: { visual: VisualSpec }) {
  switch (visual.kind) {
    case "lava-wall":
      return <LavaWall title={visual.title} subtitle={visual.subtitle} />;
    case "code-compare":
      return <CodeCompare left={visual.left} right={visual.right} />;
    case "isolate":
      return <Isolate steps={visual.steps} />;
    case "terminal":
      return <Terminal title={visual.title} lines={visual.lines} />;
    case "walkthrough":
      return <Walkthrough left={visual.left} right={visual.right} />;
    case "diagram":
      return <Diagram nodes={visual.nodes} caption={visual.caption} />;
    case "learning-curve":
      return <LearningCurve />;
    case "memory-kinds":
      return <MemoryKinds />;
    case "close":
      return <Close install={visual.install} lines={visual.lines} tagline={visual.tagline} />;
  }
}

/** Fades and lifts children in, starting `delay` frames into the scene. */
function Enter({ delay = 0, children, style }: { delay?: number; children: ReactNode; style?: CSSProperties }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - delay, fps, config: { damping: 200 } });
  return <div style={{ opacity: p, transform: `translateY(${(1 - p) * 24}px)`, ...style }}>{children}</div>;
}

const Stage = ({ children }: { children: ReactNode }) => (
  <AbsoluteFill style={{ padding: "96px 120px 180px", gap: 40 }}>{children}</AbsoluteFill>
);

const Heading = ({ children }: { children: ReactNode }) => (
  <Enter>
    <div style={{ fontSize: 56, fontWeight: 700, letterSpacing: -1 }}>{children}</div>
  </Enter>
);

const Panel = ({ title, children, style }: { title?: string; children: ReactNode; style?: CSSProperties }) => (
  <div style={{ background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 20, padding: 32, ...style }}>
    {title && <div style={{ color: theme.muted, fontSize: 26, marginBottom: 20 }}>{title}</div>}
    {children}
  </div>
);

const Mono = ({ children, size = 28, color = theme.text }: { children: ReactNode; size?: number; color?: string }) => (
  <pre style={{ margin: 0, fontFamily: theme.mono, fontSize: size, lineHeight: 1.45, color, whiteSpace: "pre-wrap" }}>{children}</pre>
);

// ---- Scenes ----

function LavaLamp({ x, y, wax, seed }: { x: number; y: number; wax: string; seed: number }) {
  const t = useCurrentFrame() / 30;
  const blob = (k: number) => {
    const phase = seed * 1.7 + k * 2.1;
    const cy = 92 - ((Math.sin(t * 0.35 + phase) + 1) / 2) * 60;
    const r = 7 + 3 * Math.sin(t * 0.8 + phase);
    return <ellipse key={k} cx={30 + 5 * Math.sin(t * 0.5 + phase)} cy={cy} rx={r} ry={r * 1.25} fill={wax} />;
  };
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d="M18 10 L42 10 L52 104 L8 104 Z" fill="#1d1430" stroke="#3a2d55" strokeWidth={2} />
      <g style={{ filter: "blur(1.5px)" }}>{[0, 1, 2].map(blob)}</g>
      <ellipse cx={30} cy={104} rx={22} ry={6} fill={wax} opacity={0.7} />
      <path d="M8 104 L52 104 L46 128 L14 128 Z" fill="#8a8f99" />
      <path d="M20 0 L40 0 L42 10 L18 10 Z" fill="#8a8f99" />
    </g>
  );
}

function LavaWall({ title, subtitle }: { title: string; subtitle: string }) {
  const lamps = [];
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 20; col++) {
      const i = row * 20 + col;
      lamps.push(<LavaLamp key={i} x={col * 96 + 18} y={row * 150 + 330} wax={WAX[(i * 3) % WAX.length]!} seed={i} />);
    }
  }
  return (
    <AbsoluteFill>
      <svg viewBox="0 0 1920 1080" style={{ position: "absolute", inset: 0, opacity: 0.85 }}>
        {lamps}
      </svg>
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(15,17,21,0.95) 0%, rgba(15,17,21,0.6) 32%, rgba(15,17,21,0) 60%)" }} />
      <div style={{ padding: "110px 120px" }}>
        <Enter>
          <div style={{ fontSize: 104, fontWeight: 800, letterSpacing: -2 }}>{title}</div>
        </Enter>
        <Enter delay={10}>
          <div style={{ fontSize: 44, color: theme.amber, marginTop: 12 }}>{subtitle}</div>
        </Enter>
      </div>
    </AbsoluteFill>
  );
}

function CodeCompare({ left, right }: { left: { title: string; lines: string[] }; right: { title: string; code: string } }) {
  return (
    <Stage>
      <Heading>Code Mode: write code, don't call tools one at a time</Heading>
      <div style={{ display: "flex", gap: 40, flex: 1 }}>
        <Enter delay={8} style={{ flex: 1 }}>
          <Panel title={left.title} style={{ height: "100%" }}>
            {left.lines.map((l, i) => (
              <Enter key={i} delay={14 + i * 8}>
                <Mono size={26} color={l.startsWith("←") ? theme.muted : theme.text}>{l}</Mono>
              </Enter>
            ))}
          </Panel>
        </Enter>
        <Enter delay={40} style={{ flex: 1.2 }}>
          <Panel title={right.title} style={{ height: "100%", borderColor: theme.orange }}>
            <Mono size={26}>{right.code}</Mono>
          </Panel>
        </Enter>
      </div>
    </Stage>
  );
}

function Isolate({ steps }: { steps: string[] }) {
  const frame = useCurrentFrame();
  return (
    <Stage>
      <Heading>Every plan runs in a fresh isolate, then it's gone</Heading>
      <div style={{ display: "flex", gap: 28, alignItems: "center", marginTop: 80 }}>
        {steps.map((s, i) => {
          const last = i === steps.length - 1;
          const fade = last ? interpolate(frame, [150, 230], [1, 0.15], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
          return (
            <Enter key={s} delay={10 + i * 25} style={{ flex: 1, opacity: fade }}>
              <Panel style={{ textAlign: "center", fontSize: 40, borderColor: last ? theme.red : theme.border }}>{s}</Panel>
            </Enter>
          );
        })}
      </div>
    </Stage>
  );
}

function Terminal({ title, lines }: { title: string; lines: string[] }) {
  return (
    <Stage>
      <Enter>
        <Panel title={title}>
          {lines.map((l, i) => (
            <Enter key={i} delay={6 + i * 6}>
              <Mono size={30} color={l.startsWith("Codemode-") ? theme.amber : l.startsWith("$") ? theme.green : theme.text}>
                {l || " "}
              </Mono>
            </Enter>
          ))}
        </Panel>
      </Enter>
    </Stage>
  );
}

function AgentPanel({ card, delay, highlight }: { card: AgentCard; delay: number; highlight?: boolean }) {
  return (
    <Enter delay={delay} style={{ flex: 1 }}>
      <Panel title={card.agent} style={{ height: "100%", borderColor: highlight ? theme.orange : theme.border }}>
        <div style={{ fontSize: 40, fontWeight: 600, lineHeight: 1.25 }}>"{card.question}"</div>
        <div style={{ fontSize: 30, color: theme.muted, marginTop: 28 }}>{card.note}</div>
      </Panel>
    </Enter>
  );
}

function Walkthrough({ left, right }: { left: AgentCard; right: AgentCard }) {
  return (
    <Stage>
      <Heading>Learning from code memory</Heading>
      <div style={{ display: "flex", gap: 40, flex: 1 }}>
        <AgentPanel card={left} delay={8} />
        <AgentPanel card={right} delay={60} highlight />
      </div>
      <Enter delay={120}>
        <Mono size={30} color={theme.amber}>Codemode-Examples: agent-michelle@&lt;sha&gt;</Mono>
      </Enter>
    </Stage>
  );
}

function Diagram({ nodes, caption }: { nodes: string[]; caption: string }) {
  return (
    <Stage>
      <Heading>All on Cloudflare</Heading>
      <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 60 }}>
        {nodes.map((n, i) => (
          <Enter key={n} delay={10 + i * 18} style={{ display: "flex", alignItems: "center", gap: 18, flex: 1 }}>
            <Panel style={{ flex: 1, textAlign: "center", fontSize: 32, padding: 28 }}>{n}</Panel>
            {i < nodes.length - 1 && <div style={{ fontSize: 44, color: theme.orange }}>→</div>}
          </Enter>
        ))}
      </div>
      <Enter delay={110}>
        <Mono size={30} color={theme.amber}>{caption}</Mono>
      </Enter>
    </Stage>
  );
}

function Bars({ rows, max, unit, delay }: { rows: { label: string; a: number; b: number }[]; max: number; unit: string; delay: number }) {
  const frame = useCurrentFrame();
  const grow = (i: number) => interpolate(frame, [delay + i * 10, delay + i * 10 + 30], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      {rows.map((r, i) => (
        <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ width: 200, fontSize: 26, color: theme.muted }}>{r.label}</div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
            {[
              { v: r.a, c: theme.muted },
              { v: r.b, c: theme.orange }
            ].map(({ v, c }, k) => (
              <div key={k} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ height: 24, width: `${(v / max) * 100 * grow(i)}%`, background: c, borderRadius: 6 }} />
                <div style={{ fontSize: 22, color: c, opacity: grow(i) }}>
                  {v}
                  {unit}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function LearningCurve() {
  return (
    <Stage>
      <Heading>DABstep: 450 tasks, same model and prompt</Heading>
      <div style={{ display: "flex", gap: 40, flex: 1 }}>
        <Enter delay={8} style={{ flex: 1 }}>
          <Panel title="Accuracy (Adyen's official scorer)" style={{ height: "100%" }}>
            <Bars rows={accuracy.map((r) => ({ label: r.level, a: r.baseline, b: r.examples }))} max={100} unit="%" delay={20} />
          </Panel>
        </Enter>
        <Enter delay={150} style={{ flex: 1 }}>
          <Panel title="Median tokens per task (k), by position in the run" style={{ height: "100%" }}>
            <Bars rows={learningCurve.map((r) => ({ label: `tasks ${r.tasks}`, a: r.baseline, b: r.examples }))} max={350} unit="k" delay={170} />
          </Panel>
        </Enter>
      </div>
      <Enter delay={30}>
        <div style={{ fontSize: 26, color: theme.muted }}>
          <span style={{ color: theme.muted }}>■ baseline</span>
          <span style={{ color: theme.orange, marginLeft: 32 }}>■ with code memory</span>
        </div>
      </Enter>
    </Stage>
  );
}

function MemoryKinds() {
  return (
    <Stage>
      <Heading>Which memory works</Heading>
      <div style={{ display: "flex", gap: 40, flex: 1 }}>
        <Enter delay={10} style={{ flex: 1 }}>
          <Panel title="Distilled, verified, shared skills" style={{ height: "100%", borderColor: theme.red }}>
            <div style={{ fontSize: 34, lineHeight: 1.4 }}>One wrong skill passed verification. Later agents copied it, and got the same answer wrong.</div>
          </Panel>
        </Enter>
        <Enter delay={70} style={{ flex: 1 }}>
          <Panel title="Raw runs, labeled unverified" style={{ height: "100%", borderColor: theme.green }}>
            <div style={{ fontSize: 34, lineHeight: 1.4 }}>Each agent still writes and runs its own code. Every answer links to the runs that informed it.</div>
          </Panel>
        </Enter>
      </div>
    </Stage>
  );
}

function Close({ install, lines, tagline }: { install: string; lines: string[]; tagline: string }) {
  return (
    <Stage>
      <Enter>
        <Panel>
          <Mono size={34} color={theme.green}>$ {install}</Mono>
        </Panel>
      </Enter>
      <Enter delay={20}>
        <Panel>
          {lines.map((l) => (
            <Mono key={l} size={28}>{l}</Mono>
          ))}
        </Panel>
      </Enter>
      <Enter delay={200}>
        <div style={{ fontSize: 72, fontWeight: 800, color: theme.amber, marginTop: 30, letterSpacing: -1 }}>{tagline}</div>
      </Enter>
    </Stage>
  );
}
