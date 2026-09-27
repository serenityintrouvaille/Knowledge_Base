import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { filled?: boolean };

const base = (props: P) => ({
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  ...props,
});

export const IconToday = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 7.5 12 13l8-5.5" />
    <rect x="3.5" y="5" width="17" height="14" rx="2" />
  </svg>
);
export const IconLibrary = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 4.5v15M9.5 4.5v15M14 5.2l4.6 14" />
  </svg>
);
export const IconSearch = (p: P) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4" />
  </svg>
);
export const IconSettings = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="8" cy="17" r="2" />
  </svg>
);
export const IconRefresh = (p: P) => (
  <svg {...base(p)}>
    <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4" />
  </svg>
);
export const IconBookmark = ({ filled, ...p }: P) => (
  <svg {...base(p)} fill={filled ? "currentColor" : "none"}>
    <path d="M7 4.5h10v15l-5-3.6-5 3.6z" />
  </svg>
);
export const IconBack = (p: P) => (
  <svg {...base(p)}>
    <path d="M15 5l-7 7 7 7" />
  </svg>
);
export const IconMore = (p: P) => (
  <svg {...base(p)}>
    <circle cx="5.5" cy="12" r="1.2" fill="currentColor" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" />
    <circle cx="18.5" cy="12" r="1.2" fill="currentColor" />
  </svg>
);
export const IconExternal = (p: P) => (
  <svg {...base({ width: 16, height: 16, ...p })}>
    <path d="M14 5h5v5M19 5l-8 8M17 14v4.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4.5" />
  </svg>
);
export const IconType = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 18 8.5 6 13 18M5.7 14h5.6M15 18l3-8 3 8M15.8 16h4.4" />
  </svg>
);
export const IconAlert = (p: P) => (
  <svg {...base({ width: 16, height: 16, ...p })}>
    <path d="M12 4 2.8 19.5h18.4z" />
    <path d="M12 10v4.2M12 17h.01" />
  </svg>
);
export const IconCheck = (p: P) => (
  <svg {...base({ width: 16, height: 16, ...p })}>
    <path d="m5 12.5 4.2 4.2L19 7" />
  </svg>
);
