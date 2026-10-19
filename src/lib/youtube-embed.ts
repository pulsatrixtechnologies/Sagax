/** Privacy-enhanced YouTube embed and IFrame API loader. */

const API_SRC = "https://www.youtube.com/iframe_api";

let apiPromise: Promise<void> | undefined;

export function loadYoutubeIframeApi(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  const w = window as typeof window & { YT?: { Player: unknown }; onYouTubeIframeAPIReady?: () => void };
  if (w.YT?.Player) return Promise.resolve();
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    if (document.querySelector(`script[src="${API_SRC}"]`)) return;
    const script = document.createElement("script");
    script.src = API_SRC;
    script.async = true;
    document.head.appendChild(script);
  });
  return apiPromise;
}

export type YoutubePlayerHandle = {
  seekTo: (seconds: number) => void;
  getCurrentTimeMs: () => number | null;
  play: () => void;
  pause: () => void;
  destroy: () => void;
};

type YtTarget = {
  seekTo: (s: number, allowSeekAhead: boolean) => void;
  getCurrentTime: () => number;
  playVideo: () => void;
  pauseVideo: () => void;
  destroy: () => void;
};

export async function createYoutubePlayer(
  mount: HTMLElement,
  videoId: string,
): Promise<YoutubePlayerHandle | null> {
  await loadYoutubeIframeApi();
  const w = window as typeof window & {
    YT?: {
      Player: new (
        el: HTMLElement,
        opts: {
          width?: string | number;
          height?: string | number;
          videoId: string;
          host?: string;
          playerVars?: Record<string, string | number>;
          events?: { onReady?: (e: { target: YtTarget }) => void };
        },
      ) => YtTarget;
    };
  };
  const Player = w.YT?.Player;
  if (!Player) return null;
  return new Promise((resolve) => {
    // 100% both ways: left to itself the IFrame API writes width="640"
    // height="390" on the iframe. YouTube's own controls (play, scrub bar,
    // fullscreen) stay on: nothing of Sagax is laid over the player.
    const player = new Player(mount, {
      width: "100%",
      height: "100%",
      videoId,
      host: "https://www.youtube-nocookie.com",
      playerVars: {
        controls: 1,
        fs: 1,
        rel: 0,
        playsinline: 1,
        origin: window.location.origin,
      },
      events: {
        onReady: (event) => {
          const target = event.target;
          resolve({
            seekTo: (seconds) => target.seekTo(seconds, true),
            getCurrentTimeMs: () => {
              try {
                const s = target.getCurrentTime();
                return Number.isFinite(s) ? Math.round(s * 1000) : null;
              } catch {
                return null;
              }
            },
            play: () => target.playVideo(),
            pause: () => target.pauseVideo(),
            destroy: () => target.destroy(),
          });
        },
      },
    });
    void player;
  });
}
