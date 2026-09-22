import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Content Ops",
  description: "Video content operations dashboard",
};

// Every route reads auth cookies, so all rendering is dynamic already.

// Runs before paint so a stored light/dark choice never flashes the other
// theme first. Reads the same "theme" localStorage key as ThemeToggle.
const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t);}}catch(e){}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      // The inline script below sets data-theme on this element before React
      // hydrates, on purpose (that's what stops the flash of the wrong
      // theme). React compares that against its own theme-less server
      // render and logs a hydration-mismatch warning for a mismatch we
      // caused deliberately — this tells it to trust the DOM here instead.
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body className="min-h-full bg-app text-ink font-sans">{children}</body>
    </html>
  );
}
