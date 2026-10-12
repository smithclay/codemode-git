import { AbsoluteFill, Audio, Sequence, Series, staticFile, useCurrentFrame } from "remotion";
import { scenes, type Scene } from "./script";
import { theme } from "./theme";
import { Visual } from "./scenes/Visual";

export const FPS = 30;
// Breathing room after each line, and before the first.
const LEAD_IN = 0.4;
const HOLD = 1.2;

export type Word = { word: string; start: number; end: number };
export type Manifest = Record<string, { file: string; hash: string; seconds: number; words: Word[] }>;

const estimate = (scene: Scene) => scene.voiceover.split(/\s+/).length / 2.6;

export const sceneFrames = (scene: Scene, manifest: Manifest) =>
  Math.ceil((LEAD_IN + (manifest[scene.id]?.seconds ?? estimate(scene)) + HOLD) * FPS);

export const Demo = ({ manifest }: { manifest: Manifest }) => (
  <AbsoluteFill style={{ background: theme.bg, color: theme.text, fontFamily: theme.sans }}>
    <Series>
      {scenes.map((scene) => {
        const voice = manifest[scene.id];
        return (
          <Series.Sequence key={scene.id} durationInFrames={sceneFrames(scene, manifest)} name={scene.id}>
            <Visual visual={scene.visual} />
            {voice && (
              <Sequence from={Math.round(LEAD_IN * FPS)} name={`${scene.id} voiceover`}>
                <Audio src={staticFile(voice.file)} />
                <Captions words={alignToScript(scene.voiceover, voice.words)} />
              </Sequence>
            )}
          </Series.Sequence>
        );
      })}
    </Series>
  </AbsoluteFill>
);

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

// Shows the current phrase: up to 8 words around the one being spoken.
function Captions({ words }: { words: Word[] }) {
  const t = useCurrentFrame() / FPS;
  const i = words.findIndex((w) => t < w.end);
  if (i < 0 || t < (words[0]?.start ?? 0)) return null;
  const start = Math.floor(i / 8) * 8;
  const phrase = words.slice(start, start + 8);
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 56 }}>
      <div style={{ background: "rgba(0,0,0,0.65)", borderRadius: 12, padding: "12px 24px", fontSize: 36, maxWidth: 1500, textAlign: "center" }}>
        {phrase.map((w, j) => (
          <span key={j} style={{ color: start + j === i ? theme.amber : theme.text }}>
            {(j ? " " : "") + w.word}
          </span>
        ))}
      </div>
    </AbsoluteFill>
  );
}
