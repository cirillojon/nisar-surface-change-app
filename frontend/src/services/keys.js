/* Keyboard shortcuts that stay out of the way of the focused control.
 *
 * The tours and demo mode take Space, Enter, the arrows, Backspace and
 * Escape (no letter, number or punctuation keys, so nothing fires by
 * accident while speaking a command or typing: WCAG 2.1.4). A shortcut
 * never takes a key from the control that owns it (WCAG 2.1.1):
 *
 *  - a text field keeps every key (Escape there closes what it is in);
 *  - a button, link, slider or menu the user reached with the keyboard
 *    keeps Space, Enter and the arrows, so Tab to Play and Space plays it.
 *    One clicked with the mouse doesn't: the presenter's Space still moves
 *    the demo on after clicking Play.
 */

const TEXT_INPUT = /^(text|search|email|url|tel|password|number|date|month|week|time|datetime-local)$/;
const CONTROL = "button, a[href], input, select, summary, [role='button'], [role='tab'], [role='slider'], [role='option']";
const CONTROL_KEYS = new Set([" ", "Enter", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);

/** Is someone typing into `el` (a text field, a text area, editable text)? */
export function isTyping(el) {
  if (!el) return false;
  if (el.isContentEditable || el.tagName === "TEXTAREA") return true;
  return el.tagName === "INPUT" && TEXT_INPUT.test(el.type || "text");
}

// Which element the pointer (mouse, touch, pen) last focused. A control
// focused that way doesn't own Space and the arrows; one reached with Tab
// (or focused by the app) does. Tracked here rather than read from
// :focus-visible, which browsers also grant to mouse-focused elements after
// any key press.
let pointerFocused = null;
let pointerAt = 0;
const POINTER_FOCUS_MS = 1000;
if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", () => {
    pointerAt = Date.now();
  }, true);
  window.addEventListener("focusin", (e) => {
    pointerFocused = Date.now() - pointerAt < POINTER_FOCUS_MS ? e.target : null;
  }, true);
}

/** Should the focused element handle this key itself (not a shortcut)? */
export function keyBelongsToFocus(event) {
  const el = typeof document === "undefined" ? null : document.activeElement;
  if (!el || el === document.body) return false;
  if (isTyping(el)) return true;
  // A select keeps its arrows and Space however it was focused.
  if (el.tagName === "SELECT") return CONTROL_KEYS.has(event.key);
  if (!el.matches?.(CONTROL) || !CONTROL_KEYS.has(event.key)) return false;
  return el !== pointerFocused;
}

/** Is a modal dialog open (it owns the keyboard)? */
export const modalOpen = () =>
  typeof document !== "undefined" && Boolean(document.querySelector("[aria-modal='true']"));
