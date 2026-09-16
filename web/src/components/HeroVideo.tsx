import { useEffect, useRef, useState } from "react";
import { trackEvent } from "../lib/analytics";

const CONTROLS_HIDE_DELAY_MS = 2000;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Autoplaying hero demo video on the home page, with a real overlay control layer (play/pause,
 * seek bar, mute, fullscreen, exit) instead of a native <video controls> UI or a permanently-visible
 * bar below the video — the overlay fades in on mouse movement / touch over the frame and auto-hides
 * after CONTROLS_HIDE_DELAY_MS of inactivity, the standard video-player convention. Fullscreen
 * targets the whole container (not just the <video>) so this same overlay keeps working fullscreen;
 * iOS Safari has no element-level Fullscreen API at all, so that one platform falls back to the
 * video's own native fullscreen (losing the custom overlay there, unavoidably).
 *
 * Autoplay-with-sound is attempted first (the ask is "unmuted by default"), but every major browser
 * silently refuses to actually start playback if autoplay would produce audio and the user hasn't
 * already interacted with this site — there is no way to force real audible autoplay. `video.play()`
 * is called imperatively (not via the `autoPlay` attribute) specifically so its returned promise can
 * be caught: on rejection this falls back to muted autoplay so the video still visibly plays instead
 * of not starting at all, and the mute button reflects reality so a visitor can turn sound on with
 * one click.
 */
export default function HeroVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = false;
    const playAttempt = v.play();
    if (playAttempt !== undefined) {
      playAttempt.catch(() => {
        // Unmuted autoplay was blocked (no prior interaction with this site) — fall back to muted
        // so the video still plays rather than sitting frozen on the poster frame.
        v.muted = true;
        setIsMuted(true);
        v.play().catch(() => setIsPlaying(false));
      });
    }
  }, []);

  useEffect(() => {
    scheduleHide();
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function scheduleHide() {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setControlsVisible(false), CONTROLS_HIDE_DELAY_MS);
  }

  function handleActivity() {
    setControlsVisible(true);
    scheduleHide();
  }

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
    setCurrentTime(0);
    setIsPlaying(false);
    trackEvent("hero_video_stop", {});
  }

  function toggleMute() {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setIsMuted(v.muted);
  }

  function seek(e: React.ChangeEvent<HTMLInputElement>) {
    const v = videoRef.current;
    if (!v) return;
    const t = Number(e.target.value);
    v.currentTime = t;
    setCurrentTime(t);
  }

  function exit() {
    videoRef.current?.pause();
    setVisible(false);
    trackEvent("hero_video_exit", {});
  }

  function toggleFullscreen() {
    const el = containerRef.current as (HTMLDivElement & { webkitRequestFullscreen?: () => Promise<void> }) | null;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
      return;
    }
    if (el.requestFullscreen) {
      el.requestFullscreen().catch(() => {});
    } else if (el.webkitRequestFullscreen) {
      // Older Safari — no unprefixed API. iOS Safari doesn't support element-level fullscreen at
      // all (only a video's own native fullscreen), so fall back to that for the video itself.
      el.webkitRequestFullscreen();
    } else {
      const v = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
      v?.webkitEnterFullscreen?.();
    }
    trackEvent("hero_video_fullscreen", {});
  }

  return (
    <section className="max-w-4xl mx-auto px-6 pb-4">
      <div
        ref={containerRef}
        className="relative glass-card overflow-hidden rounded-2xl group bg-black"
        onMouseMove={handleActivity}
        onTouchStart={handleActivity}
      >
        <video
          ref={videoRef}
          className="w-full aspect-video bg-black"
          src="/videos/rupee-radar-hero.mp4"
          poster="/videos/rupee-radar-hero-poster.jpg"
          playsInline
          preload="metadata"
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => setIsPlaying(false)}
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        />

        {/* Overlay control layer — fades in on hover/touch, auto-hides after CONTROLS_HIDE_DELAY_MS. */}
        <div
          className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent pt-10 pb-3 px-4 transition-opacity duration-300 ${
            controlsVisible ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
        >
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={currentTime}
            onChange={seek}
            aria-label="Seek"
            className="w-full h-1.5 mb-3 accent-brand cursor-pointer"
          />
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                onClick={togglePlay}
                aria-label={isPlaying ? "Pause" : "Play"}
                className="w-9 h-9 rounded-full bg-brand text-black flex items-center justify-center hover:bg-brand-dark transition"
              >
                {isPlaying ? "❚❚" : "▶"}
              </button>
              <button
                onClick={stop}
                aria-label="Stop"
                className="w-9 h-9 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20 transition"
              >
                ■
              </button>
              <button
                onClick={toggleMute}
                aria-label={isMuted ? "Unmute" : "Mute"}
                className="w-9 h-9 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20 transition"
              >
                {isMuted ? "🔇" : "🔊"}
              </button>
              <span className="text-xs text-white/80 tabular-nums">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={toggleFullscreen}
                aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                className="w-9 h-9 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20 transition"
              >
                {isFullscreen ? "⤡" : "⤢"}
              </button>
              <button
                onClick={exit}
                aria-label="Close video"
                className="w-9 h-9 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20 transition"
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
