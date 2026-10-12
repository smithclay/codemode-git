import type { ReactNode } from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { accuracy, learningCurve, walkthrough } from "../data";
import type { Cue } from "../Demo";
import type { Visual as VisualKind } from "../script";
import { theme, WAX } from "../theme";

// One idea per scene, as a diagram. On-screen text is a few words at most;
// the voiceover carries the detail. Animations key off `cue(word)`, the time
// that word is spoken.

export function Visual({ visual, cue }: { visual: VisualKind; cue: Cue }) {
  const scenes: Record<VisualKind, () => ReactNode> = {
    thesis: () => <Thesis cue={cue} />,
    hook: () => <Hook cue={cue} />,
    vanish: () => <Vanish cue={cue} />,
    "code-mode": () => <CodeMode cue={cue} />,
    gap: () => <Gap cue={cue} />,
    memory: () => <Memory cue={cue} />,
    "under-the-hood": () => <UnderTheHood cue={cue} />,
    repo: () => <RepoLog />,
    scale: () => <Scale />,
    recall: () => <Recall cue={cue} />,
    walkthrough: () => <Walkthrough cue={cue} />,
    curve: () => <Curve cue={cue} />,
    accuracy: () => <Accuracy cue={cue} />,
    contagion: () => <Contagion cue={cue} />,
    close: () => <Close cue={cue} />
  };
  return <AbsoluteFill>{scenes[visual]()}</AbsoluteFill>;
}

// ---- Timing helpers ----

function useSeconds() {
  return useCurrentFrame() / useVideoConfig().fps;
}

/** 0 → 1 spring starting at `at` seconds. */
function useIn(at: number) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - at * fps, fps, config: { damping: 200 } });
}

/** Linear 0 → 1 between two times, clamped. */
const ramp = (t: number, from: number, to: number) =>
  interpolate(t, [from, to], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

// ---- Primitives (all in a 1920×1080 SVG) ----

const Canvas = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 1920 1080" style={{ position: "absolute", inset: 0, fontFamily: theme.sans }}>
    <defs>
      <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0 0 L10 5 L0 10 z" fill={theme.orange} />
      </marker>
      <marker id="arrow-muted" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0 0 L10 5 L0 10 z" fill={theme.muted} />
      </marker>
    </defs>
    {children}
  </svg>
);

function Label({ x, y, children, size = 34, color = theme.text, anchor = "middle", weight = 600, mono, opacity = 1 }: {
  x: number; y: number; children: ReactNode; size?: number; color?: string; anchor?: "start" | "middle" | "end"; weight?: number; mono?: boolean; opacity?: number;
}) {
  return (
    <text x={x} y={y} fontSize={size} fill={color} textAnchor={anchor} fontWeight={weight} opacity={opacity} fontFamily={mono ? theme.mono : theme.sans} dominantBaseline="middle">
      {children}
    </text>
  );
}

function Box({ x, y, w, h, label, sub, p = 1, stroke = theme.border, fill = theme.panel, size = 30 }: {
  x: number; y: number; w: number; h: number; label?: ReactNode; sub?: ReactNode; p?: number; stroke?: string; fill?: string; size?: number;
}) {
  return (
    <g opacity={p} transform={`translate(${x + w / 2} ${y + h / 2}) scale(${0.92 + 0.08 * p}) translate(${-(x + w / 2)} ${-(y + h / 2)})`}>
      <rect x={x} y={y} width={w} height={h} rx={18} fill={fill} stroke={stroke} strokeWidth={2.5} />
      {label && <Label x={x + w / 2} y={y + h / 2 - (sub ? 16 : 0)} size={size}>{label}</Label>}
      {sub && <Label x={x + w / 2} y={y + h / 2 + 24} size={20} color={theme.muted} weight={400} mono>{sub}</Label>}
    </g>
  );
}

/** A straight arrow that draws itself as `p` goes 0 → 1. */
function Arrow({ x1, y1, x2, y2, p, color = theme.orange, dashed, width = 4 }: {
  x1: number; y1: number; x2: number; y2: number; p: number; color?: string; dashed?: boolean; width?: number;
}) {
  if (p <= 0) return null;
  const len = Math.hypot(x2 - x1, y2 - y1);
  return (
    <line
      x1={x1} y1={y1}
      x2={x1 + (x2 - x1) * p} y2={y1 + (y2 - y1) * p}
      stroke={color} strokeWidth={width} strokeLinecap="round"
      strokeDasharray={dashed ? "10 10" : undefined}
      markerEnd={p > 0.98 ? `url(#${color === theme.orange ? "arrow" : "arrow-muted"})` : undefined}
      opacity={Math.min(1, len > 0 ? 1 : 0)}
    />
  );
}

