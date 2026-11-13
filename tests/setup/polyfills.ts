// Loaded before any test imports react-dom (first entry in vitest setupFiles).
// jsdom has no AnimationEvent. Without it, react-dom resolves animation events to
// vendor-prefixed names (webkitAnimationEnd), so onAnimationStart/End never fire.
if (typeof window !== "undefined" && !("AnimationEvent" in window)) {
  class AnimationEventPolyfill extends Event {
    readonly animationName: string;
    readonly elapsedTime: number;
    readonly pseudoElement: string;
    constructor(type: string, init: AnimationEventInit = {}) {
      super(type, init);
      this.animationName = init.animationName ?? "";
      this.elapsedTime = init.elapsedTime ?? 0;
      this.pseudoElement = init.pseudoElement ?? "";
    }
  }
  Object.defineProperty(window, "AnimationEvent", {
    value: AnimationEventPolyfill,
    writable: true,
    configurable: true,
  });
}
