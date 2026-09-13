"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useToast } from "@/components/ui/Toast";
import {
  assistantQueryAction,
  messageTeamAction,
  type AssistantAction,
  type AssistantVideoRow,
} from "@/app/assistant-actions";
import { setPlanningStageAction, setEtaAction } from "@/app/pipeline-actions";
import { setStatusAction, assignEditorAction, createVideoAction } from "@/app/actions";
import { sendMessageAction } from "@/app/chat-actions";
import { schedulePostAction } from "@/app/publishing-actions";
import { PLANNING_STAGES, STATUS_COLOR, STATUS_LABELS } from "@/lib/types";
import { IconChevronRight, IconSparkles } from "@/components/ui/icons";

type Msg =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; rows?: AssistantVideoRow[]; action?: AssistantAction; resolved?: boolean };

const EXAMPLES = [
  "Where's the pricing video at?",
  "Top performers in the last 6 months",
  "Move the pricing video to ready to edit",
  "Tag Nathan on the testimonial video and ask him to check it",
  "Tell the editor team we're pausing new briefs this week",
  "Schedule the pricing video for today",
  "Add an idea about a behind-the-scenes reel",
];

function VideoCard({ row }: { row: AssistantVideoRow }) {
  return (
    <Link
      href={`/videos/${row.id}`}
      className="flex items-center gap-2 rounded-lg border border-line bg-card px-3 py-2.5 text-sm transition hover:border-accent"
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: STATUS_COLOR[row.status] }} />
      <span className="min-w-0 flex-1 truncate">{row.title}</span>
      {row.views !== null ? (
        <span className="shrink-0 tabular-nums text-ink-3">{row.views.toLocaleString()}v</span>
      ) : null}
      <span className="shrink-0 text-xs text-ink-3">{STATUS_LABELS[row.status]}</span>
      <IconChevronRight size={12} className="shrink-0 text-ink-3" />
    </Link>
  );
}

/**
 * Andreas's actual brain, detached from any particular chrome around it —
 * reads (find a video, list by filter, top performers, draft a caption, a
 * quick report) run straight away; anything that changes something (move a
 * stage, tag a teammate, reassign, set an ETA, schedule a post, log an idea)
 * comes back as a proposal and always stops for an explicit click here
 * before `confirmAction` runs the exact same server action the equivalent
 * button elsewhere in the app already calls.
 */
