import { useRef, useState } from "react";
import { trackEvent } from "../lib/analytics";

/**
 * Autoplaying (muted, required by every browser for autoplay to actually run) hero demo video on
 * the home page. Custom control bar instead of the native <video controls> UI, since the ask was
 * specifically Pause / Stop / Exit (Stop resets to the start, unlike a plain pause) plus a sound
 * toggle — the video carries real dialogue, so autoplay-muted alone would make it pointless to
 * actually watch. Exit removes the whole section from the page for this visit (not just a pause) —
 * a real escape hatch for anyone who doesn't want an autoplaying video on the page at all.
 */
export default function HeroVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(true);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(true);

  if (!visible) return null;

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play();
      trackEvent("hero_video_play", {});
    } else {
      v.pause();
      trackEvent("hero_video_pause", {});
    }
  }

  function stop() {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.currentTime = 0;
    setIsPlaying(false);
    trackEvent("hero_video_stop", {});
  }

  function toggleMute() {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setIsMuted(v.muted);
  }

  function exit() {
    videoRef.current?.pause();
    setVisible(false);
    trackEvent("hero_video_exit", {});
  }

  return (
    <section className="max-w-4xl mx-auto px-6 pb-4">
      <div className="relative glass-card overflow-hidden rounded-2xl">
        <button
          onClick={exit}
          aria-label="Close video"
          className="absolute top-3 right-3 z-10 w-9 h-9 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70 transition"
        >
          ✕
        </button>
        <video
          ref={videoRef}
          className="w-full aspect-video bg-black"
          src="/videos/rupee-radar-hero.mp4"
          poster="/videos/rupee-radar-hero-poster.jpg"
          autoPlay
          muted
          playsInline
          preload="metadata"
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => setIsPlaying(false)}
        />
        <div className="flex items-center justify-center gap-3 py-3 bg-app-surface/80 border-t border-app-border">
          <button
            onClick={togglePlay}
            className="px-4 py-1.5 rounded-full text-sm font-medium bg-brand text-black hover:bg-brand-dark transition"
          >
            {isPlaying ? "Pause" : "Play"}
          </button>
          <button
            onClick={stop}
            className="px-4 py-1.5 rounded-full text-sm font-medium border border-app-border text-app-text hover:border-app-text/40 transition"
          >
            Stop
          </button>
          <button
            onClick={toggleMute}
            className="px-4 py-1.5 rounded-full text-sm font-medium border border-app-border text-app-text hover:border-app-text/40 transition"
          >
            {isMuted ? "Unmute" : "Mute"}
          </button>
        </div>
      </div>
    </section>
  );
}
