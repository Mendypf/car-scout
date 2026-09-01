import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { searchCars, activeSourceNames } from "./lib/sources.js";
import { dealersFromListings, mergeAgentDealers, findNearbyDealers } from "./lib/dealers.js";
import { startCampaign } from "./lib/calls.js";
import { openStore } from "./lib/store.js";
import { listPhoneNumbers, firstMessage, systemPrompt, buildCallBody } from "./lib/vapi.js";
import { config, PRICES, VOICE } from "./lib/config.js";

const app = express();
const store = openStore();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const fail = (res, e) => res.status(500).json({ error: String(e?.message || e).slice(0, 400) });

function readQuery(body) {
  return {
    zip: String(body.zip || "").trim(),
    radius: Number(body.radius) || 50,
    make: String(body.make || "").trim(),
    model: String(body.model || "").trim(),
    stockType: ["new", "used", "both"].includes(body.stockType) ? body.stockType : "both",
    yearMin: Number(body.yearMin) || null,
    yearMax: Number(body.yearMax) || null,
    priceMax: Number(body.priceMax) || null,
    mileageMax: Number(body.mileageMax) || null,
  };
}

app.get("/api/health", async (_req, res) => {
  try {
    let vapi = { ok: false, numbers: [], error: null };
    if (config.vapiKey) {
      try {
        const nums = await listPhoneNumbers(config.vapiKey);
        vapi = {
          ok: true,
          numbers: (Array.isArray(nums) ? nums : []).map((n) => ({
            id: n.id,
            number: n.number || n.sipUri || "",
            name: n.name || null,
          })),
          error: null,
        };
      } catch (e) {
        vapi = { ok: false, numbers: [], error: String(e.message).slice(0, 200) };
      }
    }
    res.json({
      vapi,
      selectedPhoneNumberId: config.vapiPhoneNumberId || vapi.numbers[0]?.id || null,
      marketplace: !!config.scrapeCreatorsKey,
      vapiPublicKey: config.vapiPublicKey,
      prices: PRICES,
      spend: store.data.spend,
    });
  } catch (e) {
    fail(res, e);
  }
});

app.post("/api/settings", (req, res) => {
  try {
    config.set({
      vapiKey: req.body.vapiKey,
      vapiPhoneNumberId: req.body.vapiPhoneNumberId,
      vapiPublicKey: req.body.vapiPublicKey,
      scrapeCreatorsKey: req.body.scrapeCreatorsKey,
    });
    res.json({ ok: true });
  } catch (e) {
    fail(res, e);
  }
});

// What a search will cost before running it.
app.post("/api/search/quote", (req, res) => {
  const lines = activeSourceNames(readQuery(req.body)).map((n) => ({
    source: n,
    cost: PRICES.search[n] ?? 0,
  }));
  res.json({ lines, total: Math.round(lines.reduce((s, l) => s + l.cost, 0) * 100000) / 100000 });
});

app.post("/api/search", async (req, res) => {
  try {
    const q = readQuery(req.body);
    if (!/^\d{5}$/.test(q.zip)) return res.status(400).json({ error: "Enter a 5-digit ZIP code." });
    if (!q.make || !q.model) return res.status(400).json({ error: "Enter a make and a model." });

    const result = await searchCars(q);
    // Fold in whatever the user's own agent imported, minus duplicates.
    const seen = new Set(result.listings.map((l) => l.vin || l.url).filter(Boolean));
    const agentRows = (store.data.agentListings || []).filter(
      (l) => !seen.has(l.vin) && !seen.has(l.url)
    );
    const listings = [...result.listings, ...agentRows].sort(
      (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity)
    );
    if (agentRows.length) result.sourceStatus["your agent"] = { ok: true, count: agentRows.length, cost: 0 };

    const dealers = mergeAgentDealers(dealersFromListings(listings), store.data.agentDealers);
    store.addSpend(result.cost);
    store.data.lastSearch = { q, at: new Date().toISOString(), count: listings.length };
    store.data.lastDealers = dealers;
    store.save();
    res.json({ ...result, listings, dealers, spend: store.data.spend });
  } catch (e) {
    fail(res, e);
  }
});

// Free: the dealers attached to the last search, plus any the agent imported.
app.get("/api/dealers", (_req, res) => {
  res.json({ dealers: mergeAgentDealers(store.data.lastDealers || [], store.data.agentDealers), cost: 0 });
});

// Free: every dealership OpenStreetMap knows near the ZIP, phones filled in
// from OSM tags or the dealer's own site where possible.
app.post("/api/dealers/nearby", async (req, res) => {
  try {
    const zip = String(req.body.zip || "").trim();
    if (!/^\d{5}$/.test(zip)) return res.status(400).json({ error: "Enter a 5-digit ZIP code." });
    const dealers = await findNearbyDealers({
      zip,
      radius: Number(req.body.radius) || 30,
      make: String(req.body.make || "").trim(),
    });
    res.json({ dealers, cost: 0 });
  } catch (e) {
    fail(res, e);
  }
});

