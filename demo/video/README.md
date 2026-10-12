# Demo video

The competition demo, built with [Remotion](https://www.remotion.dev/). The voiceover is generated on Workers AI with Deepgram Aura-2 (`@cf/deepgram/aura-2-en`), and Whisper (`@cf/openai/whisper`) supplies word timings for the captions. Scene text and visuals are in [src/script.ts](src/script.ts). The run of show it follows is in [DEMO.md](../../DEMO.md).

This package sits outside the repo's npm workspaces, so Remotion's headless Chrome doesn't affect CI or the library install.

```bash
npm install
npm run tts-worker   # terminal 1: local Worker with a Workers AI binding, using your cf login
npm run voiceover    # terminal 2: regenerates audio only for scenes whose text changed
npm run studio       # preview and scrub in the browser
npm run render       # out/demo.mp4
```

To skip the local Worker, set `CLOUDFLARE_API_TOKEN` (with Workers AI access) and `CLOUDFLARE_ACCOUNT_ID`, and `npm run voiceover` calls the REST API instead.

**How timing works:**
- Each scene lasts as long as its voiceover, plus a short lead-in and hold.
- Captions use the script's words with Whisper's timings, because Whisper mishears names like "Cloudflare".
- Before the first voiceover run, scene lengths are estimated from word counts.

**Cost:** a full regeneration of the voiceover is about 2,700 characters, roughly $0.08 at Aura-2's $0.03 per 1,000 characters. Whisper adds a fraction of a cent.
