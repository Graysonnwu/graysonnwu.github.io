// Only a short, unmoved, single-pointer gesture may select an optical object.
// Finishing a two-finger pan/pinch must never be mistaken for a tap.
export class SceneTap {
  constructor() {
    this.pointers = new Set();
    this.candidate = null;
  }
  start(e, blocked = false) {
    this.pointers.add(e.pointerId);
    this.candidate =
      this.pointers.size === 1 && !blocked
        ? { id: e.pointerId, x: e.clientX, y: e.clientY, time: e.timeStamp }
        : null;
  }
  move(e) {
    if (
      this.candidate?.id === e.pointerId &&
      Math.hypot(e.clientX - this.candidate.x, e.clientY - this.candidate.y) > 7
    )
      this.candidate = null;
  }
  end(e) {
    this.move(e);
    const tap =
      this.pointers.size === 1 &&
      this.candidate?.id === e.pointerId &&
      e.timeStamp - this.candidate.time < 650;
    this.pointers.delete(e.pointerId);
    this.candidate = null;
    return Boolean(tap);
  }
  cancel(e) {
    this.pointers.delete(e.pointerId);
    this.candidate = null;
  }
}
