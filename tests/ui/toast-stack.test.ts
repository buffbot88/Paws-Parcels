/** Toast stack: cap on visible toasts, auto-dismiss timing, and clearing (renderer injected, no DOM). */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_TOASTS, TOAST_MS, ToastStack, type Toast, type ToastRenderer } from "../../src/ui/ToastStack.ts";

class RecordingRenderer implements ToastRenderer {
  readonly shown = new Map<number, Toast>();
  add(toast: Toast): void {
    this.shown.set(toast.id, toast);
  }
  remove(id: number): void {
    this.shown.delete(id);
  }
}

describe("ToastStack", () => {
  let renderer: RecordingRenderer;
  let stack: ToastStack;

  beforeEach(() => {
    vi.useFakeTimers();
    renderer = new RecordingRenderer();
    stack = new ToastStack(renderer);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps at most four toasts, dropping the oldest first", () => {
    expect(MAX_TOASTS).toBe(4);
    for (let i = 1; i <= 6; i++) stack.show(`toast ${i}`);
    expect(stack.current().map((toast) => toast.message)).toEqual(["toast 3", "toast 4", "toast 5", "toast 6"]);
    expect([...renderer.shown.values()].map((toast) => toast.message)).toEqual(["toast 3", "toast 4", "toast 5", "toast 6"]);
  });

  it("dismisses each toast on its own after about three seconds", () => {
    expect(TOAST_MS).toBe(3000);
    stack.show("first", "success");
    vi.advanceTimersByTime(1000);
    stack.show("second");
    vi.advanceTimersByTime(TOAST_MS - 1000);
    expect(stack.current().map((toast) => toast.message)).toEqual(["second"]);
    vi.advanceTimersByTime(1000);
    expect(stack.current()).toEqual([]);
    expect(renderer.shown.size).toBe(0);
  });

  it("ignores empty messages and clears everything on demand", () => {
    stack.show("");
    expect(stack.current()).toEqual([]);
    stack.show("a");
    stack.show("b", "warning");
    stack.clear();
    expect(stack.current()).toEqual([]);
    expect(renderer.shown.size).toBe(0);
    // Timers from cleared toasts must not remove later ones.
    stack.show("c");
    vi.advanceTimersByTime(TOAST_MS - 1);
    expect(stack.current().map((toast) => toast.message)).toEqual(["c"]);
  });
});
