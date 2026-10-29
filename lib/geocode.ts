// Client-side reverse geocoding for the chat header ("Connected · Cagayan de
// Oro"). Uses the Mapbox token the map already needs — no extra service.
//
// Privacy: the coordinates looked up are a peer's *public* dot position,
// which is already privacy-offset 1–3 km and visible to everyone on the map.
// We only ask for city-level names.

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";
const ENDPOINT = "https://api.mapbox.com/search/geocode/v6/reverse";

// Keyed by ~1 km grid cell so repeated lookups for the same area are free.
const cache = new Map<string, Promise<string | null>>();

async function lookup(
  lat: number,
  lng: number,
  type: "place" | "region",
): Promise<string | null> {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lng.toFixed(4),
    types: type,
    // Names in the viewer's language (otherwise Tokyo comes back as 杉並区, 日本).
    language: navigator.language?.split("-")[0] || "en",
    access_token: TOKEN,
  });
  const res = await fetch(`${ENDPOINT}?${params}`);
  if (!res.ok) return null;
  const data = (await res.json()) as {
    features?: {
      properties?: {
        name?: string;
        context?: { country?: { name?: string } };
      };
    }[];
  };
  const props = data.features?.[0]?.properties;
  const name = props?.name;
  if (!name) return null;
  const country = props?.context?.country?.name;
  return country && country !== name ? `${name}, ${country}` : name;
}

// "City, Country" for a coordinate, falling back to "Region, Country" (rural
// areas, at sea). Resolves to null on any failure so callers can omit it.
export function reverseGeocode(
  lat: number,
  lng: number,
): Promise<string | null> {
  if (!TOKEN) return Promise.resolve(null);
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = (async () => {
      try {
        return (
          (await lookup(lat, lng, "place")) ?? (await lookup(lat, lng, "region"))
        );
      } catch {
        return null;
      }
    })();
    cache.set(key, hit);
  }
  return hit;
}
