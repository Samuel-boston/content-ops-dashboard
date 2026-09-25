/**
 * Matched beats to a timeline an editing app can open: FCP7 XML (Premiere and DaVinci Resolve),
 * CMX3600 EDL as the fallback, and CSV for anyone who just wants the list. Ported from the
 * B-Roll Librarian, with its rules:
 *
 * - The sequence frame rate is chosen by the person exporting; every clip is placed in it.
 * - Each clip sits at its beat's start, trimmed to the beat's length, starting from the shot's start.
 * - If the shot is shorter than the beat, the remainder is left as a gap and reported, never
 *   stretched or frozen. A still photograph holds any length, so it never leaves one.
 * - An editing app can't link media from a Google Drive address. It needs a local path, built from
 *   the folder where Google Drive for desktop shows the B-roll library. Without it the clips import
 *   offline and need relinking.
 *
 * The dashboard's copy of the library doesn't know each clip's own frame rate, so a clip is
 * assumed to match the sequence. The report says so.
 */

import type { Beat } from "@/lib/broll-transcript";

export interface ExportShot {
  id: string;
  sourceId: string;
  filename: string | null;
  drivePath: string | null;
  driveLink: string | null;
  startS: number;
  durationS: number | null;
  media: "video" | "image";
  shotType: string | null;
  setting: string | null;
}

export interface ExportSuggestion {
  shot: ExportShot;
  reason: string;
  confidence: number;
  reused: boolean;
}

export interface ExportBeat {
  beat: Beat;
  /** The clip to place first, then the other options (CSV only). Empty when no B-roll goes on this line. */
  suggestions: ExportSuggestion[];
  /** Set when the line still needs footage shot for it. */
  missing: string | null;
  /** Why no B-roll was chosen, when that was deliberate. */
  note?: string | null;
}

export interface ExportConfig {
  name: string;
  fps: number;
  width: number;
  height: number;
  /** Where Google Drive for desktop shows the B-roll library on this computer. */
  mountPath: string;
}

export interface TimelineItem {
  beat: Beat;
  suggestion: ExportSuggestion;
  name: string;
  startFrame: number;
  endFrame: number;
  inFrame: number;
  outFrame: number;
  gapFrames: number;
  mediaPath: string | null;
  offline: boolean;
}

export interface Timeline {
  config: ExportConfig;
  items: TimelineItem[];
  warnings: string[];
  gaps: ExportBeat[];
}

const NTSC: [number, number][] = [
  [23.976, 24],
  [23.98, 24],
  [29.97, 30],
  [59.94, 60],
];

export function ntscTimebase(fps: number): { timebase: number; ntsc: boolean } {
  for (const [rate, tb] of NTSC) if (Math.abs(fps - rate) < 0.01) return { timebase: tb, ntsc: true };
  return { timebase: Math.round(fps), ntsc: false };
}

const toFrames = (seconds: number, fps: number) => Math.round(seconds * fps);

