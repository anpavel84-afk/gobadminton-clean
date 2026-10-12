/** Private UI ownership is independent of delayed Inbox/polling registration. */
class PrivateViews {
  private generation = 0;
  private views = new Set<object>();
  private target?: Window;
  private retire = () => { ++this.generation; this.views.clear(); };

  private bind() {
    if (typeof window === "undefined" || typeof window.addEventListener !== "function" ||
        typeof window.removeEventListener !== "function" || this.target === window) return;
    this.target?.removeEventListener("gb-session-changed", this.retire);
    this.target?.removeEventListener("gb-private-expired", this.retire);
    this.retire(); this.target = window;
    window.addEventListener("gb-session-changed", this.retire);
    window.addEventListener("gb-private-expired", this.retire);
  }
  get currentGeneration() { this.bind(); return this.generation; }
  hasView(generation: number) {
    return generation === this.currentGeneration && this.views.size > 0;
  }
  retain(generation: number): (() => void) | undefined {
    if (generation !== this.currentGeneration) return;
    const view = {}; this.views.add(view);
    return () => { this.views.delete(view); };
  }
}

export const privateViews = new PrivateViews();
