/** 16px stroke icons (currentColor). */
const base = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

export const IconExplain = () => (
  <svg {...base}>
    <circle cx="8" cy="8" r="6" />
    <path d="M6.3 6.2a1.8 1.8 0 1 1 2.5 1.7c-.5.2-.8.6-.8 1.1v.3M8 11.3v.2" />
  </svg>
);
export const IconNote = () => (
  <svg {...base}>
    <path d="M4 2.5h6l2.5 2.5v8.5H4z" />
    <path d="M6 7h4.5M6 9.5h4.5M6 12h2.5" />
  </svg>
);
export const IconDiagram = () => (
  <svg {...base}>
    <rect x="2" y="2.5" width="4.5" height="3.5" rx="1" />
    <rect x="9.5" y="10" width="4.5" height="3.5" rx="1" />
    <path d="M4.25 6v3a1.5 1.5 0 0 0 1.5 1.5h3.75" />
  </svg>
);
export const IconAsk = () => (
  <svg {...base}>
    <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" />
  </svg>
);
export const IconCapture = () => (
  <svg {...base}>
    <path d="M2.5 5V2.5H5M11 2.5h2.5V5M13.5 11v2.5H11M5 13.5H2.5V11" />
  </svg>
);
export const IconMark = () => (
  <svg {...base}>
    <path d="M4.5 2.5h7v11l-3.5-2.5-3.5 2.5z" />
  </svg>
);
export const IconMore = () => (
  <svg {...base}>
    <path d="M3.5 8h.01M8 8h.01M12.5 8h.01" strokeWidth={2.2} />
  </svg>
);
/** Branch (fork) mark for 「n 个分支」: drawn, so it never depends on a font having ⑂. */
export const IconBranch = () => (
  <svg {...base} width={12} height={12} className="icon-branch">
    <circle cx="4.5" cy="3.5" r="1.5" />
    <circle cx="4.5" cy="12.5" r="1.5" />
    <circle cx="11.5" cy="5" r="1.5" />
    <path d="M4.5 5v6M11.5 6.5c0 2.5-2 3.5-5 4.2" />
  </svg>
);