/** A dot travelling along a segment, looping every `period` seconds. */
function Packet({ x1, y1, x2, y2, t, start, period = 1.6, color = theme.amber, r = 9 }: {
  x1: number; y1: number; x2: number; y2: number; t: number; start: number; period?: number; color?: string; r?: number;
}) {
  if (t < start) return null;
  const f = ((t - start) % period) / period;
  return <circle cx={x1 + (x2 - x1) * f} cy={y1 + (y2 - y1) * f} r={r} fill={color} opacity={Math.sin(f * Math.PI)} />;
}

const Kicker = ({ children, p = 1 }: { children: ReactNode; p?: number }) => (
  <Label x={120} y={110} size={30} color={theme.orange} anchor="start" weight={700} opacity={p}>
    {children}
  </Label>
);

// ---- Lava lamps ----

function LavaLamp({ x, y, wax, seed, scale = 1 }: { x: number; y: number; wax: string; seed: number; scale?: number }) {
  const t = useSeconds();
  const blob = (k: number) => {
    const phase = seed * 1.7 + k * 2.1;
    const cy = 92 - ((Math.sin(t * 0.35 + phase) + 1) / 2) * 60;
    const r = 7 + 3 * Math.sin(t * 0.8 + phase);
    return <ellipse key={k} cx={30 + 5 * Math.sin(t * 0.5 + phase)} cy={cy} rx={r} ry={r * 1.25} fill={wax} />;
  };
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <path d="M18 10 L42 10 L52 104 L8 104 Z" fill="#1d1430" stroke="#3a2d55" strokeWidth={2} />
      <g style={{ filter: "blur(1.5px)" }}>{[0, 1, 2].map(blob)}</g>
      <ellipse cx={30} cy={104} rx={22} ry={6} fill={wax} opacity={0.7} />
      <path d="M8 104 L52 104 L46 128 L14 128 Z" fill="#8a8f99" />
      <path d="M20 0 L40 0 L42 10 L18 10 Z" fill="#8a8f99" />
    </g>
  );
}

function LavaWall({ opacity = 0.85, top = 330, rows = 5 }: { opacity?: number; top?: number; rows?: number }) {
  const lamps = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < 20; col++) {
      const i = row * 20 + col;
      lamps.push(<LavaLamp key={i} x={col * 96 + 18} y={row * 150 + top} wax={WAX[(i * 3) % WAX.length]!} seed={i} />);
    }
  }
  return <g opacity={opacity}>{lamps}</g>;
}

// ---- Scenes ----

