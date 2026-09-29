import { Vector3 } from 'three/webgpu';
import { SWIM_BOUNDS, WORLD } from '../config';
import { sampleHeight } from './sim';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/**
 * The fountain-effect predator: a single big fish simulated on the CPU (one fish, no per-frame cost
 * proportional to N). It cruises around the school, then periodically charges straight through its centroid.
 */
export class Predator {
  pos = new Vector3(4, 4.2, 3); dir = new Vector3(-1, 0, -0.3).normalize();
  speed = 5.5; interval = 22; cruiseSpeed = 1.5;
  phase = 0; bank = 0; scale = 0; active = false;
  private mode: 'cruise' | 'charge' = 'cruise';
  private timer = 6; private chargeTime = 0; private chargeDir = new Vector3(); private orbit = 0; private forced = false;
  private v = new Vector3(); private want = new Vector3(); private target = new Vector3(); private speedNow = 1.5;

  constructor(private seabed: { heights: Float32Array; resolution: number }) {}

  /** Start a charge as soon as possible. */
  send() { this.timer = 0; this.mode = 'cruise'; this.forced = true; }

  update(dt: number, centroid: Vector3, enabled: boolean) {
    // fade in / out (scale is the size multiplier)
    this.scale += ((enabled ? 1 : 0) - this.scale) * Math.min(1, dt * 1.5);
    this.active = enabled && this.scale > 0.6;
    if (this.scale < 0.01 && !enabled) return;
    const c = centroid;
    if (this.mode === 'cruise') {
      this.timer -= dt;
      // circle the tank (inside the walls), at the school's depth
      const rel = this.v.set(this.pos.x, 0, this.pos.z), ang = Math.atan2(rel.z, rel.x) + 0.6, R = 3.7;
      this.orbit += dt * 0.4;
      this.target.set(Math.cos(ang) * R, clamp(c.y + Math.sin(this.orbit) * 0.9, 2.8, 6.0), Math.sin(ang) * R);
      this.want.copy(this.target).sub(this.pos);
      this.speedNow += (this.cruiseSpeed - this.speedNow) * Math.min(1, dt * 1.2);
      this.steer(dt, 1.3);
      if (this.timer <= 0 && (this.pos.distanceTo(c) > 3.2 || this.forced)) {
        this.mode = 'charge'; this.chargeTime = 0; this.forced = false;
        this.chargeDir.copy(c).sub(this.pos); this.chargeDir.y *= 0.5;
        if (this.chargeDir.lengthSq() < 0.01) this.chargeDir.set(1, 0, 0);
        this.chargeDir.normalize();
      }
    } else {
      this.chargeTime += dt;
      this.target.copy(c).addScaledVector(this.chargeDir, 6);
      this.want.copy(this.target).sub(this.pos);
      this.speedNow += (this.speed - this.speedNow) * Math.min(1, dt * 3.5);
      this.steer(dt, 1.0);
      const past = this.v.copy(this.pos).sub(c).dot(this.chargeDir);
      if (past > 4.2 || this.chargeTime > 8) { this.mode = 'cruise'; this.timer = this.interval * (0.7 + Math.random() * 0.6); }
    }
    this.phase = (this.phase + dt * (0.35 + this.speedNow * 0.32)) % 1;
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
    const p = this.pos, margin = 0.9;
    const hAhead = sampleHeight(this.seabed, p.x + this.dir.x * 1.6, p.z + this.dir.z * 1.6);
    if (hAhead > p.y - 0.9) {
      const e = 0.4, gx = sampleHeight(this.seabed, p.x + e, p.z) - sampleHeight(this.seabed, p.x - e, p.z), gz = sampleHeight(this.seabed, p.x, p.z + e) - sampleHeight(this.seabed, p.x, p.z - e);
      this.dir.x -= gx * 0.6; this.dir.z -= gz * 0.6; this.dir.y += hAhead > WORLD.surface - 1.2 ? 0 : 0.15; this.dir.normalize();
    }
    p.x = clamp(p.x, SWIM_BOUNDS.min[0] + margin, SWIM_BOUNDS.max[0] - margin);
    p.z = clamp(p.z, SWIM_BOUNDS.min[2] + margin, SWIM_BOUNDS.max[2] - margin);
    p.y = clamp(p.y, sampleHeight(this.seabed, p.x, p.z) + 0.9, SWIM_BOUNDS.max[1] - 0.6);
  }
}
