import { Vector3 } from 'three/webgpu';
import { SWIM_BOUNDS, WORLD } from '../config';
import { sampleHeight } from './sim';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/**
 * The fountain-effect predator: a single big fish simulated on the CPU (one fish, no per-frame cost
 * proportional to N). It cruises around the school, then periodically charges straight through its centroid.
 */
export class Predator {
  pos = new Vector3(12, 6.5, 9); dir = new Vector3(-1, 0, -0.3).normalize();
  speed = 10.0; interval = 22; cruiseSpeed = 3.0;
  phase = 0; bank = 0; scale = 0; active = false;
  mode: 'cruise' | 'charge' = 'cruise';
  /** Incremented every time a charge finishes. */
  chargesDone = 0;
  private timer = 6; private chargeTime = 0; private chargeDir = new Vector3(); private orbit = 0; private forced = false;
  private v = new Vector3(); private want = new Vector3(); private target = new Vector3(); private aim = new Vector3(); private speedNow = 1.5;
  private exitPast = 10; private locked = false;

  constructor(private seabed: { heights: Float32Array; resolution: number }) {}

  /** Start a charge as soon as possible. */
  send() { this.timer = 0; this.mode = 'cruise'; this.forced = true; }

  /**
   * `ring`: while the school mills it is a torus with an empty middle, so its centroid is in the hollow. The predator
   * then prowls outside the ring and charges through the band of fish instead of across the empty centre.
   */
  update(dt: number, centroid: Vector3, enabled: boolean, ring: { center: Vector3; radius: number } | null = null) {
    // fade in / out (scale is the size multiplier)
    this.scale += ((enabled ? 1 : 0) - this.scale) * Math.min(1, dt * 1.5);
    this.active = enabled && this.scale > 0.6;
    if (this.scale < 0.01 && !enabled) return;
    const c = centroid;
    if (this.mode === 'cruise') {
      this.timer -= dt;
      // prowl around the OUTSIDE of the school (target clamped inside the tank walls)
      const rel = this.v.set(this.pos.x - c.x, 0, this.pos.z - c.z), ang = Math.atan2(rel.z, rel.x) + 0.5, R = ring ? ring.radius + 7 : 11.0;
      this.orbit += dt * 0.4;
      const lim = WORLD.half - 3;
      this.target.set(clamp(c.x + Math.cos(ang) * R, -lim, lim), clamp(c.y + Math.sin(this.orbit) * 1.5, 4.5, 8.5), clamp(c.z + Math.sin(ang) * R, -lim, lim));
      this.want.copy(this.target).sub(this.pos);
      this.speedNow += (this.cruiseSpeed - this.speedNow) * Math.min(1, dt * 1.2);
      this.steer(dt, 1.3);
      if (this.timer <= 0 && (this.pos.distanceTo(c) > 7 || this.forced)) {
        this.mode = 'charge'; this.chargeTime = 0; this.forced = false;
        // Pierce straight through: aim at the centre (of the milling ring, or the school), run through it and out the far
        // side. While milling it crosses the near wall of fish, the empty hollow, then the far wall.
        if (ring) this.aim.copy(ring.center); else this.aim.copy(c);
        this.exitPast = (ring ? ring.radius : 4) + 6; this.locked = false;
        this.chargeDir.copy(this.aim).sub(this.pos); this.chargeDir.y *= 0.5;
        if (this.chargeDir.lengthSq() < 0.01) this.chargeDir.set(1, 0, 0);
        this.chargeDir.normalize();
      }
    } else {
      this.chargeTime += dt;
      // Home in on the centre until it is close or already passed, then lock the heading: a straight run, no curving.
      if (!this.locked) {
        this.chargeDir.copy(this.aim).sub(this.pos); this.chargeDir.y *= 0.5;
        const d = this.chargeDir.length();
        if (d < 3.5 || this.v.copy(this.dir).dot(this.chargeDir) < 0) this.locked = true;
        if (d > 1e-3) this.chargeDir.divideScalar(d); else this.chargeDir.copy(this.dir);
      }
      this.target.copy(this.pos).addScaledVector(this.chargeDir, 10);
      this.want.copy(this.target).sub(this.pos);
      this.speedNow += (this.speed - this.speedNow) * Math.min(1, dt * 3.5);
      this.steer(dt, this.locked ? 6 : 3.2);
      const past = this.v.copy(this.pos).sub(this.aim).dot(this.chargeDir);
      if ((this.locked && past > this.exitPast) || this.chargeTime > 12) { this.mode = 'cruise'; this.chargesDone++; this.timer = this.interval * (0.7 + Math.random() * 0.6); }
    }
    this.phase = (this.phase + dt * (1.1 + this.speedNow * 0.6)) % 1; // fast, sweeping tail beat
    this.avoid();
  }

  private steer(dt: number, turn: number) {
    const before = Math.atan2(this.dir.z, this.dir.x);
    this.want.normalize();
    this.dir.lerp(this.want, Math.min(1, turn * dt)).normalize();
    let d = Math.atan2(this.dir.z, this.dir.x) - before; d = Math.atan2(Math.sin(d), Math.cos(d));
    this.bank += (clamp(d / Math.max(dt, 1e-3) * 0.35, -0.7, 0.7) - this.bank) * Math.min(1, dt * 4);
    this.dir.y = clamp(this.dir.y, -0.35, 0.35); this.dir.normalize();
    this.pos.addScaledVector(this.dir, this.speedNow * dt);
  }

  /** Keep inside the tank and out of the terrain / island. */
  private avoid() {
    const p = this.pos, margin = 2.0;
    const hAhead = sampleHeight(this.seabed, p.x + this.dir.x * 3.5, p.z + this.dir.z * 3.5);
    if (hAhead > p.y - 1.8) {
      const e = 0.8, gx = sampleHeight(this.seabed, p.x + e, p.z) - sampleHeight(this.seabed, p.x - e, p.z), gz = sampleHeight(this.seabed, p.x, p.z + e) - sampleHeight(this.seabed, p.x, p.z - e);
      this.dir.x -= gx * 0.6; this.dir.z -= gz * 0.6; this.dir.y += hAhead > WORLD.surface - 1.2 ? 0 : 0.15; this.dir.normalize();
    }
    p.x = clamp(p.x, SWIM_BOUNDS.min[0] + margin, SWIM_BOUNDS.max[0] - margin);
    p.z = clamp(p.z, SWIM_BOUNDS.min[2] + margin, SWIM_BOUNDS.max[2] - margin);
    p.y = clamp(p.y, sampleHeight(this.seabed, p.x, p.z) + 1.8, SWIM_BOUNDS.max[1] - 1.5);
  }
}
