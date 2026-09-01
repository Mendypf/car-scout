// Listing sources. Each returns listings in the shared shape below and reports
// its own cost, so a broken source degrades the search instead of killing it.
//
// Nothing here needs a paid search API. CARFAX is fetched directly from the
// public endpoint its own site uses; Facebook Marketplace joins in if a
// ScrapeCreators key is set; and anything the user's own agent finds arrives
// through the MCP import tool.
//
// Shared listing shape:
// { id, source, vin, title, year, make, model, trim, price, mileage,
//   condition, dealRating, url, photo, distance, daysListed, history,
//   privateSeller, dealer: { name, phone, city, state } }

import { config, PRICES } from "./config.js";
import { zipToPlace, milesBetween } from "./geo.js";

const title = (s) =>
  (s || "").trim().replace(/\S+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
const num = (v) => {
  const n = Number(String(v ?? "").replace(/[^0-9.]/g, ""));
  return isFinite(n) && n > 0 ? n : null;
};

// Keyword marketplaces return anything mentioning the car: shirts, mud flaps,
// sunshades. A real drivable car costs four figures and isn't titled like an
// accessory.
const NOT_A_CAR =
  /\b(t-?shirts?|tees?|hoodie|sweatshirt|hats?|toys?|lego|poster|decals?|stickers?|emblems?|badges?|keychain|key ?fobs?|mugs?|mud ?flaps?|floor ?mats?|seat ?covers?|car cover|sun ?shades?|sunshade|visors?|rims?|tires?|lug ?nuts?|hubcaps?|grille|headlights?|tail ?lights?|taillights?|fenders?|bumpers?|wipers?|antenna|spoiler|running ?boards?|roof ?rack|tonneau|bed ?liner|parts? only|for parts|part ?out|wheels? (and|&) tires?|size [smlx0-9]+)\b/i;

const looksLikeAVehicle = (title, price, { minPrice = 0 } = {}) =>
  !NOT_A_CAR.test(title || "") && (!minPrice || !price || price >= minPrice);

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
  Accept: "application/json",
};

function carfaxNormalize(l) {
  return {
    id: `carfax:${l.id}`,
    source: "carfax",
    vin: l.vin || null,
    title: [l.year, l.make, l.model, l.trim].filter(Boolean).join(" "),
    year: num(l.year),
    make: l.make,
    model: l.model,
    trim: l.trim || null,
    price: num(l.currentPrice ?? l.listPrice),
    mileage: num(l.mileage),
    condition: l.vehicleCondition?.toLowerCase() || null,
    dealRating: null,
    url: l.vdpUrl || null,
    photo: l.images?.large?.[0] || null,
    distance: typeof l.distanceToDealer === "number" ? l.distanceToDealer : num(l.distanceToDealer),
    // A car listed for weeks is either overpriced or already sold and not
    // taken down; either way it is the one worth calling about.
    daysListed: l.firstSeen
      ? Math.max(0, Math.round((Date.now() - new Date(l.firstSeen)) / 86400000))
      : null,
    history:
      [l.noAccidents ? "no accidents" : null, l.oneOwner ? "1 owner" : null]
        .filter(Boolean)
        .join(", ") || null,
    privateSeller: false,
    dealer: {
      name: l.dealer?.name || null,
      phone: l.dealer?.phone || null,
      city: l.dealer?.city || null,
      state: l.dealer?.state || null,
    },
  };
}

// Free: the same API carfax.com's own search page calls.
async function carfax(q, condition) {
  const url = new URL("https://helix.carfax.com/search/v2/vehicles");
  url.searchParams.set("zip", q.zip);
  url.searchParams.set("radius", String(q.radius));
  url.searchParams.set("make", title(q.make));
  url.searchParams.set("model", title(q.model));
  url.searchParams.set("rows", "50");
  url.searchParams.set("page", "1");
  url.searchParams.set("vehicleCondition", condition);
  const r = await fetch(url, { headers: BROWSER_HEADERS });
  if (!r.ok) throw new Error(`CARFAX answered ${r.status}`);
  const j = await r.json();
  const listings = (j.listings || []).map(carfaxNormalize).filter(
    (l) =>
      (!q.yearMin || (l.year && l.year >= q.yearMin)) &&
      (!q.yearMax || (l.year && l.year <= q.yearMax)) &&
      (!q.priceMax || (l.price && l.price <= q.priceMax)) &&
      (!q.mileageMax || (l.mileage && l.mileage <= q.mileageMax))
  );
  return { listings, cost: 0 };
}

