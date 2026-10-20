// Saves the deck as a PDF, one slide per 16:9 page, from the ?print view, for
// presenting offline. Uses a local Chrome in headless mode.
//
//   npm run pdf                                 (npm run dev in another terminal)
//   DECK_URL=https://… npm run pdf              (a deployed deck)
//   CHROME=/path/to/chrome npm run pdf

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";

const base = (process.env.DECK_URL ?? "http://localhost:5173").replace(/\/$/, "");
const chrome =
  process.env.CHROME ??
  ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((p) => existsSync(p));
if (!chrome) throw new Error("no Chrome found; set CHROME=/path/to/chrome");

const out = new URL("../out/deck.pdf", import.meta.url).pathname;
mkdirSync(new URL("../out/", import.meta.url), { recursive: true });
execFileSync(chrome, [
  "--headless",
  "--disable-gpu",
  "--no-pdf-header-footer",
  "--virtual-time-budget=15000",
  `--print-to-pdf=${out}`,
  `${base}/?print`
], { stdio: "ignore" }); // Chrome logs harmless GPU noise on stderr; a failure still throws.
console.log(`wrote ${out}`);
