import "@testing-library/jest-dom/vitest";

// TanStack Query passes results on in a setTimeout(0) batch; in tests, pass
// them on at once, so act() flushes them and fake timers don't hold them back.
import { notifyManager } from "@tanstack/react-query";

notifyManager.setScheduler((callback) => callback());

// jsdom has <dialog> but not its methods: open and close it as browsers do.
if (typeof HTMLDialogElement !== "undefined") {
  HTMLDialogElement.prototype.showModal ??= function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.show ??= function show() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close ??= function close() {
    this.removeAttribute("open");
  };
}
