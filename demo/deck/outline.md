# Deck outline

<!--
One section per slide, in order. The heading is the slide id; the paragraph
under it is the prompt the Code Mode agent writes the slide from. Speaker notes
come from the section with the same id in ../video/transcript.md, if any.

Edit a prompt, redeploy, and press G on that slide to regenerate it. Run
`npm run backup` afterwards to refresh the backup deck.

HTML comments like this one are not part of any prompt.
-->

## thesis

Title slide. Ask the question "What if Cloudflare Artifacts could make Code Mode in Workers self-improving?" over three big lines, with "self-improving?" in amber. Under it, the title "Self-Improving Code Mode Workers, with Artifacts Memory" and the package name codemode-git in mono.

## hook

The headline result: DABstep accuracy went from 32.2% to 46.2% with the same model, prompt and 450 tasks. Two huge numbers with an arrow between them, the new one in orange, and the hard-task numbers smaller underneath. The only change was "+ memory".

## vanish

Today every Code Mode agent writes code, runs it and throws it away. Show a grid of agents, each with a little code snippet, and the caption "every agent starts from zero".

## code-mode

Before and after Code Mode. Left: model and tools with many round-trip arrows, one tool call at a time. Right: the model writes one program (show a few lines of code in a dashed "isolate" box) that calls the tools.

## gap

The isolate is thrown away after every run, and the code goes with it. Show the code box fading out and "the code is gone" in red.

## code-memory

Phase 1, code memory: four agents (michelle, matthew, lena, omar), each with an arrow to its own Artifacts git repo shown as a row of commit dots. Caption: one repo per agent, one writer per repo, zero merges; 1,000 agents made 1,000 commits in 27s with 0 errors.

## under-the-hood

Under the hood, as a left-to-right pipeline of four boxes: execution ends (disposeExecution()), Durable Object (SQLite outbox), isomorphic-git (push, in order), Artifacts repo (one commit per run). Below it, a mono `git clone` line.

## repo

Every attempt, in git: a terminal panel with `git log --oneline` showing three commits for "Count flowing lava lamps", the oldest one an error, the newest two completed.

## recall

Phase 2, learning: michelle's repo feeds Workers AI (embed question + code), which feeds Vectorize (nearest runs), which hands "unverified examples" to the next agent, matthew.

## walkthrough

One real DABstep task (use deck.data("walkthrough")): without memory, 10 programs, 279k tokens, wrong; with memory, 2 programs, 8k tokens, right. Two lanes, one per run, comparing them.

## provenance

Provenance: matthew's commit names the exact runs it learned from. A terminal panel with `git show` output that has a `Codemode-Examples:` trailer pointing at agent-michelle@3f90b41.

## curve

The learning curve (use deck.data("learningCurve")): median tokens per task by position in the run, baseline vs with memory. A line chart; call out that memory costs about a third of the tokens once it has a few dozen runs.

## accuracy

Accuracy by DABstep's official scorer (use deck.data("accuracy")): a bar chart of baseline vs with memory, for Overall and Hard tasks.

## contagion

Which memory works: a shared library of verified skills spread one wrong skill to every agent (show a hub with red spokes), while raw runs labeled unverified worked better (separate agents, mostly green).

## next-steps

Next steps, as three cards: record outcomes (a git note on each commit), index on push (Artifacts events), and learn between tasks (agents review their own history).

## new-worker

Getting started in about a minute: a terminal panel with `npx cf init lava-agent`, `npm install @cloudflare/codemode @smithclay/codemode-git`, the connector plus ARTIFACTS, LOADER and AGENT bindings, then `npx cf deploy --dry-run`.

## close

Close: `npm install @smithclay/codemode-git` in green mono, then exactly these three lines as code (don't change them): `const history = new GitHistoryConnector(ctx, env, { sink });`, `const runtime = history.bind(createCodemodeRuntime({`, `  ctx, executor, connectors: [lamps, history] }));`. Then the tagline "Keep the code." in big amber with "Your Workers get smarter over time." under it.

## credits

Built by Clay Smith, on Cloudflare. A big name, then the tech stack in three short columns: Code (Workers, Code Mode, Artifacts, Durable Objects, Vectorize), Benchmark (DABstep by Adyen, GLM-5.3 Flash), and Presentation (this deck, written by Code Mode). End with github.com/smithclay/codemode-git.
