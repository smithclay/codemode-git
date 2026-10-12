import { CodemodeConnector, type ConnectorTools } from "@cloudflare/codemode";

// A deterministic stand-in for the wall of lava lamps in Cloudflare's San
// Francisco lobby, whose flowing wax seeds LavaRand. The wall is paginated on
// purpose: "walk every page" is a sub-problem many agents solve on their own,
// so near-identical runs pile up across agents' Artifacts repos. That's what
// examples retrieval reuses.

type Status = "flowing" | "warming" | "off";
type Lamp = { id: number; row: number; col: number; wax: string; status: Status; hoursOn: number };

const ROWS = 10;
const COLS = 10;
const WAX = ["red", "orange", "yellow", "green", "blue", "purple", "pink"];
// Mostly flowing, some warming up, a few burnt out.
const STATUS: Status[] = ["flowing", "flowing", "flowing", "warming", "flowing", "off", "flowing", "warming", "flowing"];

const WALL: Lamp[] = Array.from({ length: ROWS * COLS }, (_, i) => ({
  id: i + 1,
  row: Math.floor(i / COLS) + 1,
  col: (i % COLS) + 1,
  wax: WAX[(i * 3) % WAX.length]!,
  status: STATUS[(i * 7) % STATUS.length]!,
  hoursOn: (i * 37) % 2000
}));

const PAGE_SIZE = 12;

export class LampsConnector extends CodemodeConnector {
  name() {
    return "lamps";
  }

  protected instructions() {
    return `The lava lamp wall: ${ROWS} rows of ${COLS} lamps. wall() is paginated; follow nextCursor until it is null to see every lamp.`;
  }

  protected tools(): ConnectorTools {
    return {
      wall: {
        description: `List lamps on the wall, optionally filtered by row, wax color or status. Returns at most ${PAGE_SIZE} lamps per page plus nextCursor.`,
        inputSchema: {
          type: "object",
          properties: {
            row: { type: "number" },
            wax: { type: "string", enum: WAX },
            status: { type: "string", enum: ["flowing", "warming", "off"] },
            cursor: { type: ["string", "null"] }
          }
        },
        execute: (args) => {
          const { row, wax, status, cursor } = (args ?? {}) as {
            row?: number;
            wax?: string;
            status?: Status;
            cursor?: string | null;
          };
          const matches = WALL.filter(
            (l) => (!row || l.row === row) && (!wax || l.wax === wax) && (!status || l.status === status)
          );
          const start = cursor ? Number(cursor) : 0;
          const end = start + PAGE_SIZE;
          return { lamps: matches.slice(start, end), nextCursor: end < matches.length ? String(end) : null };
        }
      },
      get: {
        description: "Get one lamp by id.",
        inputSchema: { type: "object", properties: { id: { type: "number" } }, required: ["id"] },
        execute: (args) => WALL.find((l) => l.id === (args as { id: number }).id) ?? null
      }
    };
  }
}
