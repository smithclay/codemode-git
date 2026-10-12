# Demo video transcript

<!--
One section per scene, in order. The heading is the scene id from src/script.ts,
and the paragraph under it is exactly what the narrator says.

After editing, run `npm run voiceover` (with `npm run tts-worker` running in
another terminal). Only scenes whose text changed are regenerated. Captions use
the text the audio was generated from, so they always match what is spoken.

HTML comments like this one are never spoken.
-->

## thesis

What if Cloudflare Artifacts could make Code Mode in Workers self-improving? Every Code Mode run is a program. Keep every program in Artifacts, and let the next agent learn from it. That's codemode-git.

## hook

We used an open source data analytics benchmark with the same four hundred and fifty tasks. Accuracy went from thirty-two percent to forty-six. On the hardest tasks, from twenty-three to almost thirty-nine. The only thing we added was memory.

## vanish

Today, every Code Mode agent writes code, runs it, gets an answer, and the code is gone. A thousand agents solve similar problems hundreds of times, even if they've seen it before.

## code-mode

First, let's review Cloudflare's Code Mode. Agents don't call tools one at a time, sending every result back through the model: They write one program against the tools and run it in a fresh Worker isolate. That program is a complete record of how the agent solved the problem.

## gap

But the isolate is thrown away after every run, and the code goes with it. When similar tasks are given to the agent again, it forgets.

## code-memory

So we keep it in a Cloudflare Artifact git repository. Every execution becomes a commit on that agent's own personal repo: the code, every tool call and its result, and the outcome. One repo per agent, and one writer per repo. Nothing to lock, nothing to merge.

## under-the-hood

Under the hood, a connector hooks the end of every execution in the Cloudflare SDK. The run lands in a SQLite outbox inside the agent's Durable Object, and git pushes it to Artifacts. Any git client can read an agent's history and use that to learn.

## repo

Clone an agent's repo, and its log is the agent's trajectory: every attempt, every fix, every answer.

## scale

Artifacts is built for tens of millions of repos, so every agent gets its own, and they all write at the same time.

## recall

Here's a simple way agents can use Artifacts to learn. When a run produces an answer, Workers AI embeds the question and the code into Cloudflare Vectorize. The next agent with a similar question searches for similar solutions and uses that for better context.

## walkthrough

<!-- Check against the recorded walkthrough.mjs run before final render. -->
Let's walk through an example: Cloudflare's wall of lava lamps. Agent Michelle asks how many lamps are flowing. With no memory, Michelle has to discover that the wall is paginated. Agent Matthew asks about the red lamps, starts from Michelle's run, and already knows to walk every page.

## curve

At scale, we ran the DABstep benchmark: four hundred and fifty real data investigations over Adyen's payments data. With no memory, both arms cost the same. As memory fills, the median cost per task drops to about a third, within the first few dozen tasks, and it stays there.

## accuracy

And they're not just cheaper. They're right more often. Scored by DABstep: forty-six percent overall, up from thirty-two.

## contagion

We also learned what kind of memory works. Our first version distilled runs into a shared library of verified skills. One wrong skill spread to every agent that used it. Raw runs, labeled unverified, worked better, because each agent still runs its own code.

## close

It's on npm: three lines in any Code Mode agent. Keep the code, and your Workers get smarter over time.
