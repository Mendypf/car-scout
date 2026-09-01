// Car Scout as an MCP server, so the user's own agent (Claude Code, Cursor,
// anything MCP) can drive it. The idea: the agent does the searching with the
// subscription its user already pays for, imports what it finds, and uses
// Car Scout for what an agent can't do itself — the phone calls.
//
//   claude mcp add car-scout -- node <path>/mcp-server.js
//
// The dashboard (npm start) must be running: every tool talks to it over
// http://localhost:4310 so the human sees the same state the agent sees.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE = process.env.CAR_SCOUT_URL || "http://localhost:4310";

async function call(path, body) {
  let r;
  try {
    r = await fetch(BASE + path, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error(`Car Scout isn't running. Start it with \`npm start\` in the car-scout folder (expected at ${BASE}).`);
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `${r.status} ${r.statusText}`);
  return j;
}

const text = (obj) => ({ content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 1) }] });
const errText = (e) => ({ content: [{ type: "text", text: `Error: ${e.message}` }], isError: true });

const server = new McpServer({ name: "car-scout", version: "0.1.0" });

server.tool(
  "search_listings",
  "Search cars for sale near a ZIP code. Free: CARFAX new and used, each row carrying the dealer's phone number (Facebook Marketplace joins in if the user set a ScrapeCreators key). Returns listings sorted by price. This is deliberately not an exhaustive search — do your own web research as well and push what you find with import_listings.",
  {
    make: z.string(),
    model: z.string(),
    zip: z.string().regex(/^\d{5}$/),
    radius: z.number().int().min(5).max(250).default(50),
    stockType: z.enum(["new", "used", "both"]).default("both"),
    yearMin: z.number().int().optional(),
    yearMax: z.number().int().optional(),
    priceMax: z.number().int().optional(),
    mileageMax: z.number().int().optional(),
  },
  async (args) => {
    try {
      const r = await call("/api/search", args);
      return text({
        count: r.listings.length,
        searchCostUsd: r.cost,
        sources: r.sourceStatus,
        listings: r.listings.slice(0, 40),
        callableDealers: r.dealers,
      });
    } catch (e) {
      return errText(e);
    }
  }
);

server.tool(
  "import_listings",
  "Add listings YOU found through your own searching (any site) into Car Scout, so they appear in the user's dashboard tagged as found by their agent, deduped by VIN/URL against other sources. Use real data only — never fabricate a listing, price, or phone number.",
  {
    listings: z
      .array(
        z.object({
          title: z.string(),
          price: z.number().optional(),
          year: z.number().int().optional(),
          mileage: z.number().optional(),
          url: z.string().url().optional(),
          photo: z.string().url().optional(),
          vin: z.string().optional(),
          condition: z.enum(["new", "used"]).optional(),
          sourceSite: z.string().describe("Where you found it, e.g. autotrader.com"),
          dealerName: z.string().optional(),
          dealerPhone: z.string().optional(),
          city: z.string().optional(),
          state: z.string().optional(),
        })
      )
      .min(1)
      .max(60),
  },
  async ({ listings }) => {
    try {
      const r = await call("/api/listings/import", { listings });
      return text(`Imported ${r.count} listings. They now show in the dashboard tagged "your agent".`);
    } catch (e) {
      return errText(e);
    }
  }
);

server.tool(
  "list_dealerships",
  "The dealerships currently callable: the ones holding cars from the last search (their phone numbers come free with the listings), plus any you imported. Free.",
  {},
  async () => {
    try {
      const r = await call("/api/dealers");
      return text(r.dealers);
    } catch (e) {
      return errText(e);
    }
  }
);

server.tool(
  "find_nearby_dealerships",
  "Every car dealership OpenStreetMap knows within range of a ZIP, whether or not they list a matching car — useful for asking a brand store if they can get one. Free. Rows whose phone is null need looking up: find the real number on the dealer's site and send it back with import_dealerships.",
  {
    zip: z.string().regex(/^\d{5}$/),
    radius: z.number().int().min(5).max(60).default(30),
    make: z.string().optional().describe("Ranks matching brand stores first, e.g. Ford"),
  },
  async (args) => {
    try {
      const r = await call("/api/dealers/nearby", args);
      return text({
        found: r.dealers.length,
        withPhone: r.dealers.filter((d) => d.phone).length,
        dealers: r.dealers,
      });
    } catch (e) {
      return errText(e);
    }
  }
);

server.tool(
  "import_dealerships",
  "Add dealerships YOU found through your own web search so they can be called. Use for dealers that had no matching listing — a brand store that might get the car in, say. Real phone numbers only, never invented ones.",
  {
    dealers: z
      .array(
        z.object({
          name: z.string(),
          phone: z.string().describe("Real published number, US format"),
          address: z.string().optional(),
        })
      )
      .min(1)
      .max(60),
  },
  async ({ dealers }) => {
    try {
      const r = await call("/api/dealers/import", { dealers });
      return text(`${r.count} dealerships are now callable.`);
    } catch (e) {
      return errText(e);
    }
  }
);

server.tool(
  "preview_call_script",
  "See the exact opening line and rules the AI caller will use for a given car description. Free. Show this to the user before calling.",
  { carDescription: z.string() },
  async ({ carDescription }) => {
    try {
      return text(await call("/api/call-script", { carDescription }));
    } catch (e) {
      return errText(e);
    }
  }
);

server.tool(
  "call_dealerships",
  "Place REAL phone calls (via the user's Vapi account, ~$0.11/minute each) to dealerships asking if they have the car on the lot and the price. Money is spent and real phones ring: NEVER call this without the user's explicit go-ahead in this conversation — then set confirmedByUser true. Results arrive over a few minutes; poll campaign_status.",
  {
    carDescription: z.string(),
    dealers: z.array(z.object({ name: z.string(), phone: z.string() })).min(1).max(40),
    confirmedByUser: z
      .boolean()
      .describe("True only if the user explicitly approved calling these dealerships just now."),
  },
  async ({ carDescription, dealers, confirmedByUser }) => {
    if (!confirmedByUser)
      return errText(new Error("Ask the user for explicit permission first, then retry with confirmedByUser: true."));
    try {
      const r = await call("/api/campaigns", { carDescription, dealers });
      return text(`Calling ${dealers.length} dealerships. Campaign id: ${r.id}. Poll campaign_status in ~60s.`);
    } catch (e) {
      return errText(e);
    }
  }
);

server.tool(
  "campaign_status",
  "Progress and results of a calling campaign: per-dealer verdict (has_it / no / voicemail / no_answer), summary, transcript, and the exact cost of each call.",
  { campaignId: z.string().optional().describe("Omit for the most recent campaign") },
  async ({ campaignId }) => {
    try {
      if (campaignId) return text(await call(`/api/campaigns/${campaignId}`));
      const all = await call("/api/campaigns");
      return text(all[0] || "No campaigns yet.");
    } catch (e) {
      return errText(e);
    }
  }
);

await server.connect(new StdioServerTransport());
