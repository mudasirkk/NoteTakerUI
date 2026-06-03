import { useEffect, useRef } from "react";
import { useStore } from "../../state/store";
import { useFocusTrap } from "../../keyboard/useFocusTrap";
import { KEYMAP, GROUP_ORDER, GROUP_NOTES, isBrowserTab, type KeyGroup } from "../../keyboard/keymap";
import { openTutorial } from "../../platform/tutorial";

// The "?" keyboard-shortcuts overlay (UI-3). Rendered straight from KEYMAP so it
// can never drift from the real bindings — the footer hint strip reads the same
// source. Modal: focus-trapped, closes on Escape / scrim / ×.
export function HelpOverlay() {
  const open = useStore((s) => s.helpOpen);
  const setHelp = useStore((s) => s.setHelp);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(open, panelRef);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setHelp(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, setHelp]);

  if (!open) return null;

  const close = () => setHelp(false);

  return (
    <div className="palscrim" onMouseDown={close}>
      <div
        className="help"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="help-head">
          <h2>Keyboard shortcuts</h2>
          <button className="help-x" onClick={close} aria-label="Close" title="Close">
            ✕
          </button>
        </div>
        <div className="help-grid">
          {GROUP_ORDER.map((group) => (
            <section className="help-col" key={group} aria-label={group}>
              <h3>
                {group}
                {GROUP_NOTES[group as KeyGroup] && (
                  <span className="help-note"> · {GROUP_NOTES[group as KeyGroup]}</span>
                )}
              </h3>
              {KEYMAP.filter((b) => b.group === group).map((b) => (
                <div className="help-row" key={b.combo + b.action}>
                  <span className="help-keys">
                    {b.combo.split(" / ").map((part, i, arr) => (
                      <span key={part}>
                        <kbd>{part}</kbd>
                        {i < arr.length - 1 && <span className="help-or">/</span>}
                      </span>
                    ))}
                  </span>
                  <span className="help-act">{b.action}</span>
                </div>
              ))}
            </section>
          ))}
        </div>
        <div className="help-foot">
          <span>
            Press <kbd>?</kbd> any time · <kbd>Esc</kbd> to close
          </span>
          <span className="help-foot-tour">
            New to NoteTaker?{" "}
            <button className="help-foot-link" onClick={() => void openTutorial()}>
              Take the quick tour →
            </button>
          </span>
          {isBrowserTab && (
            <span className="help-foot-tip">
              Tip: <b>install NoteTaker as an app</b> (look for the install icon in your
              browser's address bar). The shortcuts then match the desktop app — including{" "}
              <kbd>Ctrl+T</kbd> for timestamps. In a plain browser tab use <kbd>Alt+T</kbd>,
              since the browser keeps <kbd>Ctrl+T</kbd> for itself.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
