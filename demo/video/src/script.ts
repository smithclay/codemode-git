// The demo video, scene by scene. Plain data, so scripts/voiceover.mjs can
// import it with Node's built-in type stripping and the Remotion composition
// can render it. Edit a voiceover line, rerun `npm run voiceover`, and only
// that scene's audio is regenerated; scene lengths follow the audio.
//
// Numbers we haven't measured yet (swarm, michelle → matthew) stay out of the
// voiceover; the visuals carry them once they exist.

export type Visual =
  | { kind: "lava-wall"; title: string; subtitle: string }
  | { kind: "code-compare"; left: { title: string; lines: string[] }; right: { title: string; code: string } }
  | { kind: "isolate"; steps: string[] }
  | { kind: "terminal"; title: string; lines: string[] }
  | { kind: "walkthrough"; left: AgentCard; right: AgentCard }
  | { kind: "diagram"; nodes: string[]; caption: string }
  | { kind: "learning-curve" }
  | { kind: "memory-kinds" }
  | { kind: "close"; install: string; lines: string[]; tagline: string };

export type AgentCard = { agent: string; question: string; note: string };

export type Scene = { id: string; voiceover: string; visual: Visual };

export const SPEAKER = "orion";

export const scenes: Scene[] = [
  {
    id: "cold-open",
    voiceover:
      "Cloudflare's lobby has a wall of about a hundred lava lamps, and a camera turns the moving wax into randomness for encryption. Here are two Code Mode agents checking on that wall. The first one figures it out the hard way. The second gets it right the first time, because it can read the code the first one wrote. This is codemode-git: code memory for Code Mode agents, on Cloudflare Artifacts.",
    visual: {
      kind: "lava-wall",
      title: "codemode-git",
      subtitle: "Code memory for Code Mode agents, on Cloudflare Artifacts"
    }
  },
  {
    id: "code-mode",
    voiceover:
      "Cloudflare's Code Mode insight: models are much better at writing code than at calling tools one at a time. They've seen millions of real programs. So instead of a chain of tool calls, the agent writes one function: loop over every page of the wall, filter, count, return. Cloudflare calls that code a compact plan.",
    visual: {
      kind: "code-compare",
      left: {
        title: "Tool calls, one at a time",
        lines: [
          "→ lamps.wall({})",
          "← 12 lamps, nextCursor: 12",
          "→ lamps.wall({ cursor: 12 })",
          "← 12 lamps, nextCursor: 24",
          "→ lamps.wall({ cursor: 24 })",
          "← …every page back through the model"
        ]
      },
      right: {
        title: "Code Mode: one compact plan",
        code: `async () => {
  let cursor = null, count = 0;
  do {
    const page = await lamps.wall({ cursor });
    count += page.lamps
      .filter((l) => l.status === "flowing").length;
    cursor = page.nextCursor;
  } while (cursor);
  return count;
}`
      }
    }
  },
  {
    id: "the-gap",
    voiceover:
      "Each plan runs in a fresh isolate that's thrown away afterward. That's exactly right for the sandbox. But the plan goes with it, and the next agent with the same kind of question starts from zero.",
    visual: { kind: "isolate", steps: ["load isolate", "run the plan", "discard isolate", "…and the code"] }
  },
  {
    id: "phase-1",
    voiceover:
      "Phase one: code memory. Add one connector, and every execution is saved to that agent's own Cloudflare Artifacts repo: the code it ran, every tool call with its result, and the outcome. Artifacts gives every agent its own repo, at any scale. It speaks Git, so any git client can read it, but nobody has to.",
    visual: {
      kind: "terminal",
      title: "agent-michelle · Cloudflare Artifacts",
      lines: [
        "$ git log -1 --stat",
        "Count lava lamps that are flowing, across every page of the wall",
        "",
        "Codemode-Execution: exec_7f3a…",
        "Codemode-Status: completed",
        "Codemode-Connectors: lamps, history",
        "",
        " run.js       | 10 ++++++++++",
        " calls.jsonl  |  6 ++++++",
        " result.json  |  1 +"
      ]
    }
  },
  {
    id: "fleet",
    voiceover:
      "Because each agent is the only writer to its own Artifacts repo, thousands of agents can save their runs at once. There's nothing to lock, and nothing to merge.",
    visual: {
      kind: "terminal",
      title: "node scripts/swarm.mjs <worker-url> --agents 1000",
      lines: ["{", '  "agents": 1000,', '  "reposWithCommit": "[from the swarm run]",', '  "errors": "[…]",', '  "commitsPerSecond": "[…]"', "}"]
    }
  },
  {
    id: "phase-2",
    voiceover:
      "Phase two: learning. When a run produces an answer, Workers AI embeds the question and the code into Vectorize. Matthew's question is similar to Michelle's, so Matthew starts with Michelle's code, labeled unverified. It still writes and runs its own code, but it already knows the wall is paginated. And its saved run records exactly which memory it used.",
    visual: {
      kind: "walkthrough",
      left: {
        agent: "agent-michelle",
        question: "How many lava lamps on the wall are flowing right now?",
        note: "empty memory · works out pagination · 67"
      },
      right: {
        agent: "agent-matthew",
        question: "How many red lava lamps are flowing?",
        note: "starts from michelle's run · first try · 10"
      }
    }
  },
  {
    id: "how-it-works",
    voiceover:
      "Under the hood it's all Cloudflare. Durable Objects for each agent, Artifacts for the memory, Workers AI and Vectorize to find the closest runs, and Worker Loader to run the code.",
    visual: {
      kind: "diagram",
      nodes: ["Code Mode run", "Artifacts repo", "Workers AI embedding", "Vectorize", "next agent's prompt"],
      caption: "Codemode-Examples: agent-michelle@<sha>"
    }
  },
  {
    id: "benchmark",
    voiceover:
      "Does it hold up on real investigations? DABstep is four hundred and fifty data analysis tasks over Adyen's payments data. Same model, same prompt, scored by Adyen. Accuracy goes from thirty two to forty six percent. For the first eight tasks there's no memory, and both arms cost the same. Within about twenty five tasks, the median cost per task falls to about a third, and stays there.",
    visual: { kind: "learning-curve" }
  },
  {
    id: "memory-kinds",
    voiceover:
      "One more finding. We first distilled runs into verified, shared skills. That made agents wrong together, because one bad skill spread. Raw runs, labeled unverified, worked better.",
    visual: { kind: "memory-kinds" }
  },
  {
    id: "close",
    voiceover:
      "It's on npm, it's three lines in a Code Mode agent, and there's a Deploy to Cloudflare button. Code Mode made code the way agents act. Artifacts makes it the way they remember. Throw away the isolate. Keep the code.",
    visual: {
      kind: "close",
      install: "npm install @smithclay/codemode-git",
      lines: [
        "const history = new GitHistoryConnector(ctx, env, { sink });",
        "connectors: [lamps, history]",
        "const runtime = history.bind(createCodemodeRuntime({ … }));"
      ],
      tagline: "Throw away the isolate. Keep the code."
    }
  }
];
