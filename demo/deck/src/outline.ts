import outlineMd from "../outline.md?raw";
import transcriptMd from "../../video/transcript.md?raw";

export type OutlineSlide = { id: string; prompt: string; notes: string };

/** `## <id>` sections of a markdown file, HTML comments removed, in order. */
function sections(md: string): [string, string][] {
  return md
    .replace(/<!--[\s\S]*?-->/g, "")
    .split(/^## +/m)
    .slice(1)
    .map((s) => {
      const [head, ...body] = s.split("\n");
      return [head!.trim(), body.join("\n").trim()];
    });
}

const notes = new Map(sections(transcriptMd));

export const outline: OutlineSlide[] = sections(outlineMd).map(([id, prompt]) => ({ id, prompt, notes: notes.get(id) ?? "" }));