export function AndreasChat({ autoAsk }: { autoAsk?: { text: string; nonce: number } | null }) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [thinking, setThinking] = useState(false);
  const [, startTransition] = useTrackedTransition();
  const toast = useToast();
  const listRef = useRef<HTMLDivElement>(null);
  const lastMsgRef = useRef<HTMLDivElement>(null);
  const lastAutoAskNonce = useRef<number | null>(null);

  // Scroll to the START of the newest message, not the bottom of the whole
  // thread — a long results list otherwise pushes its own intro (and
  // sometimes the whole reply) above the fold, reading as a cut-off response.
  useEffect(() => {
    lastMsgRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [messages.length]);

  useEffect(() => {
    if (thinking) listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [thinking]);

  function ask(question: string) {
    const q = question.trim();
    if (!q || thinking) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: q }]);
    setThinking(true);
    startTransition(async () => {
      const res = await assistantQueryAction(q);
      setThinking(false);
      setMessages((m) => [...m, { role: "assistant", text: res.text, rows: res.rows, action: res.action }]);
    });
  }

  // A question can arrive from outside this component — the Overview page's
  // own "ask Andreas" box, opening this same panel with it already in hand.
  useEffect(() => {
    if (!autoAsk?.text || lastAutoAskNonce.current === autoAsk.nonce) return;
    lastAutoAskNonce.current = autoAsk.nonce;
    queueMicrotask(() => ask(autoAsk.text));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAsk?.nonce]);

  function confirmAction(index: number, action: AssistantAction) {
    startTransition(async () => {
      let res: { error?: string } | undefined;
      let successMessage = "Done.";

      switch (action.type) {
        case "move_stage": {
          res = PLANNING_STAGES.includes(action.toStatus)
            ? await setPlanningStageAction(action.videoId, action.toStatus)
            : await setStatusAction(action.videoId, action.toStatus);
          successMessage = `Moved "${action.videoTitle}" to ${STATUS_LABELS[action.toStatus]}.`;
          break;
        }
        case "tag_teammate": {
          res = await sendMessageAction(action.videoId, action.body);
          successMessage = `Tagged ${action.personName} on "${action.videoTitle}".`;
          break;
        }
        case "message_person": {
          res =
            action.personIds.length === 1 && action.videoId
              ? await sendMessageAction(action.videoId, action.body)
              : await messageTeamAction(
                  action.personIds,
                  action.body,
                  action.videoId && action.videoTitle
                    ? { id: action.videoId, title: action.videoTitle }
                    : null
                );
          successMessage = action.videoTitle
            ? `Messaged ${action.personLabel} on "${action.videoTitle}".`
            : `Messaged ${action.personLabel}.`;
          break;
        }
        case "reassign_editor": {
          res = await assignEditorAction(action.videoId, action.editorId);
          successMessage = `"${action.videoTitle}" is now with ${action.editorName}.`;
          break;
        }
        case "set_eta": {
          res = await setEtaAction(action.videoId, action.etaISO);
          successMessage = `ETA set on "${action.videoTitle}".`;
          break;
        }
        case "create_idea": {
          const fd = new FormData();
          fd.set("title", action.title);
          fd.set("status", "ideation");
          if (action.notes) fd.set("brief", action.notes);
          const r = await createVideoAction(fd);
          res = r?.error ? { error: r.error } : undefined;
          successMessage = `Added "${action.title}" to Ideation.`;
          break;
        }
        case "schedule_post": {
          res = await schedulePostAction({
            videoId: action.videoId,
            cutId: action.cutId,
            caption: action.caption,
            channels: action.channels,
            scheduledFor: action.scheduledISO,
          });
          successMessage = `"${action.videoTitle}" is scheduled.`;
          break;
        }
      }

      if (res?.error) {
        toast.error(res.error);
        return;
      }
      toast.success(successMessage);
      setMessages((m) =>
        m.map((msg, i) => (i === index && msg.role === "assistant" ? { ...msg, resolved: true } : msg))
      );
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={listRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-1 py-2">
        {messages.length === 0 ? (
          <div className="space-y-2">
            <p className="text-xs text-ink-3">Try asking:</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => ask(ex)}
                  className="rounded-lg border border-dashed border-line-strong px-3 py-2.5 text-left text-sm text-ink-2 hover:border-accent hover:text-ink"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {messages.map((m, i) =>
          m.role === "user" ? (
            <p
              key={i}
              ref={i === messages.length - 1 ? lastMsgRef : undefined}
              className="ml-auto max-w-[85%] rounded-xl rounded-br-sm bg-accent px-3.5 py-2.5 text-sm text-white"
            >
              {m.text}
            </p>
          ) : (
            <div
              key={i}
              ref={i === messages.length - 1 ? lastMsgRef : undefined}
              className="max-w-[95%] space-y-2 sm:max-w-[80%]"
            >
              <p className="rounded-xl rounded-bl-sm bg-panel px-3.5 py-2.5 text-sm text-ink-2">{m.text}</p>
              {m.rows?.length ? (
                <div className="space-y-1.5">
                  {m.rows.map((r) => (
                    <VideoCard key={r.id} row={r} />
                  ))}
                </div>
              ) : null}
              {m.action && !m.resolved ? (
                <button
                  type="button"
                  onClick={() => confirmAction(i, m.action!)}
                  className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white hover:bg-accent-hi"
                >
                  {m.action.label}
                </button>
              ) : m.action && m.resolved ? (
                <p className="text-xs text-ok">Done.</p>
              ) : null}
            </div>
          )
        )}

        {thinking ? (
          <div className="flex items-center gap-1.5 rounded-xl rounded-bl-sm bg-panel px-3.5 py-2.5 text-sm text-ink-3">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-3 [animation-delay:0ms]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-3 [animation-delay:150ms]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-3 [animation-delay:300ms]" />
          </div>
        ) : null}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
        className="flex shrink-0 items-center gap-2 border-t border-line pt-3"
      >
        <IconSparkles size={16} className="shrink-0 text-accent-hi" />
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask Andreas about a video, a list, or top performers…"
          className="min-w-0 flex-1 rounded-lg border border-line bg-raised px-3 py-2.5 text-sm placeholder:text-ink-3 focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          disabled={thinking || !input.trim()}
          className="shrink-0 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hi disabled:opacity-50"
        >
          Ask
        </button>
      </form>
    </div>
  );
}
