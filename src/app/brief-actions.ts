"use server";

import { requireRole } from "@/lib/auth";
import { getVideo } from "@/app/actions";
import { listAssets } from "@/app/asset-actions";
import { listMusic, listReferences, videoMusic } from "@/app/library-actions";
import { briefVoiceUrl } from "@/app/script-actions";
import { listCarouselImages } from "@/app/carousel-actions";
import type { CarouselImage, MusicTrack, ReferenceItem, Video, VideoAsset } from "@/lib/types";

export interface BriefBundle {
  video: Video;
  assets: VideoAsset[];
  references: ReferenceItem[];
  music: MusicTrack[];
  musicLibrary: MusicTrack[];
  briefVoiceUrl: string | null;
  carouselSlides: CarouselImage[];
}

/** Everything the editor-brief menu needs, in one round trip, for the popup that opens when a video reaches Ready to Film or Ready to Edit. */
export async function getBriefBundleAction(videoId: string): Promise<BriefBundle | null> {
  await requireRole("owner", "admin");
  const video = await getVideo(videoId);
  if (!video) return null;
  const [assets, references, music, library, carouselSlides] = await Promise.all([
    listAssets(videoId),
    listReferences(videoId),
    videoMusic(videoId),
    listMusic(),
    listCarouselImages(videoId),
  ]);
  return {
    video,
    assets,
    references,
    music,
    musicLibrary: library.tracks,
    briefVoiceUrl: await briefVoiceUrl(video.brief_voice_path),
    carouselSlides,
  };
}
