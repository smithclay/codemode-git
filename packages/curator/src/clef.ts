import { runAi } from "./ai";
// Clustering and ranking decisions, made by Cloudflare's Clef decision model
// (System One API). Clef reads a state plus typed questions and returns a
// probability for every allowed answer, with all questions scored in one
// forward pass. So one call can check a new run against many candidates.

export const CLEF_MODEL = "@cf/cloudflare/clef";

type Noul = { type: "noul"; instructions?: string; criteria?: { true: string; false: string } };
type Choice = { type: "choice"; instructions?: string; criteria: Record<string, string> };
type Score = { type: "score"; instructions?: string; criteria: string[] };
type Question = Noul | Choice | Score;

type Answer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> }
  | { type: "score"; score: number; confidence: number; probabilities: Record<string, number> };

export type ScriptSummary = { intent: string; code: string };

async function decide(ai: Ai, state: unknown, questions: Record<string, Question>): Promise<Record<string, Answer>> {
  const out = (await runAi(ai, CLEF_MODEL, {
    model: "clef",
    state,
    questions
  })) as { answers?: Record<string, Answer> };
  if (!out.answers) throw new Error("clef returned no answers");
  return out.answers;
}

const trim = (s: ScriptSummary): ScriptSummary => ({ intent: s.intent, code: s.code.slice(0, 2500) });

/**
 * For each candidate, the probability that it does the same kind of task as
 * `run`: one parameterized function could implement both.
 */
export async function sameTask(ai: Ai, run: ScriptSummary, candidates: ScriptSummary[]): Promise<number[]> {
  if (!candidates.length) return [];
  const questions: Record<string, Question> = {};
  candidates.forEach((_, i) => {
    questions[`same_as_c${i}`] = {
      type: "noul",
      instructions: `Does candidate c${i} perform the same kind of task as the run, such that one function with parameters could implement both and return the same kind of value?`,
      criteria: {
        true: "same task; only literal values like categories, ids, thresholds or queries differ",
        false: "a different task, or a different kind of result"
      }
    };
  });
  const answers = await decide(
    ai,
    { run: trim(run), candidates: Object.fromEntries(candidates.map((c, i) => [`c${i}`, trim(c)])) },
    questions
  );
  return candidates.map((_, i) => {
    const a = answers[`same_as_c${i}`];
    return a?.type === "noul" ? a.noul : 0;
  });
}

/** Which existing skill, if any, already does what `run` does. */
export async function coveringSkill(
  ai: Ai,
  run: ScriptSummary,
  skills: { name: string; description: string; code: string }[]
): Promise<{ name: string | null; probability: number }> {
  if (!skills.length) return { name: null, probability: 1 };
  const criteria: Record<string, string> = { none: "No listed skill does this task." };
  for (const s of skills) criteria[s.name] = s.description;
  const answers = await decide(
    ai,
    {
      run: trim(run),
      skills: Object.fromEntries(skills.map((s) => [s.name, { description: s.description, code: s.code.slice(0, 2000) }]))
    },
    {
      covered_by: {
        type: "choice",
        instructions: "Which skill could replace this run if called with the right input? Pick none if no skill does the same task.",
        criteria
      }
    }
  );
  const a = answers.covered_by;
  if (a?.type !== "choice") return { name: null, probability: 0 };
  return { name: a.choice === "none" ? null : a.choice, probability: a.probabilities[a.choice] ?? a.confidence };
}

/** Expected reusability of a task across agents, 0 (one-off) to 2 (broadly reusable). */
export async function reusability(ai: Ai, runs: ScriptSummary[]): Promise<number> {
  const answers = await decide(
    ai,
    { task_examples: runs.slice(0, 4).map(trim) },
    {
      reusability: {
        type: "score",
        instructions: "These scripts were written independently by different agents. How useful would one shared, parameterized function for this task be to other agents?",
        criteria: ["one-off: too specific to be worth sharing", "somewhat reusable", "broadly reusable building block"]
      }
    }
  );
  const a = answers.reusability;
  return a?.type === "score" ? a.score : 0;
}
