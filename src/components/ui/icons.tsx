/**
 * Inline icon set. Hand-rolled rather than pulled from a package so the
 * stroke weight matches across the whole workspace and nothing ships an icon
 * font. All icons render at `size` and inherit `currentColor`.
 */
type Props = { size?: number; className?: string; strokeWidth?: number };

function Svg({
  size = 16,
  className = "",
  strokeWidth = 1.7,
  children,
  fill = "none",
}: Props & { children: React.ReactNode; fill?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {children}
    </svg>
  );
}

export const IconPlay = (p: Props) => (
  <Svg {...p} fill="currentColor">
    <path d="M8 5.5v13l11-6.5z" stroke="none" />
  </Svg>
);
export const IconPause = (p: Props) => (
  <Svg {...p} fill="currentColor">
    <rect x="7" y="5" width="3.5" height="14" rx="1" stroke="none" />
    <rect x="13.5" y="5" width="3.5" height="14" rx="1" stroke="none" />
  </Svg>
);
export const IconVolume = (p: Props) => (
  <Svg {...p}>
    <path d="M11 5 6.5 9H3v6h3.5L11 19z" />
    <path d="M15.5 9.5a3.5 3.5 0 0 1 0 5" />
    <path d="M18 7a7 7 0 0 1 0 10" />
  </Svg>
);
export const IconMuted = (p: Props) => (
  <Svg {...p}>
    <path d="M11 5 6.5 9H3v6h3.5L11 19z" />
    <path d="m16 10 5 4M21 10l-5 4" />
  </Svg>
);
export const IconCaptions = (p: Props) => (
  <Svg {...p}>
    <rect x="2.5" y="5" width="19" height="14" rx="3" />
    <path d="M9 10.5a2 2 0 1 0 0 3M16.5 10.5a2 2 0 1 0 0 3" />
  </Svg>
);
export const IconSettings = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </Svg>
);
export const IconFullscreen = (p: Props) => (
  <Svg {...p}>
    <path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" />
  </Svg>
);
export const IconSection = (p: Props) => (
  <Svg {...p}>
    <path d="M5 5v14M19 5v14M8.5 12h7" />
    <path d="m11 9.5-2.5 2.5L11 14.5M13 9.5l2.5 2.5L13 14.5" />
  </Svg>
);
export const IconComment = (p: Props) => (
  <Svg {...p}>
    <path d="M20 12a7.5 7.5 0 0 1-7.5 7.5H5A1 1 0 0 1 4 18.5V12a8 8 0 0 1 16 0Z" />
  </Svg>
);
export const IconDraw = (p: Props) => (
  <Svg {...p}>
    <path d="M15.5 4.5 19.5 8.5 9 19H5v-4z" />
    <path d="m13.5 6.5 4 4" />
  </Svg>
);
export const IconMic = (p: Props) => (
  <Svg {...p}>
    <rect x="9" y="2.5" width="6" height="11" rx="3" />
    <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3.5" />
  </Svg>
);
export const IconPaperclip = (p: Props) => (
  <Svg {...p}>
    <path d="M20 11.5 12 19.5a5 5 0 0 1-7-7l8-8a3.5 3.5 0 0 1 5 5l-8 8a2 2 0 0 1-3-3l7.5-7.5" />
  </Svg>
);
export const IconSend = (p: Props) => (
  <Svg {...p} fill="currentColor">
    <path d="M3.6 20.4 21 12 3.6 3.6 3.5 10l12 2-12 2z" stroke="none" />
  </Svg>
);
export const IconSearch = (p: Props) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </Svg>
);
export const IconFilter = (p: Props) => (
  <Svg {...p}>
    <path d="M3.5 5.5h17l-6.5 8v5.5l-4 2v-7.5z" />
  </Svg>
);
export const IconSort = (p: Props) => (
  <Svg {...p}>
    <path d="M6 20V4m0 0L3 7m3-3 3 3M18 4v16m0 0 3-3m-3 3-3-3" />
  </Svg>
);
export const IconCheck = (p: Props) => (
  <Svg {...p}>
    <path d="m4.5 12.5 5 5 10-11" />
  </Svg>
);
export const IconLock = (p: Props) => (
  <Svg {...p}>
    <rect x="4.5" y="10" width="15" height="10.5" rx="2.5" />
    <path d="M8 10V7.5a4 4 0 0 1 8 0V10" />
  </Svg>
);
export const IconGlobe = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5c2.5 2.6 2.5 14.4 0 17M12 3.5c-2.5 2.6-2.5 14.4 0 17" />
  </Svg>
);
export const IconX = (p: Props) => (
  <Svg {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Svg>
);
export const IconPlus = (p: Props) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const IconChevronDown = (p: Props) => (
  <Svg {...p}>
    <path d="m6 9.5 6 6 6-6" />
  </Svg>
);
export const IconChevronRight = (p: Props) => (
  <Svg {...p}>
    <path d="m9.5 6 6 6-6 6" />
  </Svg>
);
export const IconChevronLeft = (p: Props) => (
  <Svg {...p}>
    <path d="m14.5 6-6 6 6 6" />
  </Svg>
);
export const IconList = (p: Props) => (
  <Svg {...p}>
    <path d="M8.5 6.5h12M8.5 12h12M8.5 17.5h12M3.5 6.5h.01M3.5 12h.01M3.5 17.5h.01" />
  </Svg>
);
export const IconKanban = (p: Props) => (
  <Svg {...p}>
    <rect x="3.5" y="4.5" width="5" height="15" rx="1.5" />
    <rect x="10" y="4.5" width="5" height="10" rx="1.5" />
    <rect x="16.5" y="4.5" width="4" height="13" rx="1.5" />
  </Svg>
);
export const IconFolder = (p: Props) => (
  <Svg {...p}>
    <path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h3.4a2 2 0 0 1 1.5.7l1 1.3h7.1a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
  </Svg>
);
export const IconCalendar = (p: Props) => (
  <Svg {...p}>
    <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </Svg>
);
export const IconChart = (p: Props) => (
  <Svg {...p}>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </Svg>
);
export const IconClock = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Svg>
);
export const IconReply = (p: Props) => (
  <Svg {...p}>
    <path d="M9 7 4 12l5 5" />
    <path d="M4 12h9a6 6 0 0 1 6 6v1" />
  </Svg>
);
export const IconTrash = (p: Props) => (
  <Svg {...p}>
    <path d="M4.5 7h15M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2" />
    <path d="M6.5 7l.8 12a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9l.8-12" />
  </Svg>
);
export const IconSparkles = (p: Props) => (
  <Svg {...p}>
    <path d="M12 3.5 13.6 8l4.4 1.6-4.4 1.6L12 15.5 10.4 11 6 9.6 10.4 8z" />
    <path d="M18.5 15.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" />
  </Svg>
);
export const IconRevisions = (p: Props) => (
  <Svg {...p}>
    <path d="M3.5 12a8.5 8.5 0 1 1 2.6 6.1" />
    <path d="M3.5 19v-5h5" />
  </Svg>
);
export const IconLayers = (p: Props) => (
  <Svg {...p}>
    <path d="m12 3.5 8.5 4.5L12 12.5 3.5 8z" />
    <path d="m3.5 12.5 8.5 4.5 8.5-4.5" />
  </Svg>
);
export const IconGrip = (p: Props) => (
  <Svg {...p} fill="currentColor">
    <circle cx="9" cy="6" r="1.4" stroke="none" />
    <circle cx="15" cy="6" r="1.4" stroke="none" />
    <circle cx="9" cy="12" r="1.4" stroke="none" />
    <circle cx="15" cy="12" r="1.4" stroke="none" />
    <circle cx="9" cy="18" r="1.4" stroke="none" />
    <circle cx="15" cy="18" r="1.4" stroke="none" />
  </Svg>
);
export const IconUndo = (p: Props) => (
  <Svg {...p}>
    <path d="M9 8H5V4" />
    <path d="M5 8a8 8 0 1 1-1 6" />
  </Svg>
);
export const IconCamera = (p: Props) => (
  <Svg {...p}>
    <path d="M3.5 8.5A2 2 0 0 1 5.5 6.5h1.9l1-1.8h7.2l1 1.8h1.9a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
    <circle cx="12" cy="12.5" r="3.2" />
  </Svg>
);
export const IconLink = (p: Props) => (
  <Svg {...p}>
    <path d="M10 13.5a4 4 0 0 0 5.7 0l3-3a4 4 0 1 0-5.7-5.7l-1.3 1.3" />
    <path d="M14 10.5a4 4 0 0 0-5.7 0l-3 3a4 4 0 1 0 5.7 5.7l1.3-1.3" />
  </Svg>
);
export const IconFile = (p: Props) => (
  <Svg {...p}>
    <path d="M13.5 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8.5z" />
    <path d="M13.5 3.5V8.5h5" />
  </Svg>
);
export const IconScreenRecord = (p: Props) => (
  <Svg {...p}>
    <rect x="2.5" y="4" width="19" height="13" rx="2" />
    <path d="M9 20.5h6" />
    <circle cx="12" cy="10.5" r="2.75" fill="currentColor" stroke="none" />
  </Svg>
);
export const IconAt = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.6 7.2" />
  </Svg>
);
export const IconWarningTriangle = (p: Props) => (
  <Svg {...p}>
    <path d="M12 3.5 22 20.5H2z" strokeLinejoin="round" />
    <path d="M12 10v4.5" />
    <circle cx="12" cy="17.5" r="0.9" fill="currentColor" stroke="none" />
  </Svg>
);
export const IconSun = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2.5M12 19v2.5M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2.5 12H5M19 12h2.5M4.2 19.8 6 18M18 6l1.8-1.8" />
  </Svg>
);
export const IconMoon = (p: Props) => (
  <Svg {...p}>
    <path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a6.8 6.8 0 0 0 11 11z" strokeLinejoin="round" />
  </Svg>
);
