import { CodemodeConnector, type ConnectorTools } from "@cloudflare/codemode";

// A deterministic fake product catalog. Results are paginated on purpose:
// "walk every page" is the kind of sub-problem many agents re-solve, which
// is what the curator should later notice and turn into a shared skill.

type Product = { id: number; name: string; category: string; price: number; stock: number };

const CATEGORIES = ["lamps", "chairs", "desks", "rugs", "shelves"];
const ADJECTIVES = ["Oak", "Brass", "Linen", "Walnut", "Steel", "Cedar", "Velvet", "Cotton", "Maple"];

const PRODUCTS: Product[] = Array.from({ length: 47 }, (_, i) => ({
  id: i + 1,
  name: `${ADJECTIVES[i % ADJECTIVES.length]} ${CATEGORIES[i % CATEGORIES.length]!.slice(0, -1)} ${i + 1}`,
  category: CATEGORIES[i % CATEGORIES.length]!,
  price: 20 + ((i * 37) % 280),
  stock: (i * 13) % 9
}));

const PAGE_SIZE = 10;

export class CatalogConnector extends CodemodeConnector {
  name() {
    return "catalog";
  }

  protected instructions() {
    return "Product catalog. search() is paginated: follow nextCursor until it is null to see every result.";
  }

  protected tools(): ConnectorTools {
    return {
      categories: {
        description: "List product categories.",
        execute: () => CATEGORIES
      },
      search: {
        description: `Search products by text and/or category. Returns at most ${PAGE_SIZE} items per page plus nextCursor.`,
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            category: { type: "string" },
            cursor: { type: ["string", "null"] }
          }
        },
        execute: (args) => {
          const { query, category, cursor } = (args ?? {}) as {
            query?: string;
            category?: string;
            cursor?: string | null;
          };
          const matches = PRODUCTS.filter(
            (p) =>
              (!category || p.category === category) &&
              (!query || p.name.toLowerCase().includes(query.toLowerCase()))
          );
          const start = cursor ? Number(cursor) : 0;
          const end = start + PAGE_SIZE;
          return {
            items: matches.slice(start, end),
            nextCursor: end < matches.length ? String(end) : null
          };
        }
      },
      get: {
        description: "Get one product by id.",
        inputSchema: {
          type: "object",
          properties: { id: { type: "number" } },
          required: ["id"]
        },
        execute: (args) => PRODUCTS.find((p) => p.id === (args as { id: number }).id) ?? null
      }
    };
  }
}
