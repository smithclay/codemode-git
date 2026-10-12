# Demo video

The competition demo, built with [Remotion](https://www.remotion.dev/). The voiceover is generated on Workers AI with Deepgram Aura-2 (`@cf/deepgram/aura-2-en`), and Whisper (`@cf/openai/whisper`) supplies word timings for the captions. The narration is in [transcript.md](transcript.md), one `## <scene>` section per scene. Scene order, diagrams and recording slots are in [src/script.ts](src/script.ts). The run of show it follows is in [DEMO.md](../../DEMO.md).

This package sits outside the repo's npm workspaces, so Remotion's headless Chrome doesn't affect CI or the library install.

```bash
npm install
npm run tts-worker   # terminal 1: local Worker with a Workers AI binding, using your cf login
npm run voiceover    # terminal 2: regenerates audio for edited sections of transcript.md, then prints the runtime
npm run studio       # preview and scrub in the browser
npm run render       # out/demo.mp4
```

To skip the local Worker, set `CLOUDFLARE_API_TOKEN` (with Workers AI access) and `CLOUDFLARE_ACCOUNT_ID`, and `npm run voiceover` calls the REST API instead.

**How timing works:**
- Each scene lasts as long as its voiceover, plus a 0.2s lead-in and a 0.6s hold (`LEAD_IN` and `HOLD` in `src/script.ts`). Keep them small, or they read as dead air.
- Captions use the transcript text the audio was generated from, with Whisper's timings, because Whisper mishears names like "Cloudflare".

**Cost:** a full regeneration of the voiceover is about 2,850 characters, roughly $0.09 at Aura-2's $0.03 per 1,000 characters. Whisper adds a fraction of a cent.

**Recordings:** a scene shows `public/clips/<scene>.mp4` instead of its diagram when the scene id is listed in `public/clips/index.json`. Scenes with `minSeconds` in the script stretch to that length once their recording exists (the git log, the swarm, and the michelle → matthew run). Until then they last only as long as their narration, so there's no silent padding.

**Terminal recordings:** `npm run record` records [terminal/new-worker.tape](terminal/new-worker.tape) with [VHS](https://github.com/charmbracelet/vhs): `cf init`, installing Code Mode and codemode-git, the connector and bindings, and `cf deploy --dry-run` (nothing is deployed). [scripts/record.mjs](scripts/record.mjs) then encodes the clip to `public/clips/new-worker.mp4` and lists it in `public/clips/index.json`. VHS's own encoding fails silently with ffmpeg 9, so VHS writes frames and ffmpeg does the encoding. The recording turns off npm's minimum-release-age check for its own shell only, because the `cf init` template pins a `cf` beta that is less than a week old.
