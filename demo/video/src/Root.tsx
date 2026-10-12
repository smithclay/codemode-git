import { Composition, staticFile } from "remotion";
import { Demo, FPS, sceneFrames, type Manifest } from "./Demo";
import { scenes } from "./script";

// Scene lengths come from the generated voiceover. Without it (before the
// first `npm run voiceover`), they're estimated from word counts.
async function loadManifest(): Promise<Manifest> {
  try {
    const res = await fetch(staticFile("voiceover/manifest.json"));
    return res.ok ? ((await res.json()) as Manifest) : {};
  } catch {
    return {};
  }
}

export const RemotionRoot = () => (
  <Composition
    id="Demo"
    component={Demo}
    fps={FPS}
    width={1920}
    height={1080}
    defaultProps={{ manifest: {} as Manifest }}
    calculateMetadata={async () => {
      const manifest = await loadManifest();
      const durationInFrames = scenes.reduce((sum, scene) => sum + sceneFrames(scene, manifest), 0);
      return { durationInFrames, props: { manifest } };
    }}
  />
);
