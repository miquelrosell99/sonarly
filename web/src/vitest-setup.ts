// Vitest global setup (registered in vite.config.ts test.setupFiles).
// jsdom has no Pointer Capture API; Radix triggers call hasPointerCapture /
// releasePointerCapture on pointerdown, which would throw unhandled errors
// in any test that opens a catalog select/dropdown with fireEvent.
if (typeof Element !== 'undefined' && typeof Element.prototype.hasPointerCapture !== 'function') {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.setPointerCapture = () => {};
}
