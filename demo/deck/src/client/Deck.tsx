import { useCallback, useEffect, useRef, useState } from "react";
import type { Turn } from "../worker/agent";
import type { AgentReply, Deck, DeckSlide } from "../worker/index";
import { SlideView } from "./SlideView";

// The presenter. Slides render from the deck-slides repo. Anyone can view;
// someone signed in through Cloudflare Access (or anyone, in local dev) can
// edit: the chat panel talks to the deck agent, which changes slides with
// Code Mode programs.
//
// Keys: → / space / click next · ← back · N notes · F fullscreen · E sign in
// to edit · C chat · G build/rewrite this slide. Add ?print for a
// one-slide-per-page view to save as PDF (npm run pdf).

const fetchDeck = () => fetch("/api/deck").then((r) => (r.ok ? (r.json() as Promise<Deck>) : null)).catch(() => null);
const printing = new URLSearchParams(location.search).has("print");

export function DeckApp() {
  const [deck, setDeck] = useState<Deck | null | undefined>(undefined);
  useEffect(() => {
    void fetchDeck().then(setDeck);
  }, []);
  if (deck === undefined) return <div className="stage" />;
  if (!deck) return <div className="stage empty">Couldn't load /api/deck.</div>;
  return printing ? <Print deck={deck} /> : <Presenter deck={deck} setDeck={setDeck} />;
}

/** Every built slide, one per page, without animation: for the PDF. */
function Print({ deck }: { deck: Deck }) {
  useEffect(() => {
    document.body.classList.add("print");
    // A hook for scripts/pdf.mjs: printing waits until the slides are drawn.
    (window as unknown as { deckReady?: boolean }).deckReady = true;
  }, []);
  return (
    <>
      {deck.slides.filter((s) => s.slide).map((s) => (
        <section key={s.id} className="page">
          <SlideView slide={s.slide!} />
        </section>
      ))}
    </>
  );
}