// Craigslist — free, via the same API its own site uses. Items arrive as
// compact positional arrays; tagged sub-arrays carry the parts we need, and
// posting ids are offsets from decode.minPostingId. All of this was worked
// out against live responses.
let clAreas = null;
async function craigslistArea(place) {
  if (!clAreas) {
    const r = await fetch("https://reference.craigslist.org/Areas", { headers: BROWSER_HEADERS });
    if (!r.ok) throw new Error(`Craigslist areas answered ${r.status}`);
    clAreas = await r.json();
  }
  let best = null;
  for (const a of clAreas) {
    if (a.Country !== "US") continue;
    const dist = milesBetween(place, { lat: a.Latitude, lng: a.Longitude });
    if (!best || dist < best.dist) best = { area: a, dist };
  }
  return best.area;
}

async function craigslist(q) {
  const place = await zipToPlace(q.zip);
  const area = await craigslistArea(place);
  const url = new URL("https://sapi.craigslist.org/web/v8/postings/search/full");
  url.searchParams.set("batch", `${area.AreaID}-0-360-0-0`);
  url.searchParams.set("cc", "US");
  url.searchParams.set("lang", "en");
  url.searchParams.set("searchPath", "cta");
  url.searchParams.set("query", `${q.make} ${q.model}`);
  const r = await fetch(url, { headers: BROWSER_HEADERS });
  if (!r.ok) throw new Error(`Craigslist answered ${r.status}`);
  const j = await r.json();
  const minId = j?.data?.decode?.minPostingId || 0;
  const tagged = (it, tag) => it.find((x) => Array.isArray(x) && x[0] === tag);

  const listings = (j?.data?.items || [])
    .map((it) => {
      const title = typeof it[it.length - 1] === "string" ? it[it.length - 1] : "";
      const slug = tagged(it, 6)?.[1];
      const token = tagged(it, 13)?.[1];
      const imgs = tagged(it, 4);
      const odo = tagged(it, 9)?.[1];
      const geo = it.find((x) => typeof x === "string" && /^\d+:\d+~/.test(x));
      const [lat, lng] = geo ? geo.split("~").slice(1).map(Number) : [null, null];
      const yearM = title.match(/\b(19[89]\d|20[0-4]\d)\b/);
      return {
        id: `cl:${minId + it[0]}`,
        source: "craigslist",
        vin: null,
        title: title.slice(0, 100),
        year: yearM ? Number(yearM[1]) : null,
        make: q.make,
        model: q.model,
        trim: null,
        price: typeof it[3] === "number" && it[3] > 0 ? it[3] : null,
        mileage: num(odo),
        condition: "used",
        dealRating: null,
        url: slug && token ? `https://www.craigslist.org/view/d/${slug}/${token}` : null,
        photo: imgs?.[1] ? `https://images.craigslist.org/${String(imgs[1]).replace(/^\d+:/, "")}_600x450.jpg` : null,
        distance: lat ? Math.round(milesBetween(place, { lat, lng })) : null,
        daysListed: null,
        history: null,
        privateSeller: it[2] === 145,
        dealer: { name: it[2] === 145 ? null : "craigslist dealer", phone: null, city: null, state: null },
      };
    })
    .filter(
      (l) =>
        l.url &&
        looksLikeAVehicle(l.title, l.price) &&
        l.title.toLowerCase().includes(q.model.toLowerCase()) &&
        (!q.yearMin || (l.year && l.year >= q.yearMin)) &&
        (!q.yearMax || (l.year && l.year <= q.yearMax)) &&
        (!q.priceMax || (l.price && l.price <= q.priceMax)) &&
        (!q.mileageMax || !l.mileage || l.mileage <= q.mileageMax) &&
        (!l.distance || l.distance <= q.radius * 1.5)
    )
    .slice(0, 50);
  return { listings, cost: 0 };
}

