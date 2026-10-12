import { AbsoluteFill, Audio, OffthreadVideo, Sequence, Series, staticFile, useCurrentFrame } from "remotion";
import { scenes, type Scene } from "./script";
import { theme } from "./theme";
import { Visual } from "./scenes/Visual";

export const FPS = 30;
// Breathing room before each line and after it.
export const LEAD_IN = 0.5;
const HOLD = 1.6;

export type Word = { word: string; start: number; end: number };
export type Manifest = Record<string, { file: string; hash: string; seconds: number; words: Word[] }>;
export type DemoProps = { manifest: Manifest; clips: string[] };

const estimate = (scene: Scene) => scene.voiceover.split(/\s+/).length / 2.6;

export const sceneFrames = (scene: Scene, manifest: Manifest) =>
  Math.ceil(Math.max(LEAD_IN + (manifest[scene.id]?.seconds ?? estimate(scene)) + HOLD, scene.minSeconds ?? 0) * FPS);

/**
 * Seconds into the scene when a word is spoken, for syncing visuals to the
 * voiceover. Matches the script's words (case- and punctuation-insensitive),
 * falling back to `fallback` seconds before the voiceover exists.
 */
export type Cue = (needle: string, fallback: number) => number;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]/g, "");

function makeCue(words: Word[]): Cue {
  return (needle, fallback) => {
    const parts = needle.split(/\s+/).map(norm);
    for (let i = 0; i + parts.length <= words.length; i++) {
      if (parts.every((p, k) => norm(words[i + k]!.word) === p)) return LEAD_IN + words[i]!.start;
    }
    return fallback;
  };
}

// Whisper's timings, but the script's words: Whisper mishears names like
// "Cloudflare". Script word i takes the timing of the proportionally placed
// Whisper word, which is exact when the counts match.
function alignToScript(text: string, timed: Word[]): Word[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!timed.length) return [];
  return words.map((word, i) => {
    const t = timed[Math.min(timed.length - 1, Math.floor((i * timed.length) / words.length))]!;
    return { word, start: t.start, end: t.end };
  });
}

export const Demo = ({ manifest, clips }: DemoProps) => (
  <AbsoluteFill style={{ background: theme.bg, color: theme.text, fontFamily: theme.sans }}>
    <Series>
      {scenes.map((scene) => {
        const voice = manifest[scene.id];
        const words = voice ? alignToScript(scene.voiceover, voice.words) : [];
        const clip = clips.includes(scene.id) ? staticFile(`clips/${scene.id}.mp4`) : null;
        return (
          <Series.Sequence key={scene.id} durationInFrames={sceneFrames(scene, manifest)} name={scene.id}>
            {clip ? (
              <AbsoluteFill style={{ padding: 60 }}>
                <OffthreadVideo src={clip} muted style={{ width: "100%", height: "100%", objectFit: "contain" }} />
              </AbsoluteFill>
            ) : (
              <Visual visual={scene.visual} cue={makeCue(words)} />
            )}
            {voice && (
              <Sequence from={Math.round(LEAD_IN * FPS)} name={`${scene.id} voiceover`}>
                <Audio src={staticFile(voice.file)} />
                <Captions words={words} />
              </Sequence>
            )}
          </Series.Sequence>
        );
      })}
    </Series>
  </AbsoluteFill>
);

// The current phrase, up to 8 words, with the spoken word highlighted.
function Captions({ words }: { words: Word[] }) {
  const t = useCurrentFrame() / FPS;
  const i = words.findIndex((w) => t < w.end);
  if (i < 0 || t < (words[0]?.start ?? 0)) return null;
  const start = Math.floor(i / 8) * 8;
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 44 }}>
      <div style={{ background: "rgba(0,0,0,0.6)", borderRadius: 10, padding: "10px 22px", fontSize: 30, maxWidth: 1400, textAlign: "center" }}>
        {words.slice(start, start + 8).map((w, j) => (
          <span key={j} style={{ color: start + j === i ? theme.amber : theme.text }}>
            {(j ? " " : "") + w.word}
          </span>
        ))}
      </div>
    </AbsoluteFill>
  );
}
