import { requireUser } from "@/lib/auth";
import { listTeam } from "@/app/actions";
import { listMessages } from "@/app/chat-actions";
import { VideoChat } from "@/components/VideoChat";

/**
 * The video's chat, for the planning rooms (idea, script, filming, brief).
 * A video's conversation is one thread from first idea to posted, so it's the
 * same chat that shows up in the review workspace later — this just puts it
 * where the work is happening at every stage instead of only at the end.
 * Server component: fetches its own messages and the mention roster.
 */
export async function StageChat({ videoId }: { videoId: string }) {
  const [viewer, messages, team] = await Promise.all([
    requireUser(),
    listMessages(videoId),
    listTeam(),
  ]);
  const roster = team
    .filter((p) => p.active)
    .map((p) => ({ id: p.id, full_name: p.full_name, email: p.email }));
  return <VideoChat videoId={videoId} viewer={viewer} messages={messages} roster={roster} />;
}
