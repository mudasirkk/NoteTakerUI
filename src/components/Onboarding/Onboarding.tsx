import { useEffect, useState } from "react";
import { loadPref, savePref } from "../../platform/uiPrefs";
import { openTutorial } from "../../platform/tutorial";

// One-time getting-started card (UX-8). A non-modal coachmark walking the four
// core moves — source → capture → seek → map — shown once per install and then
// dismissed for good (persisted device-locally via uiPrefs, like the other
// presentation preferences). It never blocks the canvas: the user can start
// typing notes straight away and close it whenever.
const ONBOARDED_KEY = "onboarded";

const STEPS: { k: string; title: string; body: string }[] = [
  {
    k: "source",
    title: "Pick a source",
    body: "Add a YouTube link, open a local video, or just start the session timer — all from the top bar.",
  },
  {
    k: "capture",
    title: "Capture in the outline",
    body: "Type to take notes. Enter starts a sibling, Tab indents — shape the structure as you listen.",
  },
  {
    k: "seek",
    title: "Jump back by timestamp",
    body: "Notes are stamped to the moment you wrote them. Click a timestamp to seek the video right back there.",
  },
  {
    k: "map",
    title: "Review as a map",
    body: "Press Ctrl+M for a mind-map of your notes, and drag between nodes to link related ideas.",
  },
];

export function Onboarding() {
  const [show, setShow] = useState(() => !loadPref(ONBOARDED_KEY, false));

  const dismiss = () => {
    savePref(ONBOARDED_KEY, true);
    setShow(false);
  };

  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        dismiss();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [show]);

  if (!show) return null;

  return (
    <div className="onboard" role="dialog" aria-label="Getting started">
      <div className="onboard-head">
        <span className="onboard-eyebrow">Getting started</span>
        <button className="onboard-x" onClick={dismiss} aria-label="Dismiss" title="Dismiss">
          ✕
        </button>
      </div>
      <ol className="onboard-steps">
        {STEPS.map((s, i) => (
          <li key={s.k}>
            <span className="onboard-num">{i + 1}</span>
            <span className="onboard-step-txt">
              <b>{s.title}.</b> {s.body}
            </span>
          </li>
        ))}
      </ol>
      <div className="onboard-foot">
        <button className="onboard-tour" onClick={() => void openTutorial()}>
          Take the tour
        </button>
        <button className="onboard-go" onClick={dismiss}>
          Got it
        </button>
      </div>
    </div>
  );
}
