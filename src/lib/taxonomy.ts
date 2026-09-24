// Preset taxonomy — pulled verbatim from the client's existing Notion.
// Do not relabel or reorder. Every list also supports "+ add your own"
// (custom values persist in the taxonomy_options table and then appear here).

export type TaxonomyKind = "content_pillar" | "format" | "platform";

export const CONTENT_PILLARS = [
  "Promotion",
  "Career Transition",
  "Objection Handling",
  "Value",
  "Personality",
  "Belief Breaking",
  "Belief Creation",
  "Thread",
  "Top of funnel",
  "Viral",
] as const;

export const FORMATS = [
  "Short video",
  "Long video",
  "Image",
  "Green screen",
  "Talking head",
  "Silent film",
  "Carousels",
  "Whiteboard",
] as const;

// Instagram is the only one wired to analytics/publishing for now; the others
// are selectable today, ready to connect later.
export const PLATFORMS = ["IG Story", "Instagram", "TikTok"] as const;

export const TAXONOMY_PRESETS: Record<TaxonomyKind, readonly string[]> = {
  content_pillar: CONTENT_PILLARS,
  format: FORMATS,
  platform: PLATFORMS,
};

export const TAXONOMY_LABELS: Record<TaxonomyKind, string> = {
  content_pillar: "Content Pillar",
  format: "Format",
  platform: "Platform",
};

// "Carousels" is a sequence of images, not a video — it's the one format that
// swaps the review player and the editor's delivery dropzone for an image
// carousel instead of Cloudflare Stream. It replaces the old "Carousel with
// text" and "Split screen carousel" options; videos saved under the old
// "Carousel with text" name are still recognised.
export const CAROUSEL_FORMAT = "Carousels";
const LEGACY_CAROUSEL_FORMATS = ["Carousel with text"];
export function isCarouselFormat(formats: readonly string[] | null | undefined): boolean {
  return (formats ?? []).some((f) => f === CAROUSEL_FORMAT || LEGACY_CAROUSEL_FORMATS.includes(f));
}

/** Union of presets + persisted customs + anything already on the record. */
export function taxonomyOptions(
  kind: TaxonomyKind,
  customs: string[],
  current: string[] = []
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of [...TAXONOMY_PRESETS[kind], ...customs, ...current]) {
    const t = v.trim();
    if (t && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      out.push(t);
    }
  }
  return out;
}
