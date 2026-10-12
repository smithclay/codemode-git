// The demo video's scenes, in order: which diagram each shows, and how long a
// recording slot needs. What the narrator says lives in ../transcript.md, one
// "## <id>" section per scene; `npm run voiceover` turns it into audio and
// public/voiceover/manifest.json, which the composition reads.
//
// Style: one idea per scene, told with a diagram, with on-screen text of a few
// words at most. The voiceover carries the detail.
//
// `minSeconds` is how long a scene's recording (public/clips/<id>.mp4, listed
// in public/clips/index.json) needs. It applies only once the recording
// exists. The rules require 5–10 min; `npm run voiceover` reports the total.

export type Visual =
  | "thesis"
  | "hook"
  | "vanish"
  | "code-mode"
  | "gap"
  | "memory"
  | "under-the-hood"
  | "scale"
  | "recall"
  | "walkthrough"
  | "repo"
  | "curve"
  | "accuracy"
  | "contagion"
  | "next-steps"
  | "new-worker"
  | "close"
  | "credits";

// `extraHold` lengthens a scene past its voiceover, e.g. for credits.
export type Scene = { id: string; visual: Visual; minSeconds?: number; extraHold?: number };

export const SPEAKER = "orion";

// Seconds of silence before each line and after it. Keep these small: Aura's
// own phrasing already has natural pauses, and long holds read as dead air.
export const LEAD_IN = 0.2;
export const HOLD = 0.6;

/**
 * A scene's length: its voiceover plus the lead-in and hold, stretched to
 * `minSeconds` only when that scene's recording exists. Placeholders
 * shouldn't pad with silence.
 */
export function sceneSeconds(scene: Scene, voiceSeconds: number | undefined, hasClip: boolean): number {
  const voiced = LEAD_IN + (voiceSeconds ?? 8) + HOLD + (scene.extraHold ?? 0);
  return hasClip ? Math.max(voiced, scene.minSeconds ?? 0) : voiced;
}

export const scenes: Scene[] = [
  { id: "thesis", visual: "thesis" },
  { id: "hook", visual: "hook" },
  { id: "vanish", visual: "vanish" },
  { id: "code-mode", visual: "code-mode" },
  { id: "gap", visual: "gap" },
  { id: "code-memory", visual: "memory" },
  { id: "under-the-hood", visual: "under-the-hood" },
  { id: "repo", visual: "repo", minSeconds: 30 },
  { id: "scale", visual: "scale", minSeconds: 25 },
  { id: "recall", visual: "recall" },
  { id: "walkthrough", visual: "walkthrough", minSeconds: 60 },
  { id: "curve", visual: "curve" },
  { id: "accuracy", visual: "accuracy" },
  { id: "contagion", visual: "contagion" },
  { id: "next-steps", visual: "next-steps" },
  { id: "new-worker", visual: "new-worker", minSeconds: 40 },
  { id: "close", visual: "close" },
  { id: "credits", visual: "credits", extraHold: 5 }
];
