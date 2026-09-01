// ZIP code -> latitude/longitude/city, for sources that search by coordinates.
// Uses the free, keyless Zippopotam service and caches results in memory.

const cache = new Map();

export async function zipToPlace(zip) {
  if (cache.has(zip)) return cache.get(zip);
  const r = await fetch(`https://api.zippopotam.us/us/${zip}`);
  if (!r.ok) throw new Error(`Unknown ZIP code ${zip}`);
  const j = await r.json();
  const p = j.places?.[0];
  if (!p) throw new Error(`Unknown ZIP code ${zip}`);
  const place = {
    zip,
    lat: Number(p.latitude),
    lng: Number(p.longitude),
    city: p["place name"],
    state: p["state abbreviation"],
  };
  cache.set(zip, place);
  return place;
}

// Straight-line miles between two coordinates.
export function milesBetween(a, b) {
  const R = 3958.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
