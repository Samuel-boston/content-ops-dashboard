"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/library/visuals", label: "Footage" },
  { href: "/library/music", label: "Music" },
  { href: "/library/top-posts", label: "Top posts" },
  { href: "/library/references", label: "References" },
  { href: "/library/sop", label: "SOP / Playbook" },
];

export function LibraryTabs({ uncategorisedMusic = 0 }: { uncategorisedMusic?: number }) {
  const pathname = usePathname();
  return (
    <nav className="mt-2 flex gap-1">
      {TABS.map((t) => {
        const active = pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`rounded-md px-3 py-1.5 text-sm ${
              active
                ? "bg-raised text-ink"
                : "text-ink-2 hover:bg-hover hover:text-ink"
            }`}
          >
            {t.label}
            {t.href === "/library/music" && uncategorisedMusic > 0 ? (
              <span
                title={`${uncategorisedMusic} track${uncategorisedMusic === 1 ? "" : "s"} need a category`}
                className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white"
              >
                !
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
