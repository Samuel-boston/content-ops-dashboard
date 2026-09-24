import { requireUser } from "@/lib/auth";
import { listTopPostsAction, suggestOwnTopPostsAction } from "@/app/top-posts-actions";
import { TopPostsBoard } from "@/components/library/TopPostsBoard";

/**
 * What has worked, in one place: the views, the topic, the hook and the link.
 * Everyone reads it (writers borrow hooks from it); owners and admins add to it —
 * by hand, by pasting a list, or by asking their own Claude / ChatGPT to find good
 * posts and add the ones they like through the connector.
 */
export default async function TopPostsPage() {
  const viewer = await requireUser();
  const canEdit = viewer.role === "owner" || viewer.role === "admin";
  const [posts, suggestions] = await Promise.all([
    listTopPostsAction(),
    canEdit ? suggestOwnTopPostsAction().catch(() => []) : Promise.resolve([]),
  ]);
  return <TopPostsBoard posts={posts} suggestions={suggestions} canEdit={canEdit} />;
}
