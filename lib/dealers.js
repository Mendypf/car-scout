// Who to call. Every dealership here is free to find: they come attached to
// the search results (CARFAX ships each listing's dealer phone), from
// OpenStreetMap for the ones with no matching listing, or from the user's own
// agent through MCP.

import { zipToPlace, milesBetween } from "./geo.js";

const UA = { "User-Agent": "car-scout/0.1 (local car-shopping tool)", Accept: "application/json" };
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];

// All the car dealerships OpenStreetMap knows around a ZIP. Phones come from
// OSM tags when present; otherwise we try the dealer's own website for a
// tel: link. Some dealer sites bot-wall — those rows come back phoneless and
// the user's agent can fill them in via import_dealerships.
export async function findNearbyDealers({ zip, radius = 30, make = "" }) {
  const place = await zipToPlace(zip);
  const query = `[out:json][timeout:30];(nwr["shop"="car"](around:${Math.min(radius, 60) * 1609},${place.lat},${place.lng}););out center tags 120;`;
  let elements = null;
  let lastErr;
  for (const host of OVERPASS) {
    try {
      const r = await fetch(host, { method: "POST", headers: UA, body: query, signal: AbortSignal.timeout(35000) });
      if (!r.ok) throw new Error(`OpenStreetMap answered ${r.status}`);
      elements = (await r.json()).elements || [];
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!elements) throw new Error(`Couldn't reach OpenStreetMap: ${lastErr?.message}`);

  const dealers = elements
    .map((e) => {
      const t = e.tags || {};
      if (!t.name) return null;
      const lat = e.lat ?? e.center?.lat;
      const lng = e.lon ?? e.center?.lon;
      return {
        id: `osm:${e.type}:${e.id}`,
        name: t.name,
        phone: t.phone || t["contact:phone"] || null,
        website: t.website || t["contact:website"] || null,
        address:
          [t["addr:housenumber"], t["addr:street"], t["addr:city"]].filter(Boolean).join(" ") || null,
        distance: lat ? Math.round(milesBetween(place, { lat, lng })) : null,
        origin: "map",
        cars: [],
        matchesMake: make ? t.name.toLowerCase().includes(make.toLowerCase()) : false,
      };
    })
    .filter(Boolean)
    .sort((a, b) => Number(b.matchesMake) - Number(a.matchesMake) || (a.distance ?? 99) - (b.distance ?? 99));

  // Fill missing phones from the dealers' own sites — best effort, capped.
  const phoneless = dealers.filter((d) => !d.phone && d.website).slice(0, 8);
  await Promise.allSettled(
    phoneless.map(async (d) => {
      const r = await fetch(d.website, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/139.0.0.0" },
        signal: AbortSignal.timeout(9000),
      });
      const html = (await r.text()).slice(0, 200000);
      const tel = html.match(/href="tel:([+\d\-(). ]{7,20})"/i)?.[1];
      const loose = tel || html.match(/\(?\b([2-9]\d{2})\)?[-. ]?(\d{3})[-. ]?(\d{4})\b/)?.slice(1).join("");
      if (loose && String(loose).replace(/\D/g, "").length >= 10) d.phone = tel || loose;
    })
  );
  return dealers.slice(0, 60);
}

// Unique dealers that already hold a matching car, with the cars they list.
export function dealersFromListings(listings) {
  const seen = new Map();
  for (const l of listings || []) {
    const d = l.dealer;
    if (!d?.phone || !d?.name) continue;
    const key = String(d.phone).replace(/\D/g, "").slice(-10);
    if (!seen.has(key)) {
      seen.set(key, {
        id: `listing:${key}`,
        name: d.name,
        phone: d.phone,
        address: [d.city, d.state].filter(Boolean).join(", ") || null,
        origin: "listing",
        cars: [],
      });
    }
    seen.get(key).cars.push(l.title);
  }
  return [...seen.values()];
}

// Merge in dealerships the agent imported, skipping ones already listed.
export function mergeAgentDealers(fromListings, agentDealers) {
  const key = (p) => String(p || "").replace(/\D/g, "").slice(-10);
  const have = new Set(fromListings.map((d) => key(d.phone)));
  const extra = (agentDealers || []).filter((d) => d.phone && !have.has(key(d.phone)));
  return [...fromListings, ...extra];
}
