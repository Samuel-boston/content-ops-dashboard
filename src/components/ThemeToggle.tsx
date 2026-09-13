"use client";

import { useEffect, useState } from "react";
import { IconMoon, IconSun } from "@/components/ui/icons";

type Theme = "system" | "light" | "dark";

function apply(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

const OPTIONS: { key: Theme; label: string; icon?: React.ReactNode }[] = [
  { key: "system", label: "Auto" },
  { key: "light", label: "Light", icon: <IconSun size={12} /> },
  { key: "dark", label: "Dark", icon: <IconMoon size={12} /> },
];

/** Reads the choice the inline bootstrap script (in the root layout) already applied to <html>, so this never fights it on mount. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    // Reads localStorage, which doesn't exist at SSR/first-paint time — this
    // one-time sync-from-an-external-source is exactly what an effect is for,
    // just not a pattern the stricter lint rule can tell apart from a loop.
    const stored = localStorage.getItem("theme");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(stored === "light" || stored === "dark" ? stored : "system");
  }, []);

  function choose(next: Theme) {
    setTheme(next);
    apply(next);
    try {
      if (next === "system") localStorage.removeItem("theme");
      else localStorage.setItem("theme", next);
    } catch {
      // Private browsing or storage disabled — the choice still applies for this page load.
    }
  }

  return (
    <div className="flex items-center justify-between px-3 py-1.5">
      <span className="text-ink-2">Theme</span>
      <div className="flex gap-0.5">
        {OPTIONS.map((o) => (
          <button
            key={o.key}
            type="button"
            onClick={() => choose(o.key)}
            aria-pressed={theme === o.key}
            title={o.label}
            className={`flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] ${
              theme === o.key ? "bg-raised text-ink" : "text-ink-3 hover:bg-hover hover:text-ink"
            }`}
          >
            {o.icon}
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