function Hook({ cue }: { cue: Cue }) {
  const t = useSeconds();
  const pSame = useIn(0.3);
  const tFrom = cue("thirty-two", 3.2);
  const tTo = cue("forty-six", 4.6);
  const tHard = cue("hardest", 6.5);
  const tMemory = cue("memory", 11);
  const pFrom = useIn(tFrom - 0.2);
  const value = interpolate(t, [tTo - 0.3, tTo + 0.9], [32.2, 46.2], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const pTo = useIn(tTo - 0.3);
  const pHard = useIn(tHard);
  const pMem = useIn(tMemory - 0.4);
  return (
    <Canvas>
      <Label x={960} y={190} size={36} color={theme.muted} weight={500} opacity={pSame}>
        same model · same prompt · 450 tasks
      </Label>
      <Label x={530} y={470} size={190} color={theme.muted} weight={800} opacity={pFrom}>32.2%</Label>
      <Arrow x1={880} y1={470} x2={1030} y2={470} p={pTo} width={8} />
      <Label x={1390} y={470} size={190} color={theme.orange} weight={800} opacity={pTo}>{value.toFixed(1)}%</Label>
      <Label x={960} y={650} size={54} color={theme.text} weight={600} opacity={pHard}>
        hard tasks: 23.5% → 38.6%
      </Label>
      <g opacity={pMem}>
        <rect x={760} y={790} width={400} height={96} rx={48} fill="none" stroke={theme.amber} strokeWidth={3} />
        <Label x={960} y={838} size={46} color={theme.amber} weight={700}>+ memory</Label>
      </g>
    </Canvas>
  );
}

function Thesis({ cue }: { cue: Cue }) {
  const t = useSeconds();
  // The question builds phrase by phrase, then the name lands under it.
  const parts = [
    { text: "What if Cloudflare Artifacts", at: cue("What if", 0.5), color: theme.text },
    { text: "could make Code Mode in Workers", at: cue("could make", 1.6), color: theme.text },
    { text: "self-improving?", at: cue("self-improving?", 2.6), color: theme.amber }
  ];
  const tKeep = cue("Keep", 6);
  const tName = cue("That's", 9);
  // The subtitle leaves before the name arrives, so they never overlap.
  const settle = ramp(t, tName - 0.1, tName + 0.4);
  const subtitleOut = ramp(t, tName - 0.7, tName - 0.2);
  return (
    <Canvas>
      <LavaWall opacity={0.12 + 0.2 * settle} top={560} rows={4} />
      <defs>
        <linearGradient id="thesis-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.45" stopColor={theme.bg} stopOpacity={1} />
          <stop offset="0.8" stopColor={theme.bg} stopOpacity={0.4} />
        </linearGradient>
      </defs>
      <rect x={0} y={0} width={1920} height={1080} fill="url(#thesis-fade)" />
      {parts.map((p, i) => (
        <Label key={p.text} x={960} y={250 + i * 120 - settle * 40} size={92} weight={800} color={p.color} opacity={ramp(t, p.at - 0.2, p.at + 0.3)}>
          {p.text}
        </Label>
      ))}
      <Label x={960} y={640} size={36} color={theme.muted} weight={500} opacity={ramp(t, tKeep - 0.3, tKeep + 0.3) * (1 - subtitleOut)}>
        keep every run · learn from it
      </Label>
      <Label x={960} y={630} size={56} weight={800} opacity={settle}>Self-Improving Code Mode Workers,</Label>
      <Label x={960} y={700} size={56} weight={800} opacity={settle}>with Artifacts Memory</Label>
      <Label x={960} y={790} size={30} weight={500} mono color={theme.muted} opacity={settle}>codemode-git</Label>
    </Canvas>
  );
}

function Agent({ x, y, r = 46, color = theme.text, p = 1, label }: { x: number; y: number; r?: number; color?: string; p?: number; label?: string }) {
  // A robot in a ring; the ring's color carries state (red wrong, green right, amber highlighted).
  return (
    <g opacity={p}>
      <circle cx={x} cy={y} r={r} fill={theme.panel} stroke={color} strokeWidth={3} />
      <text x={x} y={y + r * 0.06} fontSize={r * 1.15} textAnchor="middle" dominantBaseline="middle">
        🤖
      </text>
      {label && <Label x={x} y={y + r + 30} size={24} color={theme.muted} weight={500} mono>{label}</Label>}
    </g>
  );
}

function Vanish({ cue }: { cue: Cue }) {
  const t = useSeconds();
  const tGone = cue("gone", 4);
  const tThousand = cue("thousand", 5.5);
  const agents = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 6; c++) {
      const i = r * 6 + c;
      const x = 330 + c * 252;
      const y = 300 + r * 250;
      // Each agent writes a snippet, which rises and dissolves, on a loop.
      const cycle = 3.2;
      const local = (t + i * 0.37) % cycle;
      const rise = local / cycle;
      const show = t > 0.6 + i * 0.05;
      agents.push(
        <g key={i}>
          <Agent x={x} y={y} r={40} p={show ? 1 : 0} />
          {show && t > tGone - 2 && (
            <g opacity={Math.max(0, 1 - rise * 1.3)} transform={`translate(${x} ${y - 70 - rise * 70})`}>
              <rect x={-44} y={-22} width={88} height={44} rx={10} fill={theme.panel} stroke={theme.amber} strokeWidth={2} />
              <Label x={0} y={1} size={24} color={theme.amber} mono>{"{ … }"}</Label>
            </g>
          )}
        </g>
      );
    }
  }
  return (
    <Canvas>
      {agents}
      <Label x={960} y={1000 - 40} size={40} color={theme.muted} weight={500} opacity={ramp(t, tThousand - 0.3, tThousand + 0.4)}>
        every agent starts from zero
      </Label>
    </Canvas>
  );
}

