// Great-circle distance in km (haversine).
export function distanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// "~2 km", "~45 km", "~1,240 km". Deliberately coarse: dots only reveal a
// ~2 km grid cell, so anything more precise would be false precision.
export function formatDistance(km: number): string {
  if (km < 1) return "<1 km";
  const rounded =
    km < 10 ? Math.round(km) : km < 100 ? Math.round(km / 5) * 5 : Math.round(km / 10) * 10;
  return `~${rounded.toLocaleString("en-US")} km`;
}

export function isValidLatLng(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}