/** Non-drop-frame timecode. Drop-frame is deliberately not emitted. */
export function timecode(frames: number, fps: number): string {
  const tb = Math.max(1, Math.round(fps));
  const f = frames % tb;
  const total = Math.floor(frames / tb);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}:${pad(f)}`;
}

const baseName = (s: ExportShot) => (s.filename ?? s.drivePath ?? s.id).split("/").pop() ?? s.id;

export function mediaPath(shot: ExportShot, mountPath: string): { path: string | null; offline: boolean } {
  const mount = mountPath.trim().replace(/\/+$/, "");
  if (mount && shot.drivePath) return { path: `${mount}/${shot.drivePath.replace(/^\/+/, "")}`, offline: false };
  return { path: shot.drivePath, offline: true };
}

export function buildTimeline(matches: ExportBeat[], config: ExportConfig): Timeline {
  const { fps } = config;
  const tl: Timeline = { config, items: [], warnings: [], gaps: [] };
  const offline = new Set<string>();

  if (!config.mountPath.trim()) {
    tl.warnings.push(
      "No Google Drive folder path was given, so clips will import offline and need relinking. Enter where Google Drive for desktop shows the B-roll library."
    );
  }
  tl.warnings.push(`Each clip's own frame rate isn't known here, so clips are placed as if they match the ${fps} fps sequence.`);

  for (const m of matches) {
    const sug = m.suggestions[0];
    if (!sug) {
      // Only a line that still needs footage is a gap; a line left without B-roll on purpose is just skipped.
      if (m.missing) tl.gaps.push(m);
      continue;
    }
    const { beat } = m;
    const start = toFrames(beat.startS, fps);
    const wanted = Math.max(1, toFrames(beat.endS - beat.startS, fps));
    const still = sug.shot.media === "image";
    const available = still || !sug.shot.durationS ? wanted : Math.max(1, toFrames(sug.shot.durationS, fps));
    const used = Math.min(wanted, available);
    const gap = wanted - used;
    const name = baseName(sug.shot);
    if (gap > 0) {
      tl.warnings.push(
        `Beat ${beat.index + 1} (${(beat.endS - beat.startS).toFixed(1)}s) is longer than ${name} (${(sug.shot.durationS ?? 0).toFixed(1)}s); ${(gap / fps).toFixed(1)}s is left as a gap.`
      );
    }
    const inFrame = toFrames(sug.shot.startS, fps);
    const mp = mediaPath(sug.shot, config.mountPath);
    if (mp.offline && config.mountPath.trim()) offline.add(name);
    tl.items.push({
      beat,
      suggestion: sug,
      name,
      startFrame: start,
      endFrame: start + used,
      inFrame,
      outFrame: inFrame + used,
      gapFrames: gap,
      mediaPath: mp.path,
      offline: mp.offline,
    });
  }
  if (offline.size) tl.warnings.push(`${[...offline].slice(0, 5).join(", ")}${offline.size > 5 ? " and more" : ""} have no folder path, so they will import offline.`);
  return tl;
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fileUrl = (p: string | null) => (p ? `file://localhost${p.split("/").map(encodeURIComponent).join("/")}` : "");

function rate(fps: number, indent: string): string {
  const { timebase, ntsc } = ntscTimebase(fps);
  return `${indent}<rate>\n${indent}  <timebase>${timebase}</timebase>\n${indent}  <ntsc>${ntsc ? "TRUE" : "FALSE"}</ntsc>\n${indent}</rate>\n`;
}

