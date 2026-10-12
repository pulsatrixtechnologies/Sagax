/** Isolated gallery for Playwright screenshots (not shipped in the app). */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { VideoPlayerWidget } from "../components/video/VideoPlayerWidget";
import { YouTubeMiniPlayer } from "../components/video/YouTubeMiniPlayer";
import { applySkin, readSkin } from "../lib/skins";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin");
const skin = (skinParam === "daylight" || skinParam === "pulsatrix" ? skinParam : readSkin());
applySkin(skin);

const poster = "https://images.unsplash.com/photo-1511512578047-dfb367046420?w=800&q=80";
function Gallery() {
  return (
    <div className="min-h-screen bg-app p-8 text-ink">
      <div className="mx-auto flex max-w-3xl flex-col gap-10">
        <section>
          <h1 className="mb-4 text-lg font-semibold">Live stream</h1>
          <VideoPlayerWidget
            showcase
            video={{
              kind: "live",
              playbackUrl: "/gallery-sample.mp4",
              title: "Championship finals — map 3",
              streamer: "NorthStar",
              source: "Glitcho",
              posterUrl: poster,
              viewerCount: 12840,
            }}
          />
        </section>
        <section>
          <h1 className="mb-4 text-lg font-semibold">YouTube</h1>
          <YouTubeMiniPlayer
            videoId="dQw4w9WgXcQ"
            posterOnly
            initialTitle="Never Gonna Give You Up"
            initialChannel="Rick Astley"
            startDrawerOpen
            highlightStartMs={18000}
            initialCues={[
              { startMs: 0, text: "We're no strangers to love" },
              { startMs: 18000, text: "You know the rules and so do I" },
              { startMs: 27000, text: "A full commitment's what I'm thinking of" },
              { startMs: 35000, text: "You wouldn't get this from any other guy" },
            ]}
          />
        </section>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