function CodeMode({ cue }: { cue: Cue }) {
  const t = useSeconds();
  const tAfter = cue("They write", 7.5);
  const pBefore = useIn(0.2);
  const pAfter = useIn(tAfter - 0.2);
  // Before: model ⇄ tools ping-pong, one round trip per call.
  const trips = 5;
  const leftX = 230, rightX = 760, top = 300, gap = 110;
  const ping = [];
  for (let i = 0; i < trips; i++) {
    const s = 0.8 + i * 0.9;
    const y = top + i * gap;
    ping.push(
      <g key={i}>
        <Arrow x1={leftX + 70} y1={y} x2={rightX - 70} y2={y} p={ramp(t, s, s + 0.35)} color={theme.muted} width={3} />
        <Arrow x1={rightX - 70} y1={y + 40} x2={leftX + 70} y2={y + 40} p={ramp(t, s + 0.4, s + 0.75)} color={theme.muted} width={3} dashed />
      </g>
    );
  }
  const code = ["let cursor = null, n = 0;", "do {", "  const page = await lamps.wall({ cursor });", "  n += page.lamps.filter(flowing).length;", "  cursor = page.nextCursor;", "} while (cursor);", "return n;"];
  return (
    <Canvas>
      <g opacity={pBefore * (1 - 0.55 * pAfter)}>
        <Label x={495} y={170} size={30} color={theme.muted} weight={700}>BEFORE · one tool call at a time</Label>
        <Box x={leftX - 90} y={220} w={180} h={64} label="model" size={28} />
        <Box x={rightX - 90} y={220} w={180} h={64} label="tools" size={28} />
        <line x1={leftX} y1={284} x2={leftX} y2={860} stroke={theme.border} strokeWidth={2} />
        <line x1={rightX} y1={284} x2={rightX} y2={860} stroke={theme.border} strokeWidth={2} />
        {ping}
      </g>
      <g opacity={pAfter}>
        <Label x={1405} y={170} size={30} color={theme.orange} weight={700}>AFTER · Code Mode</Label>
        <Box x={1315} y={220} w={180} h={64} label="model" size={28} stroke={theme.orange} />
        <Arrow x1={1405} y1={290} x2={1405} y2={370} p={ramp(t, tAfter + 0.2, tAfter + 0.6)} />
        <rect x={1040} y={380} width={730} height={330} rx={18} fill={theme.panel} stroke={theme.amber} strokeWidth={2.5} strokeDasharray="12 10" />
        <Label x={1060} y={405} size={20} color={theme.amber} anchor="start" mono>isolate</Label>
        {code.map((line, i) => (
          <Label key={i} x={1075} y={450 + i * 36} size={24} anchor="start" mono weight={400} opacity={ramp(t, tAfter + 0.4 + i * 0.12, tAfter + 0.7 + i * 0.12)}>
            {line}
          </Label>
        ))}
        <Arrow x1={1405} y1={720} x2={1405} y2={800} p={ramp(t, tAfter + 1.4, tAfter + 1.8)} />
        <Box x={1315} y={810} w={180} h={64} label="tools" size={28} stroke={theme.orange} />
      </g>
    </Canvas>
  );
}

function Gap({ cue }: { cue: Cue }) {
  const t = useSeconds();
  const tThrown = cue("thrown", 1.6);
  const tPlan = cue("code goes", 3.4);
  const shrink = ramp(t, tThrown, tThrown + 0.8);
  const fall = ramp(t, tPlan - 0.2, tPlan + 1.2);
  const lines = ["do {", "  const page = await lamps.wall({ cursor });", "  n += page.lamps.filter(flowing).length;", "} while (cursor);"];
  return (
    <Canvas>
      <g opacity={1 - shrink}>
        <rect x={560 + shrink * 200} y={300 + shrink * 120} width={800 - shrink * 400} height={360 - shrink * 240} rx={18} fill={theme.panel} stroke={theme.amber} strokeWidth={2.5} strokeDasharray="12 10" />
        <Label x={590} y={330} size={22} color={theme.amber} anchor="start" mono>isolate</Label>
      </g>
      {lines.map((line, i) => (
        <Label key={i} x={600} y={400 + i * 50 + fall * (300 + i * 60)} size={28} anchor="start" mono weight={400} opacity={1 - fall}>
          {line}
        </Label>
      ))}
      <Label x={960} y={900} size={44} color={theme.red} weight={700} opacity={ramp(t, tPlan, tPlan + 0.6)}>
        the code is gone
      </Label>
    </Canvas>
  );
}

const AGENTS = ["michelle", "matthew", "lena", "omar"];

function RepoCard({ x, y, name, commits, p = 1, highlight }: { x: number; y: number; name: string; commits: number; p?: number; highlight?: boolean }) {
  const dots = [];
  for (let i = 0; i < Math.floor(commits); i++) {
    dots.push(<circle key={i} cx={x + 40 + i * 46} cy={y + 78} r={12} fill={i === Math.floor(commits) - 1 ? theme.amber : theme.orange} />);
    if (i > 0) dots.push(<line key={`l${i}`} x1={x + 40 + (i - 1) * 46} y1={y + 78} x2={x + 40 + i * 46} y2={y + 78} stroke={theme.orange} strokeWidth={3} />);
  }
  return (
    <g opacity={p}>
      <rect x={x} y={y} width={560} height={120} rx={16} fill={theme.panel} stroke={highlight ? theme.amber : theme.border} strokeWidth={2.5} />
      <Label x={x + 24} y={y + 32} size={22} anchor="start" mono color={theme.muted} weight={400}>agent-{name}.git</Label>
      {dots}
    </g>
  );
}

