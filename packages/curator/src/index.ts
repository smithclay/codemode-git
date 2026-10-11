import { Curator, type Env as CuratorEnv, type PushedEvent } from "./curator";

type Env = CuratorEnv & { CURATOR: DurableObjectNamespace<Curator> };

export { Curator };

const NAMESPACE = "codemode-git";

function curator(env: Env) {
  return env.CURATOR.get(env.CURATOR.idFromName(NAMESPACE));
}

function isPushed(event: unknown): event is PushedEvent {
  return (event as PushedEvent | null)?.type === "cf.artifacts.repo.pushed";
}

export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url);
    // Feed push events by hand (local dev, or replaying a subscription's payloads).
    if (pathname === "/events" && request.method === "POST") {
      const body = (await request.json()) as unknown;
      const events = (Array.isArray(body) ? body : [body]).filter(isPushed);
      return Response.json(await curator(env).ingest(events));
    }
    // Walk every agent repo's history. Idempotent: seen commits are skipped.
    if (pathname === "/backfill" && request.method === "POST") {
      return Response.json(await curator(env).backfill());
    }
    if (pathname === "/status" && request.method === "GET") {
      return Response.json(await curator(env).status());
    }
    return new Response("POST /events | POST /backfill | GET /status\n", { status: 404 });
  },

  // Event subscriptions deliver Artifacts push events through a queue.
  async queue(batch, env): Promise<void> {
    const events = batch.messages.map((m) => m.body).filter(isPushed);
    if (events.length) await curator(env).ingest(events);
    batch.ackAll();
  }
} satisfies ExportedHandler<Env, unknown>;
