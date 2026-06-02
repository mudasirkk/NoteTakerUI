import { useEffect, useRef, useState } from "react";
import { useStore } from "../../state/store";
import { LocalVideoController } from "../../player/PlayerController";

// Standard picture-in-picture glyph: a screen with a smaller inset screen.
const PipIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden>
    <rect x="2.5" y="4.5" width="19" height="15" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
    <rect x="12" y="11" width="8" height="6" rx="1" fill="currentColor" />
  </svg>
);

export function LocalVideoPlayer({ src }: { src: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const setController = useStore((s) => s.setController);
  const clearController = useStore((s) => s.clearController);
  const [pipActive, setPipActive] = useState(false);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    setController(new LocalVideoController(el));
    return () => clearController();
  }, [setController, clearController]);

  // Mirror PiP enter/leave so the button stays in sync even when the user dismisses
  // the floating window from its own chrome (or another video steals PiP).
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const onEnter = () => setPipActive(true);
    const onLeave = () => setPipActive(false);
    el.addEventListener("enterpictureinpicture", onEnter);
    el.addEventListener("leavepictureinpicture", onLeave);
    return () => {
      el.removeEventListener("enterpictureinpicture", onEnter);
      el.removeEventListener("leavepictureinpicture", onLeave);
    };
  }, []);

  const pipSupported =
    typeof document !== "undefined" && document.pictureInPictureEnabled === true;

  const togglePip = async () => {
    const el = videoRef.current;
    if (!el) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await el.requestPictureInPicture();
    } catch {
      // PiP can reject (disabled by policy, no decoded frame yet); leave the inline
      // player as-is rather than surfacing a transient error.
    }
  };

  return (
    <div className="lv-wrap">
      <video className="lv-video" ref={videoRef} src={src} controls playsInline />
      {pipSupported && (
        <button
          type="button"
          className={"lv-pip" + (pipActive ? " on" : "")}
          onClick={() => void togglePip()}
          title={pipActive ? "Exit picture-in-picture" : "Pop video out (picture-in-picture)"}
          aria-label="Picture-in-picture"
          aria-pressed={pipActive}
        >
          <PipIcon />
        </button>
      )}
    </div>
  );
}
