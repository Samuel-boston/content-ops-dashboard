"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/library/visuals", label: "Footage" },
  { href: "/library/music", label: "Music" },
  { href: "/library/references", label: "References" },
  { href: "/library/sop", label: "SOP / Playbook" },
];

export function LibraryTabs() {
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
          </Link>
        );
      })}
    </nav>
  );
}