// Listings and dealerships the user's own agent found (via MCP).
app.post("/api/listings/import", (req, res) => {
  const raw = Array.isArray(req.body.listings) ? req.body.listings.slice(0, 60) : [];
  if (!raw.length) return res.status(400).json({ error: "No listings given." });
  const stamp = Date.now();
  const incoming = raw
    .filter((l) => l && l.title)
    .map((l, i) => ({
      id: `agent:${l.vin || l.url || i}:${stamp}`,
      source: "your agent",
      sourceSite: String(l.sourceSite || "").slice(0, 60) || null,
      vin: l.vin || null,
      title: String(l.title).slice(0, 120),
      year: Number(l.year) || null,
      make: null,
      model: null,
      trim: null,
      price: Number(l.price) || null,
      mileage: Number(l.mileage) || null,
      condition: l.condition === "new" || l.condition === "used" ? l.condition : null,
      dealRating: null,
      url: typeof l.url === "string" ? l.url : null,
      photo: typeof l.photo === "string" ? l.photo : null,
      distance: null,
      daysListed: null,
      history: null,
      privateSeller: false,
      dealer: {
        name: l.dealerName || null,
        phone: l.dealerPhone || null,
        city: l.city || null,
        state: l.state || null,
      },
    }));
  // Add to what the agent already sent — an agent that imports in batches
  // shouldn't wipe its earlier finds.
  const keyOf = (l) => l.vin || l.url || l.title;
  const merged = new Map((store.data.agentListings || []).map((l) => [keyOf(l), l]));
  for (const l of incoming) merged.set(keyOf(l), l);
  store.data.agentListings = [...merged.values()].slice(-120);
  store.save();
  res.json({ count: store.data.agentListings.length, added: incoming.length });
});

app.post("/api/listings/clear", (_req, res) => {
  store.data.agentListings = [];
  store.data.agentDealers = [];
  store.save();
  res.json({ ok: true });
});

app.post("/api/dealers/import", (req, res) => {
  const raw = Array.isArray(req.body.dealers) ? req.body.dealers.slice(0, 60) : [];
  if (!raw.length) return res.status(400).json({ error: "No dealerships given." });
  const incoming = raw
    .filter((d) => d && d.name && d.phone)
    .map((d) => ({
      id: `agent:${String(d.phone).replace(/\D/g, "")}`,
      name: String(d.name).slice(0, 90),
      phone: String(d.phone),
      address: d.address ? String(d.address).slice(0, 120) : null,
      origin: "agent",
      cars: [],
    }));
  const merged = new Map((store.data.agentDealers || []).map((d) => [d.id, d]));
  for (const d of incoming) merged.set(d.id, d);
  store.data.agentDealers = [...merged.values()].slice(-120);
  store.data.lastDealers = mergeAgentDealers(store.data.lastDealers || [], store.data.agentDealers);
  store.save();
  res.json({ count: store.data.agentDealers.length, added: incoming.length });
});

// Exactly what the call will say. Free — same functions the live call uses.
app.post("/api/call-script", (req, res) => {
  const car = String(req.body.carDescription || "the car you're after").trim();
  const dealer = String(req.body.dealerName || "the dealership").trim();
  res.json({ opening: firstMessage(car), rules: systemPrompt(car, dealer) });
});

// The assistant config the browser needs to run the same call in-page —
// including any edits, so what you hear is what will be said.
app.post("/api/preview-assistant", (req, res) => {
  const body = buildCallBody({
    phoneNumberId: "unused",
    to: "+10000000000",
    carDescription: String(req.body.carDescription || "the car you're after").trim(),
    dealerName: "the dealership",
    voice: VOICE,
    opening: req.body.opening,
    rules: req.body.rules,
  });
  res.json({ publicKey: config.vapiPublicKey, assistant: body.assistant });
});

app.post("/api/campaigns", (req, res) => {
  try {
    const { carDescription, dealers } = req.body;
    const phoneNumberId = req.body.phoneNumberId || config.vapiPhoneNumberId;
    if (!config.vapiKey) return res.status(400).json({ error: "Add your Vapi API key in Settings." });
    if (!phoneNumberId) return res.status(400).json({ error: "Pick the Vapi number to call from." });
    if (!carDescription?.trim()) return res.status(400).json({ error: "Say which car to ask about." });
    if (!Array.isArray(dealers) || dealers.length === 0)
      return res.status(400).json({ error: "Pick at least one dealership." });
    if (dealers.length > 40) return res.status(400).json({ error: "40 dealerships max per run." });

    const campaign = startCampaign(store, {
      carDescription: carDescription.trim(),
      dealers,
      phoneNumberId,
      opening: typeof req.body.opening === "string" ? req.body.opening.slice(0, 800) : undefined,
      rules: typeof req.body.rules === "string" ? req.body.rules.slice(0, 9000) : undefined,
    });
    res.json({ id: campaign.id });
  } catch (e) {
    fail(res, e);
  }
});

app.get("/api/campaigns", (_req, res) => res.json(store.data.campaigns.slice(0, 20)));

app.get("/api/campaigns/:id", (req, res) => {
  const c = store.data.campaigns.find((c) => c.id === req.params.id);
  if (!c) return res.status(404).json({ error: "No run with that id." });
  res.json(c);
});

const PORT = process.env.PORT || 4310;
// Localhost only: this API holds keys and can spend money, so it should never
// be reachable from the rest of the network. HOST=0.0.0.0 opts out.
const HOST = process.env.HOST || "127.0.0.1";
app.listen(PORT, HOST, () => console.log(`Car Scout → http://localhost:${PORT}`));
