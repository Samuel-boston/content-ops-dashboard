/**
 * Loading skeletons.
 *
 * Every route in this app is server-rendered on demand — nothing is cached,
 * because everything is scoped to who's asking. That means a navigation is a
 * round trip, and without a loading boundary Next holds the *old* page on
 * screen for its whole duration: you click, and for a second or more the app
 * looks like it ignored you.
 *
 * These stand in during that round trip. They're deliberately shaped like the
 * page that's coming, so the layout doesn't jump when the real content lands.
 */

function Bar({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return <div style={style} className={`animate-pulse rounded bg-line ${className}`} />;
}

function Card({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-line/50 ${className}`} />;
}

/** Header plus a list of rows — the shape most pages here take. */
export function ListSkeleton() {
  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <Bar className="h-6 w-44" />
          <Bar className="h-3.5 w-64 bg-line/60" />
        </div>
        <Bar className="h-9 w-28 bg-line/60" />
      </div>
      <div className="overflow-hidden rounded-xl border border-line">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 border-b border-line px-4 py-3.5 last:border-0">
            <Bar className="h-9 w-14 shrink-0 bg-line/60" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Bar className="h-3.5" style={{ width: `${58 - i * 5}%` }} />
              <Bar className="h-2.5 w-24 bg-line/50" />
            </div>
            <Bar className="h-6 w-20 shrink-0 bg-line/50" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Columns of cards. */
export function BoardSkeleton() {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Bar className="h-6 w-36" />
        <Bar className="h-3.5 w-56 bg-line/60" />
      </div>
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: 5 }).map((_, col) => (
          <div key={col} className="w-64 shrink-0 space-y-2">
            <Bar className="h-3 w-28 bg-line/60" />
            {Array.from({ length: 4 - (col % 3) }).map((__, i) => (
              <Card key={i} className="h-24" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Player on the left, tabs on the right. */
export function WorkspaceSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Bar className="h-5 w-64" />
        <Bar className="ml-auto h-7 w-24 bg-line/60" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="aspect-video w-full" />
        <div className="space-y-2">
          <Bar className="h-8 w-full bg-line/60" />
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i} className="h-16" />
          ))}
        </div>
      </div>
    </div>
  );
}