function Memory({ cue }: { cue: Cue }) {
  const t = useSeconds();
  const tCommit = cue("commit", 1.6);
  const tOne = cue("One repo", 9);
  return (
    <Canvas>
      <Kicker p={useIn(0.2)}>PHASE 1 · CODE MEMORY</Kicker>
      <Label x={1380} y={220} size={30} color={theme.orange} weight={700} opacity={useIn(tCommit - 0.5)}>Cloudflare Artifacts</Label>
      {AGENTS.map((name, i) => {
        const y = 300 + i * 170;
        const s = tCommit - 0.3 + i * 0.25;
        const commits = ramp(t, s, s + 6) * 7 + (t > s ? 1 : 0);
        return (
          <g key={name}>
            <Agent x={330} y={y + 60} r={44} label={name} p={useIn(0.3 + i * 0.1)} />
            <Arrow x1={400} y1={y + 60} x2={1080} y2={y + 60} p={ramp(t, s, s + 0.5)} />
            <Packet x1={400} y1={y + 60} x2={1080} y2={y + 60} t={t} start={s + 0.5} period={1.1 + i * 0.15} />
            <RepoCard x={1100} y={y} name={name} commits={Math.min(10, commits)} p={ramp(t, s, s + 0.4)} />
          </g>
        );
      })}
      <Label x={960} y={1000 - 40} size={36} color={theme.muted} weight={500} opacity={ramp(t, tOne - 0.2, tOne + 0.4)}>
        1 repo per agent · 1 writer per repo · 0 merges
      </Label>
    </Canvas>
  );
}

function UnderTheHood({ cue }: { cue: Cue }) {
  const t = useSeconds();
  const steps = [
    { label: "execution ends", sub: "disposeExecution()", at: cue("connector", 1.5) },
    { label: "Durable Object", sub: "SQLite outbox", at: cue("outbox", 4) },
    { label: "isomorphic-git", sub: "push, in order", at: cue("git pushes", 6.5) },
    { label: "Artifacts repo", sub: "one commit per run", at: cue("Artifacts,", 8.5) }
  ];
  const w = 360, gap = 80, x0 = (1920 - (4 * w + 3 * gap)) / 2, y = 440, h = 150;
  const tGit = cue("git client", 12);
  return (
    <Canvas>
      <Kicker p={useIn(0.2)}>UNDER THE HOOD</Kicker>
      {steps.map((s, i) => {
        const x = x0 + i * (w + gap);
        return (
          <g key={s.label}>
            <Box x={x} y={y} w={w} h={h} label={s.label} sub={s.sub} p={useIn(s.at - 0.3)} stroke={i === 3 ? theme.orange : theme.border} />
            {i < 3 && (
              <>
                <Arrow x1={x + w + 8} y1={y + h / 2} x2={x + w + gap - 8} y2={y + h / 2} p={ramp(t, steps[i + 1]!.at - 0.4, steps[i + 1]!.at)} />
                <Packet x1={x + w} y1={y + h / 2} x2={x + w + gap} y2={y + h / 2} t={t} start={steps[i + 1]!.at} period={1.2} />
              </>
            )}
          </g>
        );
      })}
      <Label x={960} y={790} size={34} color={theme.muted} weight={500} mono opacity={ramp(t, tGit - 0.3, tGit + 0.4)}>
        $ git clone …/agent-michelle.git
      </Label>
    </Canvas>
  );
}

function RepoLog() {
  const t = useSeconds();
  const lines = [
    ["$ git log --oneline", theme.green],
    ["7c1e2a9 Count flowing lava lamps across every page   [completed]", theme.text],
    ["3f90b41 Count flowing lava lamps (follow nextCursor)   [completed]", theme.text],
    ["a12d7e0 Count flowing lava lamps                       [error]", theme.red],
    ["$ git show 7c1e2a9 -- run.js", theme.green]
  ] as const;
  return (
    <Canvas>
      <Kicker>EVERY ATTEMPT, IN GIT</Kicker>
      <rect x={160} y={220} width={1600} height={560} rx={18} fill={theme.panel} stroke={theme.border} strokeWidth={2} />
      {lines.map(([line, color], i) => (
        <Label key={i} x={210} y={300 + i * 80} size={30} anchor="start" mono weight={400} color={color} opacity={ramp(t, 0.5 + i * 0.6, 0.9 + i * 0.6)}>
          {line}
        </Label>
      ))}
      <Label x={1740} y={820} size={20} anchor="end" color={theme.muted} weight={400}>illustrative · replaced by a recording (public/clips/repo.mp4)</Label>
    </Canvas>
  );
}

