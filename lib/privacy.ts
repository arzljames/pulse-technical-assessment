// Where a user's dot goes on the map (S4). Server-only.
//
// The old scheme moved the real location 1–3 km in a fresh random direction
// on every join. Each placement was random, but they were all centred on the
// real point, so averaging enough of one person's dots (re-joins, reloads,
// panics) converged on their home.
//
// Now the real location is snapped to a ~2 km grid cell, and the dot goes at
// that cell's anchor: a point inside the cell picked by HMAC(cell, UTC day),
// so it's the same for everyone in that cell all day and unpredictable
// without the server secret. A small per-join jitter keeps two people in the
// same cell from sitting exactly on top of each other. Averaging now only
// recovers the anchor, which says nothing more than "somewhere in this
// cell", no matter how many samples an observer collects.
import { serverHmac } from "@/lib/session";

const KM_PER_DEG_LAT = 111.32;
const CELL_KM = 2;
const JITTER_KM = 0.25;

export function placeDot(lat: number, lng: number): { lat: number; lng: number } {
  const cellLat = CELL_KM / KM_PER_DEG_LAT;
  const row = Math.floor(lat / cellLat);
  // Cells keep ~2 km of width away from the equator; clamp near the poles.
  const rowMid = (row + 0.5) * cellLat;
  const cellLng = cellLat / Math.max(0.1, Math.cos((rowMid * Math.PI) / 180));
  const col = Math.floor(lng / cellLng);

  const day = new Date().toISOString().slice(0, 10);
  const h = serverHmac(`dot:${row}:${col}:${day}`);
  const fy = h.readUInt32BE(0) / 2 ** 32;
  const fx = h.readUInt32BE(4) / 2 ** 32;

  const anchorLat = (row + fy) * cellLat;
  const anchorLng = (col + fx) * cellLng;

  // Per-join jitter, up to JITTER_KM in a random direction.
  const r = Math.sqrt(Math.random()) * JITTER_KM;
  const theta = Math.random() * 2 * Math.PI;
  const dLat = (r * Math.cos(theta)) / KM_PER_DEG_LAT;
  const dLng =
    (r * Math.sin(theta)) /
    (KM_PER_DEG_LAT * Math.max(0.1, Math.cos((anchorLat * Math.PI) / 180)));

  return {
    lat: clamp(anchorLat + dLat, -90, 90),
    lng: wrapLng(anchorLng + dLng),
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function wrapLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}
