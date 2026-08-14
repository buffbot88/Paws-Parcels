export interface PositionSample {
  at: number;
  x: number;
  y: number;
}

export interface InterpolatedPosition {
  x: number;
  y: number;
  moving: boolean;
}

/** Keep a bounded, ordered history of authoritative position samples. */
export class PositionSampleBuffer {
  private samples: PositionSample[] = [];

  constructor(private readonly maxSamples = 8) {}

  clear(): void {
    this.samples = [];
  }

  latest(): PositionSample | null {
    return this.samples[this.samples.length - 1] ?? null;
  }

  add(sample: PositionSample): boolean {
    const last = this.latest();
    if (last !== null && sample.at < last.at) return false;
    if (last !== null && sample.at === last.at) {
      this.samples[this.samples.length - 1] = { ...sample };
      return true;
    }
    this.samples.push({ ...sample });
    if (this.samples.length > this.maxSamples) {
      this.samples.splice(0, this.samples.length - this.maxSamples);
    }
    return true;
  }

  /** Render a short time behind the newest sample to absorb packet jitter. */
  positionAt(renderAt: number): InterpolatedPosition | null {
    if (this.samples.length === 0) return null;
    if (this.samples.length === 1 || renderAt <= this.samples[0].at) {
      const first = this.samples[0];
      return { x: first.x, y: first.y, moving: false };
    }

    for (let index = 1; index < this.samples.length; index += 1) {
      const right = this.samples[index];
      const left = this.samples[index - 1];
      if (renderAt > right.at) continue;
      const span = right.at - left.at;
      const ratio = span <= 0 ? 1 : Math.max(0, Math.min(1, (renderAt - left.at) / span));
      return {
        x: left.x + (right.x - left.x) * ratio,
        y: left.y + (right.y - left.y) * ratio,
        moving: Math.abs(right.x - left.x) > 0.01 || Math.abs(right.y - left.y) > 0.01,
      };
    }

    const latest = this.samples[this.samples.length - 1];
    return { x: latest.x, y: latest.y, moving: false };
  }
}