/** FCP7 XML (xmeml v5). Gaps are simply the absence of a clip: positions are absolute. */
export function fcp7Xml(tl: Timeline): string {
  const { fps, width, height, name } = tl.config;
  const duration = Math.max(0, ...tl.items.map((i) => i.endFrame));
  let out = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n<xmeml version="5">\n  <sequence id="broll-sequence-1">\n`;
  out += `    <name>${xml(name)}</name>\n    <duration>${duration}</duration>\n${rate(fps, "    ")}`;
  out += `    <timecode>\n${rate(fps, "      ")}      <string>${timecode(0, fps)}</string>\n      <frame>0</frame>\n      <displayformat>NDF</displayformat>\n    </timecode>\n`;
  out += `    <media>\n      <video>\n        <format>\n          <samplecharacteristics>\n${rate(fps, "            ")}            <width>${width}</width>\n            <height>${height}</height>\n          </samplecharacteristics>\n        </format>\n        <track>\n`;
  const files = new Map<string, string>();
  tl.items.forEach((it, i) => {
    const dur = it.endFrame - it.startFrame;
    out += `          <clipitem id="clipitem-${i + 1}">\n            <name>${xml(it.name)}</name>\n            <enabled>TRUE</enabled>\n            <duration>${dur}</duration>\n${rate(fps, "            ")}`;
    out += `            <start>${it.startFrame}</start>\n            <end>${it.endFrame}</end>\n            <in>${it.inFrame}</in>\n            <out>${it.outFrame}</out>\n`;
    const key = it.suggestion.shot.sourceId;
    const seen = files.get(key);
    if (seen) out += `            <file id="${seen}"/>\n`;
    else {
      const id = `file-${files.size + 1}`;
      files.set(key, id);
      out += `            <file id="${id}">\n              <name>${xml(it.name)}</name>\n              <pathurl>${xml(fileUrl(it.mediaPath))}</pathurl>\n${rate(fps, "              ")}`;
      out += `              <media>\n                <video>\n                  <samplecharacteristics>\n${rate(fps, "                    ")}                    <width>${width}</width>\n                    <height>${height}</height>\n                  </samplecharacteristics>\n                </video>\n              </media>\n            </file>\n`;
    }
    out += `            <comments>\n              <mastercomment1>${xml(it.beat.text.slice(0, 200))}</mastercomment1>\n              <mastercomment2>${xml(it.suggestion.reason.slice(0, 200))}</mastercomment2>\n            </comments>\n          </clipitem>\n`;
  });
  out += `        </track>\n      </video>\n    </media>\n  </sequence>\n</xmeml>\n`;
  return out;
}

const reel = (name: string) => {
  const stem = name.replace(/\.[^.]*$/, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return (stem || "AX").slice(0, 8).padEnd(3, "X");
};

/** CMX3600 EDL, the universal fallback. One timebase, so every timecode is in the sequence rate. */
export function edl(tl: Timeline): string {
  const { fps, name } = tl.config;
  const lines = [`TITLE: ${name}`, "FCM: NON-DROP FRAME", ""];
  tl.items.forEach((it, i) => {
    const dur = it.endFrame - it.startFrame;
    lines.push(
      `${String(i + 1).padStart(3, "0")}  ${reel(it.name).padEnd(8)} V     C        ` +
        `${timecode(it.inFrame, fps)} ${timecode(it.inFrame + dur, fps)} ${timecode(it.startFrame, fps)} ${timecode(it.endFrame, fps)}`
    );
    lines.push(`* FROM CLIP NAME: ${it.name}`);
    if (it.mediaPath) lines.push(`* SOURCE FILE: ${it.mediaPath}`);
    lines.push(`* BEAT: ${it.beat.text.slice(0, 70)}`);
    if (it.suggestion.reason) lines.push(`* REASON: ${it.suggestion.reason.slice(0, 70)}`);
    if (it.gapFrames) lines.push(`* GAP AFTER: ${it.gapFrames} frames (${(it.gapFrames / fps).toFixed(1)}s) - clip is shorter than the beat`);
    lines.push("");
  });
  return lines.join("\n").trimEnd() + "\n";
}

const COLUMNS = [
  "beat", "beat_start", "beat_end", "beat_duration_s", "narration", "rank", "filename", "shot_start_s", "shot_duration_s",
  "shot_type", "setting", "reason", "confidence", "reused", "drive_link", "local_path", "sequence_timecode", "gap_s", "status",
] as const;

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function csv(matches: ExportBeat[], tl: Timeline): string {
  const placed = new Map(tl.items.map((i) => [i.beat.index, i]));
  const rows: string[] = [COLUMNS.join(",")];
  const row = (o: Partial<Record<(typeof COLUMNS)[number], string | number>>) => rows.push(COLUMNS.map((c) => csvCell(o[c] ?? "")).join(","));
  for (const m of matches) {
    const b = m.beat;
    const base = { beat: b.index + 1, beat_start: b.startS.toFixed(3), beat_end: b.endS.toFixed(3), beat_duration_s: (b.endS - b.startS).toFixed(3), narration: b.text };
    if (!m.suggestions.length) {
      row({ ...base, status: m.missing ? "no good match" : "no b-roll", reason: m.missing ?? m.note ?? "" });
      continue;
    }
    const item = placed.get(b.index);
    m.suggestions.slice(0, 3).forEach((s, i) => {
      const first = i === 0 && item;
      row({
        ...base,
        rank: i + 1,
        filename: baseName(s.shot),
        shot_start_s: s.shot.startS.toFixed(3),
        shot_duration_s: (s.shot.durationS ?? 0).toFixed(3),
        shot_type: s.shot.shotType ?? "",
        setting: s.shot.setting ?? "",
        reason: s.reason,
        confidence: s.confidence.toFixed(2),
        reused: s.reused ? "yes" : "",
        drive_link: s.shot.driveLink ?? "",
        local_path: first ? item.mediaPath ?? "" : "",
        sequence_timecode: first ? timecode(item.startFrame, tl.config.fps) : "",
        gap_s: first && item.gapFrames ? (item.gapFrames / tl.config.fps).toFixed(2) : "",
        status: i === 0 ? "placed" : "alternative",
      });
    });
  }
  return rows.join("\n") + "\n";
}
