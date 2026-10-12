import { Composition, Still, staticFile } from "remotion";
import { Poster } from "./scenes/Visual";
import { Demo, FPS, sceneFrames, type DemoProps, type Manifest } from "./Demo";
import { scenes } from "./script";

// Scene lengths come from the generated voiceover; a scene without audio yet
// gets a placeholder length.
async function loadManifest(): Promise<Manifest> {
  try {
    const res = await fetch(staticFile("voiceover/manifest.json"));
    return res.ok ? ((await res.json()) as Manifest) : {};
  } catch {
    return {};
  }
}

// Scene ids with a recording in public/clips/<id>.mp4, listed in
// public/clips/index.json (add the id there when you add a recording).
async function loadClips(): Promise<string[]> {
  try {
    const res = await fetch(staticFile("clips/index.json"));
    return res.ok ? ((await res.json()) as string[]) : [];
  } catch {
    return [];
  }
}

export const RemotionRoot = () => (
  <>
  <Still id="Poster" component={Poster} width={1920} height={1080} />
  <Composition
    id="Demo"
    component={Demo}
    fps={FPS}
    width={1920}
    height={1080}
    defaultProps={{ manifest: {}, clips: [] } as DemoProps}
    calculateMetadata={async () => {
      const [manifest, clips] = await Promise.all([loadManifest(), loadClips()]);
      const durationInFrames = scenes.reduce((sum, scene) => sum + sceneFrames(scene, manifest, clips), 0);
      return { durationInFrames, props: { manifest, clips } };
    }}
  />
  </>
);
