/** Workers AI with retry on rate limits (3021) and transient errors. */
export async function runAi(ai: Ai, model: string, input: unknown, attempts = 6): Promise<unknown> {
  for (let i = 0; ; i++) {
    try {
      return await (ai.run as (m: string, i: unknown) => Promise<unknown>)(model, input);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const retryable = /3021|rate limit|3040|capacity|timeout|network connection lost/i.test(message);
      if (!retryable || i >= attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, Math.min(30_000, 2_000 * 2 ** i) + Math.random() * 1000));
    }
  }
}