function Scale() {
  const t = useSeconds();
  const cols = 50, rows = 20, size = 26, gap = 6;
  const x0 = (1920 - cols * (size + gap)) / 2;
  const cells = [];
  for (let i = 0; i < cols * rows; i++) {
    const lit = ramp(t, 0.5 + (i % 37) * 0.04 + Math.floor(i / cols) * 0.18, 1 + (i % 37) * 0.04 + Math.floor(i / cols) * 0.18);
    cells.push(
      <rect key={i} x={x0 + (i % cols) * (size + gap)} y={240 + Math.floor(i / cols) * (size + gap)} width={size} height={size} rx={5} fill={lit > 0.5 ? theme.orange : theme.panel} opacity={0.35 + 0.65 * lit} />
    );
  }
  return (
    <Canvas>
      <Kicker>ONE REPO PER AGENT</Kicker>
      {cells}
      <Label x={960} y={940} size={36} color={theme.muted} weight={500} opacity={useIn(1)}>
        each square: an agent and its Artifacts repo
      </Label>
    </Canvas>
  );
}

function Recall({ cue }: { cue: Cue }) {
  const t = useSeconds();
  const tEmbed = cue("embeds", 2.5);
  const tVec = cue("Vectorize.", 4.5);
  const tNext = cue("next agent", 6);
  const tRecords = cue("searches", 10);
  const y = 380;
  return (
    <Canvas>
      <Kicker p={useIn(0.2)}>PHASE 2 · LEARNING</Kicker>
      <RepoCard x={100} y={y - 60} name="michelle" commits={3} p={useIn(0.4)} />
      <Box x={760} y={y - 55} w={320} h={110} label="Workers AI" sub="embed question + code" p={useIn(tEmbed - 0.3)} />
      <Arrow x1={660} y1={y} x2={752} y2={y} p={ramp(t, tEmbed - 0.3, tEmbed)} />
      <Box x={1180} y={y - 55} w={300} h={110} label="Vectorize" sub="nearest runs" p={useIn(tVec - 0.3)} stroke={theme.orange} />
      <Arrow x1={1080} y1={y} x2={1172} y2={y} p={ramp(t, tVec - 0.3, tVec)} />
      <Arrow x1={1330} y1={y + 60} x2={1330} y2={y + 190} p={ramp(t, tNext - 0.2, tNext + 0.3)} />
      <Agent x={1330} y={y + 270} r={52} color={theme.amber} label="matthew" p={useIn(tNext - 0.4)} />
      <g opacity={useIn(tNext + 0.4)}>
        <rect x={1420} y={y + 220} width={300} height={70} rx={14} fill="none" stroke={theme.amber} strokeDasharray="8 8" strokeWidth={2} />
        <Label x={1570} y={y + 255} size={24} color={theme.amber} weight={500}>unverified examples</Label>
      </g>
      <g opacity={useIn(tRecords - 0.3)}>
        <RepoCard x={100} y={y + 260} name="matthew" commits={1} highlight />
        <path d={`M ${380} ${y + 255} C ${300} ${y + 160}, ${300} ${y + 140}, ${380} ${y + 70}`} stroke={theme.amber} strokeWidth={3} fill="none" strokeDasharray="10 8" markerEnd="url(#arrow)" />
        <Label x={420} y={y + 160} size={24} color={theme.amber} anchor="start" mono weight={400}>Codemode-Examples: agent-michelle@3f90b41</Label>
      </g>
    </Canvas>
  );
}

function Lane({ y, name, runs, tokens, maxTokens, at, color }: {
  y: number; name: string; runs: ("error" | "ok")[]; tokens: number; maxTokens: number; at: number; color: string;
}) {
  const t = useSeconds();
  return (
    <g>
      <Agent x={230} y={y} r={50} color={color} label={name} p={ramp(t, at - 0.4, at)} />
      {runs.map((r, i) => (
        <g key={i} opacity={ramp(t, at + 0.6 + i * 0.9, at + 1 + i * 0.9)}>
          <rect x={360 + i * 150} y={y - 45} width={130} height={90} rx={14} fill={theme.panel} stroke={r === "ok" ? theme.green : theme.red} strokeWidth={3} />
          <Label x={425 + i * 150} y={y} size={36} color={r === "ok" ? theme.green : theme.red}>{r === "ok" ? "✓" : "✗"}</Label>
        </g>
      ))}
      <g opacity={ramp(t, at + 1, at + 1.5)}>
        <rect x={1100} y={y - 22} width={640 * ramp(t, at + 1, at + 2.5) * (tokens / maxTokens)} height={44} rx={10} fill={color} />
        <Label x={1100} y={y - 50} size={22} anchor="start" color={theme.muted} weight={500}>tokens</Label>
      </g>
    </g>
  );
}

