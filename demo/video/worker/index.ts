// POST /tts        {"text": "...", "speaker": "orion"} -> audio/mpeg (Deepgram Aura-2)
// POST /transcribe <audio bytes>                        -> Whisper JSON with word timings
// Typed loosely: the installed workers-types predate some of these models.
type Env = { AI: { run(model: string, inputs: unknown, options?: { returnRawResponse?: boolean }): Promise<unknown> } };

export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (request.method === "POST" && pathname === "/tts") {
      const { text, speaker } = (await request.json()) as { text: string; speaker?: string };
      const audio = (await env.AI.run(
        "@cf/deepgram/aura-2-en",
        { text, speaker: speaker ?? "orion", encoding: "mp3" },
        { returnRawResponse: true }
      )) as Response;
      return new Response(audio.body, { headers: { "content-type": "audio/mpeg" } });
    }
    if (request.method === "POST" && pathname === "/transcribe") {
      const audio = [...new Uint8Array(await request.arrayBuffer())];
      return Response.json(await env.AI.run("@cf/openai/whisper", { audio }));
    }
    return new Response("POST /tts | POST /transcribe\n", { status: 404 });
  }
} satisfies ExportedHandler<Env>;
