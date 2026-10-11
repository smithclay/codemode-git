import { CodemodeConnector, type ConnectorTools } from "@cloudflare/codemode";

// The DABstep context files, loaded into D1 by scripts/build_sql.py, exposed
// to the sandbox as `data.*`. Read-only, deterministic and static, so the
// curator can verify skills against it live.

const MAX_ROWS = 5000;

export const SCHEMA = `Tables (SQLite / D1):
- payments(psp_reference, merchant, card_scheme, year, hour_of_day, minute_of_hour, day_of_year, is_credit, eur_amount, ip_country, issuing_country, device_type, ip_address, email_address, card_number, shopper_interaction, card_bin, has_fraudulent_dispute, is_refused_by_adyen, aci, acquirer_country) — one row per transaction; booleans are 0/1.
- fees(ID, card_scheme, account_type, capture_delay, monthly_fraud_level, monthly_volume, merchant_category_code, is_credit, aci, fixed_amount, rate, intracountry) — the fee rules from fees.json. account_type, merchant_category_code and aci are stored as JSON array text (query them with json_each); is_credit is 0/1/NULL. The manual explains how the rules apply.
- merchant_data(merchant, capture_delay, acquirer, merchant_category_code, account_type) — acquirer is a JSON array.
- merchant_category_codes(mcc, description)
- acquirer_countries(acquirer, country_code)
Documents: "manual.md" (business rules: how fees, fraud levels, volumes and ACI work — read it before fee questions) and "payments-readme.md" (column docs).`;

function readOnly(query: string): boolean {
  const q = query.trim().replace(/;\s*$/, "");
  return /^(select|with|pragma)\b/i.test(q) && !q.includes(";");
}

export class DabstepConnector extends CodemodeConnector<{ DB: D1Database }> {
  readonly #db: D1Database;

  constructor(ctx: DurableObjectState | ExecutionContext, env: { DB: D1Database }) {
    super(ctx, env);
    this.#db = env.DB;
  }

  name() {
    return "data";
  }

  protected instructions() {
    return SCHEMA;
  }

  protected tools(): ConnectorTools {
    return {
      sql: {
        description: `Run one read-only SQL query (SELECT/WITH) against the payments database. Returns { rows }. At most ${MAX_ROWS} rows: aggregate in SQL instead of fetching raw transactions. ${SCHEMA}`,
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            params: { type: "array", description: "Positional ? parameters" }
          },
          required: ["query"]
        },
        execute: async (args) => {
          // Models sometimes pass the SQL string directly instead of { query }.
          const { query, params = [] } = (typeof args === "string" ? { query: args } : args) as {
            query: string;
            params?: unknown[];
          };
          if (!readOnly(query)) throw new Error("Only a single SELECT/WITH query is allowed.");
          const { results } = await this.#db.prepare(query).bind(...params).all();
          if (results.length > MAX_ROWS) {
            throw new Error(`Query returned ${results.length} rows (max ${MAX_ROWS}). Aggregate in SQL or add a LIMIT.`);
          }
          return { rows: results };
        }
      },
      doc: {
        description: 'Read a document: "manual.md" (fee and fraud rules) or "payments-readme.md".',
        inputSchema: {
          type: "object",
          properties: { name: { type: "string", enum: ["manual.md", "payments-readme.md"] } },
          required: ["name"]
        },
        execute: async (args) => {
          const { name } = (typeof args === "string" ? { name: args } : args) as { name: string };
          const row = await this.#db.prepare("SELECT content FROM documents WHERE name = ?").bind(name).first<{ content: string }>();
          if (!row) throw new Error(`No document "${name}".`);
          return row.content;
        }
      }
    };
  }
}