function Walkthrough({ cue }: { cue: Cue }) {
  const tM = cue("Michelle asks", 2);
  const tT = cue("Matthew asks", 9);
  const d = walkthrough;
  const max = Math.max(d.michelle.tokens, d.matthew.tokens);
  return (
    <Canvas>
      <Kicker>THE LAVA LAMP WALL</Kicker>
      <g opacity={0.25}>
        {Array.from({ length: 12 }, (_, i) => (
          <LavaLamp key={i} x={1180 + i * 56} y={70} wax={WAX[(i * 3) % WAX.length]!} seed={i} scale={0.55} />
        ))}
      </g>
      <Lane y={370} name="michelle" runs={d.michelle.runs} tokens={d.michelle.tokens} maxTokens={max} at={tM} color={theme.text} />
      <Lane y={700} name="matthew" runs={d.matthew.runs} tokens={d.matthew.tokens} maxTokens={max} at={tT} color={theme.amber} />
      {d.illustrative && (
        <Label x={1740} y={960} size={20} anchor="end" color={theme.muted} weight={400}>illustrative · fill in from examples/agent/scripts/walkthrough.mjs</Label>
      )}
    </Canvas>
  );
}

function Curve({ cue }: { cue: Cue }) {
  const t = useSeconds();
  const tNo = cue("no memory", 6);
  const tDrop = cue("drops", 9);
  const tStays = cue("stays", 13);
  const x0 = 260, x1 = 1700, y0 = 860, y1 = 260, max = 360;
  const xs = learningCurve.map((_, i) => x0 + (i * (x1 - x0)) / (learningCurve.length - 1));
  const yOf = (v: number) => y0 - (v / max) * (y0 - y1);
  const path = (key: "baseline" | "examples", p: number) => {
    const pts = learningCurve.map((r, i) => [xs[i]!, yOf(r[key])] as const);
    const n = Math.max(1, Math.ceil(p * (pts.length - 1)));
    return pts.slice(0, n + 1).map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ");
  };
  const pBase = ramp(t, 1, 4);
  const pMem = ramp(t, tNo, tDrop + 2.5);
  return (
    <Canvas>
      <Kicker>DABSTEP · MEDIAN TOKENS PER TASK, BY POSITION IN THE RUN</Kicker>
      <line x1={x0} y1={y0} x2={x1} y2={y0} stroke={theme.border} strokeWidth={2} />
      {learningCurve.map((r, i) => (
        <Label key={r.tasks} x={xs[i]!} y={y0 + 40} size={24} color={theme.muted} weight={400}>tasks {r.tasks}</Label>
      ))}
      <path d={path("baseline", pBase)} stroke={theme.muted} strokeWidth={6} fill="none" strokeLinejoin="round" />
      <path d={path("examples", pMem)} stroke={theme.orange} strokeWidth={8} fill="none" strokeLinejoin="round" />
      <Label x={xs[0]!} y={yOf(330) - 60} size={28} color={theme.muted} weight={500} opacity={ramp(t, tNo - 0.3, tNo + 0.3)}>no memory yet</Label>
      <Label x={xs[4]! - 20} y={yOf(186) - 50} size={28} color={theme.muted} anchor="end" weight={600} opacity={pBase}>baseline</Label>
      <Label x={xs[4]! - 20} y={yOf(60) + 60} size={44} color={theme.orange} anchor="end" weight={800} opacity={ramp(t, tStays - 0.5, tStays + 0.3)}>≈ ⅓ the tokens</Label>
    </Canvas>
  );
}

