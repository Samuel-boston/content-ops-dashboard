import { avatarHue, displayName, initials } from "@/lib/format";

type Person = { id?: string; full_name?: string | null; email?: string | null } | null | undefined;

const SIZES = {
  xs: "h-4 w-4 text-[8px]",
  sm: "h-5 w-5 text-[9px]",
  md: "h-6 w-6 text-[10px]",
  lg: "h-8 w-8 text-xs",
} as const;

export function Avatar({
  person,
  size = "md",
  ring = false,
  className = "",
}: {
  person: Person;
  size?: keyof typeof SIZES;
  ring?: boolean;
  className?: string;
}) {
  const seed = person?.id || person?.email || "anon";
  const hue = avatarHue(seed);
  return (
    <span
      title={displayName(person)}
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white/90 ${
        SIZES[size]
      } ${ring ? "ring-2 ring-panel" : ""} ${className}`}
      style={{
        background: `linear-gradient(140deg, hsl(${hue} 62% 52%), hsl(${(hue + 40) % 360} 58% 38%))`,
      }}
    >
      {initials(person)}
    </span>
  );
}

/** Overlapping avatar row — the "EDITORS" cell on a board card. */
export function AvatarStack({
  people,
  size = "md",
  max = 3,
}: {
  people: Person[];
  size?: keyof typeof SIZES;
  max?: number;
}) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  if (!people.length) return <span className="text-xs text-ink-3">—</span>;
  return (
    <span className="flex items-center">
      {shown.map((p, i) => (
        <Avatar
          key={p?.id ?? i}
          person={p}
          size={size}
          ring
          className={i > 0 ? "-ml-1.5" : ""}
        />
      ))}
      {extra > 0 ? (
        <span className="-ml-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-raised text-[10px] font-semibold text-ink-2 ring-2 ring-panel">
          +{extra}
        </span>
      ) : null}
    </span>
  );
}
