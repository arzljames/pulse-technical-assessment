"use client";

import { useEffect, useRef } from "react";

// Decorative dot-matrix globe for the landing page. Pure canvas, no map
// library — it has to be instant and cheap, since it's the first thing
// anyone sees. Points are spread evenly over a sphere (Fibonacci lattice),
// rotated slowly, and orthographically projected; only the front hemisphere
// is drawn, fading toward the limb. A few "people" pulse on the surface.

const POINT_COUNT = 1600;
const TILT = -0.42; // radians around X: look slightly down onto the globe
const SPIN_SPEED = 0.045; // radians per second
const PULSE_PERIOD = 2.8; // seconds per ring cycle

// Accent colours (kept in sync with --color-accent / --color-ember).
const ACCENT = "143, 162, 255";
const EMBER = "245, 158, 107";

interface Marker {
  lat: number;
  lng: number;
  color: string;
  phase: number; // 0–1 offset so rings don't pulse in unison
}

// Latitudes 5–55° sit in the band that faces the viewer as the globe turns.
const MARKERS: Marker[] = [
  { lat: 38, lng: -20, color: ACCENT, phase: 0 },
  { lat: 18, lng: 15, color: EMBER, phase: 0.35 },
  { lat: 48, lng: 50, color: ACCENT, phase: 0.6 },
  { lat: 10, lng: -60, color: ACCENT, phase: 0.15 },
  { lat: 28, lng: 95, color: ACCENT, phase: 0.8 },
  { lat: 22, lng: 150, color: EMBER, phase: 0.5 },
  { lat: 52, lng: -100, color: ACCENT, phase: 0.25 },
  { lat: 8, lng: -140, color: ACCENT, phase: 0.7 },
  { lat: 42, lng: -170, color: ACCENT, phase: 0.45 },
  { lat: 32, lng: -45, color: ACCENT, phase: 0.9 },
];

type Vec3 = [number, number, number];

function fibonacciSphere(n: number): Vec3[] {
  const points: Vec3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = golden * i;
    points.push([Math.cos(theta) * r, y, Math.sin(theta) * r]);
  }
  return points;
}

function latLngToVec(lat: number, lng: number): Vec3 {
  const phi = (lat * Math.PI) / 180;
  const lambda = (lng * Math.PI) / 180;
  return [
    Math.cos(phi) * Math.sin(lambda),
    Math.sin(phi),
    Math.cos(phi) * Math.cos(lambda),
  ];
}

// Spin around Y, then tilt around X. Returns the rotated vector.
function rotate([x, y, z]: Vec3, spin: number): Vec3 {
  const cs = Math.cos(spin);
  const ss = Math.sin(spin);
  const x1 = x * cs + z * ss;
  const z1 = -x * ss + z * cs;
  const ct = Math.cos(TILT);
  const st = Math.sin(TILT);
  return [x1, y * ct - z1 * st, y * st + z1 * ct];
}

export default function DotGlobe({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const points = fibonacciSphere(POINT_COUNT);
    const markers = MARKERS.map((m) => ({ ...m, v: latLngToVec(m.lat, m.lng) }));
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    let width = 0;
    let height = 0;
    let frame = 0;
    const start = performance.now();

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas!.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas!.width = Math.round(width * dpr);
      canvas!.height = Math.round(height * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function draw(now: number) {
      const t = (now - start) / 1000;
      const spin = reduceMotion ? 0.6 : 0.6 + t * SPIN_SPEED;

      // Globe whose crown rises to mid-viewport, limb visible on both sides.
      // Narrow screens get a relatively bigger globe so it still fills out.
      const radius =
        width < 640
          ? width * 0.85
          : Math.min(width * 0.42, height * 0.75);
      const cx = width / 2;
      const cy = height * 0.5 + radius;

      ctx!.clearRect(0, 0, width, height);

      for (const p of points) {
        const [x, y, z] = rotate(p, spin);
        if (z <= 0) continue; // back hemisphere
        const sx = cx + x * radius;
        const sy = cy - y * radius;
        if (sy < -4 || sy > height + 4 || sx < -4 || sx > width + 4) continue;
        // Gentle fade toward the limb, so the sphere reads as round but its
        // outline stays visible.
        const alpha = 0.2 + z * 0.4;
        ctx!.fillStyle = `rgba(190, 198, 230, ${alpha})`;
        ctx!.fillRect(sx, sy, 1.6, 1.6);
      }

      for (const m of markers) {
        const [x, y, z] = rotate(m.v, spin);
        if (z <= 0.15) continue;
        const sx = cx + x * radius;
        const sy = cy - y * radius;
        if (sy < 0 || sy > height) continue;
        const depth = Math.min(1, (z - 0.15) / 0.5); // fade in near the limb

        // Expanding ring.
        const cycle = reduceMotion ? 0.5 : ((t / PULSE_PERIOD + m.phase) % 1);
        const ringR = 6 + cycle * 16;
        ctx!.beginPath();
        ctx!.arc(sx, sy, ringR, 0, Math.PI * 2);
        ctx!.strokeStyle = `rgba(${m.color}, ${(1 - cycle) * 0.55 * depth})`;
        ctx!.lineWidth = 1.5;
        ctx!.stroke();

        // Static halo + core.
        ctx!.beginPath();
        ctx!.arc(sx, sy, 9, 0, Math.PI * 2);
        ctx!.strokeStyle = `rgba(${m.color}, ${0.35 * depth})`;
        ctx!.lineWidth = 2;
        ctx!.stroke();

        ctx!.beginPath();
        ctx!.arc(sx, sy, 2.6, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(${m.color}, ${depth})`;
        ctx!.shadowColor = `rgba(${m.color}, 0.9)`;
        ctx!.shadowBlur = 10;
        ctx!.fill();
        ctx!.shadowBlur = 0;
      }

      if (!reduceMotion) frame = requestAnimationFrame(draw);
    }

    resize();
    const observer = new ResizeObserver(() => {
      resize();
      if (reduceMotion) draw(performance.now());
    });
    observer.observe(canvas);
    // Reduced motion: one static frame, drawn now. Otherwise start the loop.
    if (reduceMotion) draw(performance.now());
    else frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden className={className} />;
}
