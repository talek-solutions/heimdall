/**
 * Maps wall-clock time onto a scenario's `[anchor − duration, anchor]`. Curves
 * are evaluated in *relative* time, so a scenario looks the same whatever the anchor.
 */
export class Timeline {
  public readonly startMs: number;
  public readonly anchorMs: number;

  constructor(anchor: Date, durationMs: number) {
    this.anchorMs = anchor.getTime();
    this.startMs = this.anchorMs - durationMs;
  }

  public relative(absoluteMs: number): number {
    return absoluteMs - this.startMs;
  }

  /** Nothing exists after the anchor: a backend never answers with the future. */
  public hasData(absoluteMs: number): boolean {
    return absoluteMs <= this.anchorMs;
  }
}
