// Rough continent for a coordinate, from a handful of lat/lng boxes. Good
// enough for the live stats bars (dots are already fuzzed 1–3 km), not for
// anything that needs real borders.

export const CONTINENTS = [
  "Asia",
  "Europe",
  "North America",
  "South America",
  "Africa & Oceania",
] as const;

export type Continent = (typeof CONTINENTS)[number];

export function continentOf(lat: number, lng: number): Continent {
  // Australia, New Zealand, Papua New Guinea and the Pacific islands.
  if (
    (lat < -10 && lng > 110) ||
    (lat < 0 && (lng > 141 || lng < -140)) ||
    lng > 165
  ) {
    return "Africa & Oceania";
  }
  // The Americas; Central America belongs to the north.
  if (lng < -25) {
    return lat > 13 || (lat > 7 && lng < -77.5) ? "North America" : "South America";
  }
  // Europe, up to the Urals; south of 42°N only west of Turkey.
  if (lng < 60 && (lat >= 42 || (lat >= 36 && lng < 26))) return "Europe";
  // Africa, minus the Arabian peninsula and the Levant.
  if (lng < 52 && lat < 37.5 && !(lng > 34 && lat > 12)) return "Africa & Oceania";
  return "Asia";
}