function Accuracy({ cue }: { cue: Cue }) {
  const t = useSeconds();
  const tGrow = cue("right", 2.5);
  const groups = [accuracy[2]!, accuracy[1]!];
  return (
    <Canvas>
      <Kicker>DABSTEP · ADYEN'S OFFICIAL SCORER</Kicker>
      {groups.map((g, gi) => {
        const cx = 620 + gi * 700;
        const bars = [
          { v: g.baseline, c: theme.muted },
          { v: g.examples, c: theme.orange }
        ];
        return (
          <g key={g.level}>
            {bars.map((b, bi) => {
              const p = ramp(t, tGrow - 1 + bi * 0.6, tGrow + bi * 0.6);
              const h = (b.v / 55) * 560 * p;
              const x = cx - 170 + bi * 190;
              return (
                <g key={bi}>
                  <rect x={x} y={880 - h} width={150} height={h} rx={10} fill={b.c} />
                  <Label x={x + 75} y={850 - h} size={46} color={b.c} weight={800} opacity={p}>{b.v}%</Label>
                </g>
              );
            })}
            <Label x={cx - 20} y={930} size={32} color={theme.muted} weight={500}>{g.level}</Label>
          </g>
        );
      })}
    </Canvas>
  );
}

function Network({ cx, cy, hub, infected, t, start }: { cx: number; cy: number; hub: boolean; infected: boolean; t: number; start: number }) {
  const n = 8, R = 230;
  const nodes = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    return { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) };
  });
  return (
    <g>
      {hub &&
        nodes.map((p, i) => {
          const reach = ramp(t, start + 0.5 + i * 0.12, start + 1.1 + i * 0.12);
          return (
            <g key={i}>
              <line x1={cx} y1={cy} x2={p.x} y2={p.y} stroke={theme.border} strokeWidth={3} />
              {infected && reach > 0 && reach < 1 && <circle cx={cx + (p.x - cx) * reach} cy={cy + (p.y - cy) * reach} r={9} fill={theme.red} />}
            </g>
          );
        })}
      {!hub &&
        nodes.map((p, i) => {
          const q = nodes[(i + 3) % n]!;
          return i % 2 === 0 ? <line key={i} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke={theme.border} strokeWidth={2} strokeDasharray="6 8" /> : null;
        })}
      {hub && (
        <g>
          <circle cx={cx} cy={cy} r={62} fill={theme.panel} stroke={infected && t > start ? theme.red : theme.amber} strokeWidth={4} />
          <Label x={cx} y={cy} size={22} color={theme.muted} weight={500}>skills</Label>
        </g>
      )}
      {nodes.map((p, i) => {
        const bad = hub ? infected && t > start + 1.1 + i * 0.12 : infected && i === 0 && t > start;
        return <Agent key={i} x={p.x} y={p.y} r={36} color={bad ? theme.red : theme.green} />;
      })}
    </g>
  );
}

function Contagion({ cue }: { cue: Cue }) {
  const t = useSeconds();
  const tWrong = cue("One wrong", 5);
  const tRaw = cue("Raw runs", 9);
  const pRaw = useIn(tRaw - 0.4);
  return (
    <Canvas>
      <Kicker>WHICH MEMORY WORKS</Kicker>
      <g opacity={useIn(0.4)}>
        <Label x={560} y={220} size={34} color={theme.muted} weight={700}>shared, verified skills</Label>
        <Network cx={560} cy={590} hub infected t={t} start={tWrong} />
      </g>
      <g opacity={pRaw}>
        <Label x={1360} y={220} size={34} color={theme.orange} weight={700}>raw runs, unverified</Label>
        <Network cx={1360} cy={590} hub={false} infected t={t} start={tRaw + 1} />
      </g>
    </Canvas>
  );
}

function Close({ cue }: { cue: Cue }) {
  const t = useSeconds();
  const tTag = cue("Keep the code", 4);
  const lines = [
    "const history = new GitHistoryConnector(ctx, env, { sink });",
    "const runtime = history.bind(createCodemodeRuntime({",
    "  ctx, executor, connectors: [lamps, history] }));"
  ];
  return (
    <Canvas>
      <LavaWall opacity={0.22} top={420} rows={4} />
      <Label x={960} y={190} size={44} mono color={theme.green} weight={500} opacity={useIn(0.3)}>$ npm install @smithclay/codemode-git</Label>
      {lines.map((l, i) => (
        <Label key={i} x={960} y={300 + i * 50} size={30} mono weight={400} opacity={ramp(t, 1 + i * 0.3, 1.4 + i * 0.3)}>{l}</Label>
      ))}
      <g opacity={ramp(t, tTag - 0.2, tTag + 0.4)}>
        <rect x={260} y={560} width={1400} height={170} rx={20} fill={theme.bg} opacity={0.85} />
        <Label x={960} y={620} size={88} color={theme.amber} weight={800}>Keep the code.</Label>
        <Label x={960} y={700} size={40} color={theme.text} weight={500}>Your Workers get smarter over time.</Label>
      </g>
    </Canvas>
  );
}
