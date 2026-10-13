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

We used an open source data analytics benchmark with the same four hundred and fifty tasks. Accuracy went from thirty-two percent to forty-six. On the hardest tasks, from twenty-three to almost thirty-nine. The only thing we added was memory using Artifacts.

## vanish

Today, every Code Mode agent writes code, runs it, gets an answer, and the code is gone. A thousand agents solve similar problems hundreds of times, even if they've seen it before.

## code-mode

First, let's review Cloudflare's Code Mode. Agents don't call tools one at a time, sending every result back through the model: They write one program against the tools and run it in a fresh Worker isolate. That program is a complete record of how the agent solved the problem.

## gap

But the isolate is thrown away after every run, and the code goes with it. When similar tasks are given to the agent again, it forgets.

## code-memory

So we keep it in a Cloudflare Artifact git repository. Every execution becomes a commit on that agent's own personal repo: the code, every tool call and its result, and the outcome. One repo per agent, and one writer per repo. Nothing to lock, nothing to merge. In our test, a thousand agents committed at once: a thousand commits in under thirty seconds, with zero errors.

## under-the-hood

Under the hood, a connector hooks the end of every execution in the Cloudflare SDK. The run lands in a SQLite outbox inside the agent's Durable Object, and git pushes it to Artifacts. Any git client can read an agent's history and use that to learn.

## repo

Clone an agent's repo, and its log is the agent's trajectory: every attempt, every fix, every answer.

## recall

Here's a simple way agents can use Artifacts to learn. When a run produces an answer, Workers AI embeds the question and the code into Cloudflare Vectorize. The next agent with a similar question searches for similar solutions and uses that for better context.

## walkthrough

Here's one real task from the benchmark: if a fee only applied to one account type in 2023, which merchants would it affect? Without memory, the agent wrote ten programs, ran out of steps, and gave up. With memory, it started from three runs of similar questions, and got it right in two programs, with eight thousand tokens instead of two hundred and seventy-nine thousand.

## provenance

And it's all in Artifacts. Clone that agent's repo, and its commit names the exact runs it learned from. Follow the link to the next repo, and there's the code it started from.

## curve

At scale, we ran the DABstep benchmark: four hundred and fifty real multi-step data investigations over payments data. With no code stored in Artifacts, both arms cost the same. However, as Code Mode and Vectorize index more programs, the median cost per task drops to about a third, within the first few dozen tasks, and it stays there.

## accuracy

And they're not just cheaper. They're right more often. Scored by DABstep: forty-six percent overall, up from thirty-two.

## contagion

We also learned what kind of memory works. Our first version distilled runs into a shared library of verified skills. One wrong skill spread to every agent that used it. Raw runs, labeled unverified, worked better, because each agent still runs its own code.

## next-steps

What's next. Today, a run becomes memory when it produces an answer. Next, we'll record whether that answer was right, as a git note on the commit, so agents learn from the runs that worked. Artifacts events can index each run the moment it's pushed. And agents can review their own history between tasks.

## new-worker

Getting started takes about a minute. Create a Worker with the cf CLI, and install Code Mode and codemode-git. Add the connector and three bindings: Artifacts, a Worker Loader, and a Durable Object. A dry run shows everything wired up.

## close

It's on npm: three lines in any Code Mode agent. Keep the code, and your Workers get smarter over time.

## credits

Built by Clay Smith, on Cloudflare. Thanks for watching.
