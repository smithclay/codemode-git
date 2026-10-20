# Demo deck

The demo as a slide deck that a Code Mode agent builds and edits. Each slide is a small program in a Cloudflare Artifacts git repo. The presenter renders slides from that repo, and you change them by chatting with the deck agent, which writes code against the repo.

- **`deck-slides` repo:** `slides/<id>.js` holds the program that draws a slide and `slides/<id>.json` holds what it returned, which is what the presenter renders. `deck.json` holds the slide order, and defaults to [outline.md](outline.md).
- **`deck-agent` repo:** the agent's own Code Mode history. `GitHistoryConnector` commits every program the agent runs, the same as for any codemode-git agent.
- **The agent:** a Workers AI tool-calling loop ([src/worker/agent.ts](src/worker/agent.ts)) around the Code Mode runtime, with a `slides` connector ([src/worker/slides.ts](src/worker/slides.ts)): `outline`, `list`, `read`, `write`, `remove`, `order`, `data`. `slides.write` runs the slide's program in a fresh Dynamic Worker, checks the layout ([src/spec.ts](src/spec.ts)), and commits only when it passes.
- **Slides:** a spec of text, boxes, arrows, agents, charts and code panels on a 1920×1080 canvas, drawn in the demo video's style ([src/client/SlideView.tsx](src/client/SlideView.tsx)). Charts read the real numbers from [../video/src/data.ts](../video/src/data.ts), and speaker notes come from [../video/transcript.md](../video/transcript.md).

A slide that has a program renders straight from the repo. Only a slide without one shows its outline prompt and waits for you to press **G**.

## Run it

It uses the same Artifacts namespace as the example agent. Create the namespace first if you haven't:

```bash
npx cf artifacts namespaces create --namespace codemode-git
```

```bash
npm install          # from the repo root: the deck is an npm workspace
npm run dev -w demo/deck
```

Open http://localhost:5173. Locally anyone can edit; no sign-in.

```bash
npm run deploy -w demo/deck
```

The deployed deck is public to view at https://deck.clay.gripe. Editing goes through **Cloudflare Access**: an Access app covers `deck.clay.gripe/edit` and `deck.clay.gripe/api/agent` with the "only-me" policy. Press **E** (or click "sign in to edit"), sign in, and you're back on the same slide in edit mode. The Worker also checks the Access JWT itself ([src/worker/access.ts](src/worker/access.ts)): its signature, the app's audience (`ACCESS_AUD` in [wrangler.jsonc](wrangler.jsonc)) and expiry. Without those vars, only localhost can edit. Access can't scope itself to paths on `workers.dev`, which is why the deck needs a hostname on a zone. The `workers.dev` URL stays up as a view-only mirror.

`npm run build-slides -w demo/deck` asks the agent to build every slide that has no program yet, one message per slide, at high reasoning effort (a few minutes each). It talks to local dev, since the deployed agent is behind Access. Chat edits use low effort, so they take under a minute.

The local and deployed decks share the `deck-slides` repo, but each keeps its own copy. After committing slides from one, `POST /api/agent/reset` on the other reloads them. Avoid having both write at once: the repo is meant to have one writer.

## Presenting

| Key | |
|---|---|
| → / space / click, ← | next, back |
| N | speaker notes and the slide's prompt |
| F | fullscreen |
| E | sign in to edit (Cloudflare Access) |
| C | chat with the deck agent: "make the numbers bigger", "add a slide after this one about pricing", "delete this slide", "move the credits before close" |
| G | have the agent build or rewrite the current slide from its outline prompt |

The agent adds a slide by writing a program under a new id, removes one with `slides.remove` (the files leave the repo, and git history keeps them), and reorders with `slides.order`.

## Offline

`npm run pdf -w demo/deck` saves every built slide to `demo/deck/out/deck.pdf`, one slide per page, from the `?print` view (it needs `npm run dev` running, or set `DECK_URL`). Keep a copy in case the network goes down.

## Editing the outline

[outline.md](outline.md) has one `## <id>` section per slide, and the prompt goes under it. The agent reads it through `slides.outline()`. A changed prompt doesn't rewrite a slide by itself: press **G** on that slide, or ask the agent.
