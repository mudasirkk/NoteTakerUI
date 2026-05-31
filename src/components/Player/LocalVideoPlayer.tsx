import { useEffect, useRef } from "react";
import { useStore } from "../../state/store";
import { LocalVideoController } from "../../player/PlayerController";

export function LocalVideoPlayer({ src }: { src: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const setController = useStore((s) => s.setController);
  const clearController = useStore((s) => s.clearController);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    setController(new LocalVideoController(el));
    return () => clearController();
  }, [setController, clearController]);

  return <video className="lv-video" ref={videoRef} src={src} controls playsInline />;
}