// Facebook Marketplace via ScrapeCreators. Field names come from a real
// response, not the docs.
async function marketplace(q) {
  const place = await zipToPlace(q.zip);
  const url = new URL("https://api.scrapecreators.com/v1/facebook/marketplace/search");
  url.searchParams.set("query", `${q.make} ${q.model}`);
  url.searchParams.set("lat", String(place.lat));
  url.searchParams.set("lng", String(place.lng));
  url.searchParams.set("availability", "available");
  if (q.priceMax) url.searchParams.set("max_price", String(q.priceMax));
  if (q.radius) url.searchParams.set("radius", String(q.radius));

  const r = await fetch(url, { headers: { "x-api-key": config.scrapeCreatorsKey } });
  const text = await r.text();
  let j = null;
  try {
    j = JSON.parse(text);
  } catch {
    /* ignore */
  }
  if (!r.ok) throw new Error(`ScrapeCreators ${r.status}: ${(j?.message || text).slice(0, 200)}`);

  const yearOf = (t) => {
    const m = String(t || "").match(/\b(19[89]\d|20[0-4]\d)\b/);
    return m ? Number(m[1]) : null;
  };
  const listings = (j?.listings || [])
    .filter((l) => !l.is_sold && !l.is_pending && l.is_live !== false)
    .map((l) => ({
      id: `fb:${l.id}`,
      source: "facebook",
      vin: null,
      title: String(l.title || "").replace(/\s*·\s*/g, " "),
      year: yearOf(l.title),
      make: q.make,
      model: q.model,
      trim: null,
      price: num(l.price?.amount),
      mileage: num(l.mileage?.value),
      condition: "used",
      dealRating: null,
      url: l.url || `https://www.facebook.com/marketplace/item/${l.id}/`,
      photo: l.primary_photo?.url || null,
      distance: null,
      daysListed: null,
      history: null,
      privateSeller: true,
      dealer: {
        name: [l.location?.city, l.location?.state].filter(Boolean).join(", ") || null,
        phone: null,
        city: l.location?.city || null,
        state: l.location?.state || null,
      },
    }))
    .filter(
      (l) =>
        l.title &&
        looksLikeAVehicle(l.title, l.price, { minPrice: 300 }) &&
        (!q.yearMin || !l.year || l.year >= q.yearMin) &&
        (!q.yearMax || !l.year || l.year <= q.yearMax) &&
        (!q.priceMax || !l.price || l.price <= q.priceMax) &&
        (!q.mileageMax || !l.mileage || l.mileage <= q.mileageMax)
    );
  return { listings, cost: (j?.credits_charged ?? 1) * PRICES.search.facebook };
}

const SOURCES = [
  { name: "carfax-used", applies: (q) => q.stockType !== "new", fetch: (q) => carfax(q, "USED") },
  { name: "carfax-new", applies: (q) => q.stockType !== "used", fetch: (q) => carfax(q, "NEW") },
  { name: "craigslist", applies: (q) => q.stockType !== "new", fetch: craigslist },
  {
    name: "facebook",
    applies: (q) => q.stockType !== "new" && !!config.scrapeCreatorsKey,
    fetch: marketplace,
  },
];

export function activeSourceNames(q) {
  return SOURCES.filter((s) => s.applies(q)).map((s) => s.name);
}

export async function searchCars(q) {
  const active = SOURCES.filter((s) => s.applies(q));
  const settled = await Promise.allSettled(active.map((s) => s.fetch(q)));

  const sourceStatus = {};
  let cost = 0;
  const all = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") {
      sourceStatus[active[i].name] = { ok: true, count: r.value.listings.length, cost: r.value.cost };
      cost += r.value.cost;
      all.push(...r.value.listings);
    } else {
      sourceStatus[active[i].name] = {
        ok: false,
        error: String(r.reason?.message || r.reason).slice(0, 200),
      };
    }
  });

  // Dedupe by VIN, preferring the entry that carries a dealer phone.
  const byVin = new Map();
  const deduped = [];
  for (const l of all) {
    if (!l.vin) {
      deduped.push(l);
      continue;
    }
    const prev = byVin.get(l.vin);
    if (!prev) {
      byVin.set(l.vin, l);
      deduped.push(l);
    } else if (!prev.dealer.phone && l.dealer.phone) {
      Object.assign(prev, l);
    }
  }

  deduped.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
  return { listings: deduped, cost: Math.round(cost * 10000) / 10000, sourceStatus };
}
