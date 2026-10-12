/**
 * Workers AI with retries. Rate limits (3021) get patient retries: under
 * sustained load the per-minute window can stay full for minutes, and giving
 * up throws away the agent's whole run. Other transient errors retry briefly.
 */
export async function runAi(ai: Ai, model: string, input: unknown): Promise<unknown> {
  const started = Date.now();
  for (let i = 0; ; i++) {
    try {
      return await (ai.run as (m: string, i: unknown) => Promise<unknown>)(model, input);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const rateLimited = /3021|rate limit/i.test(message);
      const transient = /3040|capacity|timeout|network connection lost/i.test(message);
      const giveUp = rateLimited ? Date.now() - started > 15 * 60_000 : !transient || i >= 9;
      if (giveUp) throw err;
      await new Promise((r) => setTimeout(r, Math.min(60_000, 2_000 * 2 ** i) + Math.random() * 5_000));
    }
  }
}
