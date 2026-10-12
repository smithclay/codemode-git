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

What if Cloudflare Artifacts could make Code Mode self-improving? Every Code Mode run is a program. Keep every program, and let the next agent learn from it. That's codemode-git.

## hook

We tried it. Same model. Same prompt. Same four hundred and fifty tasks. Accuracy went from thirty-two percent to forty-six. On the hardest tasks, from twenty-three to almost thirty-nine. The only thing we added was memory.

## vanish

Today, every agent starts from zero. It writes code, runs it, gets an answer, and the code is gone. A thousand agents solve the same problem a thousand times.

## code-mode

Some context. With Cloudflare's Code Mode, agents don't call tools one at a time, sending every result back through the model. They write one program against the tools, a compact plan, and run it in a fresh isolate. That program is a complete record of how the agent solved the problem.

## gap

But the isolate is thrown away after every run, and the plan goes with it.

## memory

So we keep it. Every execution becomes a commit on that agent's own Cloudflare Artifacts repo: the code, every tool call and its result, and the outcome. One repo per agent, and one writer per repo. Nothing to lock, nothing to merge.

## under-the-hood

Under the hood, a connector hooks the end of every execution. The run lands in a SQLite outbox inside the agent's Durable Object, and isomorphic-git pushes it to Artifacts, in order, and safely across restarts. Artifacts speaks Git, so any git client can read an agent's history.

## repo

Clone an agent's repo, and its log is the agent's trajectory: every attempt, every fix, every answer.

## scale

Artifacts is built for tens of millions of repos, so every agent gets its own, and they all write at the same time.

## recall

Then, the learning. When a run produces an answer, Workers AI embeds the question and the code into Vectorize. The next agent with a similar question starts from the closest runs, labeled unverified. And its own commit records exactly which memories it used.

## walkthrough

<!-- Check against the recorded walkthrough.mjs run before final render. -->
Here it is on Cloudflare's wall of lava lamps. Agent Michelle asks how many lamps are flowing. With no memory, Michelle has to discover that the wall is paginated. Agent Matthew asks about the red lamps, starts from Michelle's run, and already knows to walk every page.

## curve

At scale, we ran DABstep: four hundred and fifty real data investigations over Adyen's payments data. With no memory, both arms cost the same. As memory fills, the median cost per task drops to about a third, within the first few dozen tasks, and it stays there.

## accuracy

And they're not just cheaper. They're right more often. Scored by Adyen: forty-six percent overall, up from thirty-two.

## contagion

We also learned what kind of memory works. Our first version distilled runs into a shared library of verified skills. One wrong skill spread to every agent that used it. Raw runs, labeled unverified, worked better, because each agent still runs its own code.

## close

It's on npm: three lines in any Code Mode agent, and a Deploy to Cloudflare button. Throw away the isolate. Keep the code.
