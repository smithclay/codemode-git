import { DurableObject } from "cloudflare:workers";
import { createCodemodeRuntime, DynamicWorkerExecutor } from "@cloudflare/codemode";
import { ArtifactsSink, GitHistoryConnector } from "@smithclay/codemode-git";

export { CodemodeRuntime } from "@cloudflare/codemode";

type Env = { ARTIFACTS: Artifacts; LOADER: WorkerLoader; AGENT: DurableObjectNamespace<Agent> };

// One Code Mode agent per name; every run is a commit on its own Artifacts repo.
export class Agent extends DurableObject<Env> {
	async run(name: string, code: string) {
		const history = new GitHistoryConnector(this.ctx, this.env, {
			sink: new ArtifactsSink({ artifacts: this.env.ARTIFACTS, repo: `agent-${name}` }),
		});
		const runtime = history.bind(
			createCodemodeRuntime({
				ctx: this.ctx,
				executor: new DynamicWorkerExecutor({ loader: this.env.LOADER }),
				connectors: [history],
			}),
		);
		return runtime.execute({ code });
	}
}

// Add auth before deploying for real: this runs any code it's sent.
export default {
	async fetch(request, env) {
		const name = new URL(request.url).searchParams.get("agent") ?? "demo";
		const agent = env.AGENT.get(env.AGENT.idFromName(name));
		return Response.json(await agent.run(name, await request.text()));
	},
} satisfies ExportedHandler<Env>;
