"use client";

import { useState } from "react";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useRouter } from "next/navigation";
import { deleteMessageAction, sendMessageAction } from "@/app/chat-actions";
import { useToast } from "@/components/ui/Toast";
import type { Profile, VideoMessage } from "@/lib/types";

export function VideoChat({
  videoId,
  viewer,
  messages,
  roster,
}: {
  videoId: string;
  viewer: Profile;
  messages: VideoMessage[];
  roster: Pick<Profile, "id" | "full_name" | "email">[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [text, setText] = useState("");
  const [pending, startTransition] = useTrackedTransition();
  const [showMentions, setShowMentions] = useState(false);

  function send() {
    if (!text.trim()) return;
    const body = text;
    setText("");
    startTransition(async () => {
      const r = await sendMessageAction(videoId, body);
      if (toast.result(r)) router.refresh();
    });
  }

  return (
    <div className="flex flex-col rounded-xl border border-line bg-app">
      <div className="border-b border-line px-4 py-2.5 text-sm font-semibold text-ink-2">
        Chat
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4" style={{ maxHeight: "40vh" }}>
        {messages.length === 0 ? (
          <p className="text-xs text-ink-3">
            Video-scoped chat. @mention someone to notify them by email.
          </p>
        ) : null}
        {messages.map((m) => (
          <div key={m.id} className="text-sm">
            <div className="flex items-center gap-2 text-xs">
              <span className="font-medium text-ink-2">
                {m.author?.full_name || m.author?.email || "Someone"}
              </span>
              <span className="text-ink-3">
                {new Date(m.created_at).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
              {(viewer.role === "owner" || viewer.role === "admin" || m.author_id === viewer.id) && (
                <button
                  onClick={() => deleteMessageAction(m.id, videoId).then(() => router.refresh())}
                  className="text-ink-3 hover:text-danger"
                >
                  ×
                </button>
              )}
            </div>
            <p className="mt-0.5 whitespace-pre-wrap text-ink">
              {m.body.split(/(@[\w.@-]+)/).map((part, i) =>
                part.startsWith("@") ? (
                  <span key={i} className="text-accent-hi">
                    {part}
                  </span>
                ) : (
                  <span key={i}>{part}</span>
                )
              )}
            </p>
          </div>
        ))}
      </div>
      <div className="relative border-t border-line p-3">
        {showMentions ? (
          <div className="absolute bottom-full left-3 mb-1 w-52 rounded-md border border-line-strong bg-card py-1 text-sm shadow-lg">
            {roster.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  setText((t) => t.replace(/@$/, `@${(p.full_name || p.email).replace(/\s+/g, "")} `));
                  setShowMentions(false);
                }}
                className="block w-full px-3 py-1 text-left text-ink-2 hover:bg-hover"
              >
                {p.full_name || p.email}
              </button>
            ))}
          </div>
        ) : null}
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setShowMentions(e.target.value.endsWith("@"));
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
          }}
          rows={2}
          placeholder="Message… ⌘↵ to send"
          className="w-full resize-none rounded-md bg-raised px-2 py-1.5 text-sm outline-none"
        />
        <div className="mt-1.5 flex justify-end">
          <button
            onClick={send}
            disabled={pending || !text.trim()}
            className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-hi disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
