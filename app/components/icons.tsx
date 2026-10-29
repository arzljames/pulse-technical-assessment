// Small stroke icons shared by the prompts. They inherit currentColor.

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

type IconProps = { size?: number };

export function PersonIcon({ size = 18 }: IconProps) {
  return (
    <svg {...base} width={size} height={size}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  );
}

export function PinIcon({ size = 14 }: IconProps) {
  return (
    <svg {...base} width={size} height={size}>
      <path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z" />
      <circle cx="12" cy="9" r="2.5" />
    </svg>
  );
}

export function LockIcon({ size = 11 }: IconProps) {
  return (
    <svg {...base} width={size} height={size}>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

export function CameraIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base} width={size} height={size}>
      <rect x="2" y="6" width="14" height="12" rx="2" />
      <path d="M16 10l6-3v10l-6-3z" />
    </svg>
  );
}

export function CameraOffIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base} width={size} height={size}>
      <path d="M16 16v1a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2" />
      <path d="M10 5h4a2 2 0 0 1 2 2v3l6-3v10" />
      <path d="M2 2l20 20" />
    </svg>
  );
}

export function MicIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base} width={size} height={size}>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0M12 17v5" />
    </svg>
  );
}

export function MicOffIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base} width={size} height={size}>
      <path d="M15 9.3V5a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 5.1 2.1" />
      <path d="M19 10a7 7 0 0 1-1.2 3.9M5 10a7 7 0 0 0 11.3 5.5M12 17v5" />
      <path d="M2 2l20 20" />
    </svg>
  );
}

export function XIcon({ size = 14 }: IconProps) {
  return (
    <svg {...base} width={size} height={size}>
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

export function MapIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base} width={size} height={size}>
      <path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z" />
      <path d="M9 4v14M15 6v14" />
    </svg>
  );
}

export function VideoOffIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base} width={size} height={size}>
      <path d="M16 16v1a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2" />
      <path d="M10 5h4a2 2 0 0 1 2 2v3l6-3v10" />
      <path d="M2 2l20 20" />
    </svg>
  );
}

export function EyeIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base} width={size} height={size}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function EyeOffIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base} width={size} height={size}>
      <path d="M10.6 5.1A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-2.4 3.4" />
      <path d="M6.6 6.6A17.4 17.4 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="M2 2l20 20" />
    </svg>
  );
}

export function ShieldIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base} width={size} height={size}>
      <path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z" />
      <path d="M9.5 9.5l5 5M14.5 9.5l-5 5" />
    </svg>
  );
}
