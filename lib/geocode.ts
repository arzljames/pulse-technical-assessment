// Client-side reverse geocoding for peer locations ("Cagayan de Oro,
// Philippines" in the chat header, "Near Davao City, Davao del Sur" in the
// request modal). Uses the Mapbox token the map already needs — no extra
// service.
//
// Privacy: the coordinates looked up are a peer's *public* dot position,
// which is already privacy-offset 1–3 km and visible to everyone on the map.
// We only ask for city-level names.

export interface Place {
  name: string; // city, or region when there's no city
  region?: string; // province / state
  country?: string;
}

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";
const ENDPOINT = "https://api.mapbox.com/search/geocode/v6/reverse";

// Keyed by ~1 km grid cell so repeated lookups for the same area are free.
const cache = new Map<string, Promise<Place | null>>();

async function lookup(
  lat: number,
  lng: number,
  type: "place" | "region",
): Promise<Place | null> {
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
        context?: {
          region?: { name?: string };
          country?: { name?: string };
        };
      };
    }[];
  };
  const props = data.features?.[0]?.properties;
  if (!props?.name) return null;
  return {
    name: props.name,
    region: props.context?.region?.name,
    country: props.context?.country?.name,
  };
}

// Place for a coordinate (city, falling back to region for rural areas / at
// sea). Resolves to null on any failure so callers can omit it.
export function reverseGeocode(lat: number, lng: number): Promise<Place | null> {
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

// Append `suffix` unless it's missing or repeats the name.
function withSuffix(name: string, suffix?: string): string {
  return suffix && suffix !== name ? `${name}, ${suffix}` : name;
}

// "Cagayan de Oro, Philippines" — chat header.
export function formatCityCountry(place: Place): string {
  return withSuffix(place.name, place.country);
}

// "Near Tagum, Davao del Norte" — request modal. Falls back to the country
// when there's no region, or when the region is the city itself (Mapbox
// models big cities like Davao City as their own region).
export function formatNear(place: Place): string {
  const region =
    place.region && place.region !== place.name ? place.region : undefined;
  return `Near ${withSuffix(place.name, region ?? place.country)}`;
}