function Presenter({ deck, setDeck }: { deck: Deck; setDeck: (d: Deck) => void }) {
  const slides = deck.slides;
  const [i, setI] = useState(() => Math.min(Math.max(0, Number(location.hash.slice(1)) - 1 || 0), Math.max(0, slides.length - 1)));
  const [notes, setNotes] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [working, setWorking] = useState<{ since: number; message: string } | null>(null);
  const current: DeckSlide | undefined = slides[i];

  const say = useCallback((text: string) => {
    setToast(text);
    setTimeout(() => setToast((t) => (t === text ? null : t)), 4000);
  }, []);

  // Editing is on when /api/agent answers. Signed out, Cloudflare Access
  // redirects the request to its login page instead (seen here as an opaque
  // redirect), and the deck stays view-only.
  const [editor, setEditor] = useState<string | null>(null);
  const signIn = useCallback(() => location.assign(`/edit?slide=${i + 1}`), [i]);
  useEffect(() => {
    void (async () => {
      const me = await fetch("/api/agent/me", { redirect: "manual" }).catch(() => null);
      if (!me?.ok) return;
      setEditor(((await me.json()) as { editor: string }).editor);
      const res = await fetch("/api/agent", { redirect: "manual" }).catch(() => null);
      if (res?.ok) setTurns((await res.json()) as Turn[]);
    })();
  }, []);

  const send = useCallback(
    async (message: string, effort: "low" | "high" = "low") => {
      if (!editor) return say("Press E to sign in and edit");
      if (working) return say("The agent is still working");
      setWorking({ since: Date.now(), message });
      setTurns((t) => [...t, { role: "user", content: message }]);
      try {
        const res = await fetch("/api/agent", {
          method: "POST",
          redirect: "manual",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message, current: current?.id, effort })
        });
        // The Access session expired: Access redirects instead of answering.
        if (res.type === "opaqueredirect" || res.status === 401) {
          setEditor(null);
          setTurns((t) => [...t, { role: "assistant", content: "⚠ Your sign-in expired. Press E to sign in again." }]);
          return;
        }
        const body = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as AgentReply | { error: string };
        if ("error" in body) {
          setTurns((t) => [...t, { role: "assistant", content: `⚠ ${body.error}` }]);
          return;
        }
        setTurns((t) => [...t, { role: "assistant", content: body.reply }]);
        // Slides may have been added, edited, removed or reordered.
        const next = await fetchDeck();
        if (next) setDeck(next);
        if (body.changed.length) say(`Changed ${body.changed.join(", ")}`);
      } catch (err) {
        setTurns((t) => [...t, { role: "assistant", content: `⚠ ${err instanceof Error ? err.message : String(err)}` }]);
      } finally {
        setWorking(null);
      }
    },
    [editor, working, current, say, setDeck]
  );

  // Keep the position in range when slides are removed.
  useEffect(() => {
    if (i > slides.length - 1) setI(Math.max(0, slides.length - 1));
  }, [i, slides.length]);
  useEffect(() => {
    history.replaceState(null, "", `#${i + 1}`);
  }, [i]);
  useEffect(() => {
    const onHash = () => setI(Math.min(Math.max(0, Number(location.hash.slice(1)) - 1 || 0), Math.max(0, slides.length - 1)));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [slides.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement).closest("textarea, input")) {
        if (e.key === "Escape") setChatOpen(false);
        return;
      }
      const k = e.key.toLowerCase();
      if (k === "arrowright" || k === " " || k === "pagedown") setI((n) => Math.min(n + 1, slides.length - 1));
      else if (k === "arrowleft" || k === "pageup") setI((n) => Math.max(n - 1, 0));
      else if (k === "home") setI(0);
      else if (k === "end") setI(slides.length - 1);
      else if (k === "n") setNotes((v) => !v);
      else if (k === "e" && !editor) signIn();
      else if (k === "c") {
        if (editor) setChatOpen((v) => !v);
        else say("Press E to sign in and edit");
      }
      else if (k === "f") void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
      else if (k === "g" && current) {
        if (!editor) return say("Press E to sign in and edit");
        setChatOpen(true);
        void send(current.slide ? `Rewrite slide ${current.id} from its outline prompt.` : `Build slide ${current.id} from its outline prompt.`, "high");
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [slides.length, current, editor, send, say, signIn]);

  if (!current) return <div className="stage empty">No slides yet: {editor ? "press C and ask the agent to build the deck." : "sign in (E) to have the agent build it."}</div>;

  return (
    <div className="stage" onClick={() => setI((n) => Math.min(n + 1, slides.length - 1))}>
      {current.slide ? (
        <SlideView key={`${current.id}:${current.sha ?? current.updatedAt}`} slide={current.slide} />
      ) : (
        <div className="unbuilt">
          <div className="kicker">NOT BUILT YET{editor ? " · PRESS G TO HAVE THE AGENT WRITE IT" : ""}</div>
          <p>{current.prompt}</p>
        </div>
      )}
      <div className="badge">
        <span>
          {i + 1} / {slides.length}
        </span>
        {current.sha && (
          <span>
            {deck.repo}@{current.sha.slice(0, 7)}
          </span>
        )}
        {working && <Working since={working.since} />}
        {editor ? (
          <span className="editing">editing{editor.includes("@") ? ` as ${editor}` : ""} · C chat · G rewrite</span>
        ) : (
          <a
            href={`/edit?slide=${i + 1}`}
            onClick={(e) => e.stopPropagation()}
          >
            sign in to edit
          </a>
        )}
      </div>
      {notes && (
        <aside className="notes" onClick={(e) => e.stopPropagation()}>
          <h2>{current.id}</h2>
          {current.notes && <p>{current.notes}</p>}
          {current.prompt && <p className="prompt">Prompt: {current.prompt}</p>}
        </aside>
      )}
      {chatOpen && editor && <Chat turns={turns} working={!!working} onSend={send} slide={current.id} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function Working({ since }: { since: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="pulse">agent working · {Math.floor((Date.now() - since) / 1000)}s</span>;
}

function Chat({ turns, working, onSend, slide }: { turns: Turn[]; working: boolean; onSend: (m: string) => unknown; slide: string }) {
  const [draft, setDraft] = useState("");
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => {
    log.current?.scrollTo(0, log.current.scrollHeight);
  }, [turns, working]);
  const submit = () => {
    const m = draft.trim();
    if (!m || working) return;
    onSend(m);
    setDraft("");
  };
  return (
    <aside className="chat" onClick={(e) => e.stopPropagation()}>
      <header>
        Deck agent <span>· Code Mode · on {slide}</span>
      </header>
      <div className="log" ref={log}>
        {!turns.length && <p className="hint">Try "make the numbers on this slide bigger", "add a slide after this one about pricing" or "delete this slide".</p>}
        {turns.map((t, k) => (
          <p key={k} className={t.role}>
            {t.content}
          </p>
        ))}
        {working && <p className="assistant pulse">Writing code…</p>}
      </div>
      <textarea
        autoFocus
        rows={2}
        value={draft}
        placeholder="Ask for a change (Enter sends, Esc closes)"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
    </aside>
  );
}
