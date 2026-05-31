import { useEffect, type RefObject } from "react";

// Keyboard focus trap for modal overlays (UI-2 / WCAG 2.4.3, 2.1.2). While
// `active`, Tab and Shift+Tab cycle only through focusable children of `ref`, so
// keyboard users can't tab into the inert page behind the scrim. On activate we
// pull focus into the container; on deactivate we return it to whatever held it
// before (so closing a palette lands the caret back where the user was).
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useFocusTrap(active: boolean, ref: RefObject<HTMLElement>) {
  useEffect(() => {
    if (!active) return;
    const container = ref.current;
    if (!container) return;

    const restoreTo = document.activeElement as HTMLElement | null;

    const focusables = () =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement
      );

    // If focus hasn't already landed inside (the palettes self-focus their input
    // a tick later, which is fine), seed it on the first focusable child.
    if (!container.contains(document.activeElement)) focusables()[0]?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const here = document.activeElement;
      if (e.shiftKey) {
        if (here === first || !container.contains(here)) {
          e.preventDefault();
          last.focus();
        }
      } else if (here === last || !container.contains(here)) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      if (restoreTo && document.contains(restoreTo)) restoreTo.focus();
    };
  }, [active, ref]);
}
