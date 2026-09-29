import { BoxGeometry, BufferGeometry, Color, CylinderGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardNodeMaterial, Quaternion, SphereGeometry, TorusGeometry, Vector3 } from 'three/webgpu';
import type { World } from '../contracts';
import { BOAT } from '../config';
import { RIG_SCALE, clamp, damp, flatMaterial, merge, mk, rnd } from './build';

/**
 * Procedural rowboat. Local frame: +x = bow, +y = up, +z = starboard, y = 0 is the waterline.
 * Everything static is merged into ONE vertex-coloured mesh (+ lantern glass).
 */

const N = 15; // stations along the hull
const gunY = (u: number) => 0.16 + 0.12 * u * u; // sheer line (rises at bow and stern)
const beam = (u: number) => 0.44 * Math.pow(Math.max(1 - Math.pow(Math.abs(u), 2.4), 0), 0.55); // half beam at the gunwale
const keelY = (u: number) => { const k = Math.pow(Math.abs(u), 3); return -0.3 + (gunY(u) - 0.02 + 0.3) * k; };
const prof = (s: number) => 0.1 + 0.9 * Math.pow(Math.sin(s * Math.PI * 0.5), 0.8); // cross-section curve

class Tris {
  pos: number[] = []; col: number[] = [];
  private c = new Color();
  quad(a: number[], b: number[], c: number[], d: number[], color: string, jitter = 0.05) {
    this.c.set(color); const k = 1 + (rnd() - 0.5) * 2 * jitter;
    for (const p of [a, b, c, a, c, d]) { this.pos.push(p[0], p[1], p[2]); this.col.push(this.c.r * k, this.c.g * k, this.c.b * k); }
  }
  geometry() {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    return g;
  }
}

function buildHull() {
  const t = new Tris();
  const outerS = [0, 0.16, 0.38, 0.6, 0.8, 1];
  const outerColors = ['#6b4326', '#a86a39', '#b87b45', '#a86a39', '#cf4f42'];
  const innerS = [0, 0.35, 0.7, 1];
  const innerColors = ['#b97d45', '#cc9558', '#c58b4e'];
  const pt = (u: number, s: number, side: number, inner: boolean, extra: number) => {
    const b = inner ? Math.max(beam(u) - 0.04, 0) : beam(u);
    const y0 = keelY(u) + (inner ? 0.035 : 0), y1 = gunY(u);
    return [u, y0 + (y1 - y0) * s, side * (b * prof(s) + (b > 0 ? extra : 0))];
  };
  for (const side of [-1, 1]) {
    for (let i = 0; i < N - 1; i++) {
      const u0 = -1 + (2 * i) / (N - 1), u1 = -1 + (2 * (i + 1)) / (N - 1);
      for (let j = 0; j < outerS.length - 1; j++) {
        const s0 = outerS[j], s1 = outerS[j + 1];
        t.quad(pt(u0, s0, side, false, 0.016), pt(u1, s0, side, false, 0.016), pt(u1, s1, side, false, 0), pt(u0, s1, side, false, 0), outerColors[j]);
      }
      for (let j = 0; j < innerS.length - 1; j++) {
        t.quad(pt(u0, innerS[j], side, true, 0), pt(u1, innerS[j], side, true, 0), pt(u1, innerS[j + 1], side, true, 0), pt(u0, innerS[j + 1], side, true, 0), innerColors[j]);
      }
      t.quad(pt(u0, 1, side, false, 0), pt(u1, 1, side, false, 0), pt(u1, 1, side, true, 0), pt(u0, 1, side, true, 0), '#e2b676', 0.03);
    }
  }
  return t.geometry();
}

function buildProps() {
  const parts: BufferGeometry[] = [buildHull()];
  const box = new BoxGeometry(1, 1, 1), cyl = new CylinderGeometry(1, 1, 1, 8), sphere = new SphereGeometry(1, 8, 6);
  const wood = '#d6a05c', darkWood = '#8a5a30';
  // floor boards
  for (let i = -1; i <= 1; i++) parts.push(mk(box, '#c08a50', [0, -0.17, i * 0.1], [0, 0, 0], [0.9, 0.02, 0.09]));
  // thwarts (seats) + little knees
  parts.push(mk(box, wood, [-0.12, 0.05, 0], [0, 0, 0], [0.2, 0.035, 0.8]));
  parts.push(mk(box, wood, [0.5, 0.07, 0], [0, 0, 0], [0.16, 0.03, 0.6]));
  // stern & bow deck caps
  parts.push(mk(box, '#d9a865', [-0.78, 0.13, 0], [0, 0, 0.35], [0.22, 0.025, 0.36]));
  parts.push(mk(box, '#d9a865', [0.86, 0.2, 0], [0, 0, -0.35], [0.16, 0.025, 0.24]));
  // bow ring & cleat
  parts.push(mk(new TorusGeometry(0.035, 0.008, 5, 10), '#3a3a3e', [1.0, 0.16, 0], [0, Math.PI / 2, 0]));
  parts.push(mk(box, '#3a3a3e', [0.9, 0.22, 0], [0, 0, 0], [0.07, 0.015, 0.02]));
  // oarlocks + oars (shipped, blades trailing aft over the water)
  for (const side of [-1, 1]) {
    parts.push(mk(cyl, '#4a4a50', [0.3, 0.2, side * 0.42], [0, 0, 0], [0.012, 0.06, 0.012]));
    parts.push(mk(new TorusGeometry(0.03, 0.009, 4, 8), '#4a4a50', [0.3, 0.245, side * 0.42], [Math.PI / 2, 0, 0]));
    // shaft along direction d = (-0.5, 0.16, side*1)
    const d = new Vector3(-0.5, 0.16, side).normalize();
    const centre = new Vector3(0.3, 0.245, side * 0.42).addScaledVector(d, 0.3);
    const shaft = mk(cyl, '#a9773f', [0, 0, 0], [0, 0, 0], [0.02, 1.2, 0.02]);
    const blade = mk(box, '#cf4f42', [0, 0.5, 0], [0, 0, 0], [0.09, 0.32, 0.018]);
    const oar = merge([shaft, blade, mk(cyl, '#3f2a18', [0, -0.58, 0], [0, 0, 0], [0.03, 0.12, 0.03])]);
    // orient the +y axis of the oar to d
    const up = new Vector3(0, 1, 0), axis = new Vector3().crossVectors(up, d).normalize(), ang = Math.acos(clamp(up.dot(d), -1, 1));
    oar.applyQuaternion(new Quaternion().setFromAxisAngle(axis, ang));
    oar.translate(centre.x, centre.y, centre.z);
    parts.push(oar);
  }
  // bucket (open, tapered) at the bow, with a slice of water inside
  parts.push(mk(new CylinderGeometry(0.115, 0.088, 0.22, 10, 1, true), '#8f98a3', [0.74, 0.0, 0], [0, 0, 0], [1, 1, 1], 0.03));
  parts.push(mk(new CylinderGeometry(0.088, 0.088, 0.01, 10), '#6d7680', [0.74, -0.11, 0]));
  parts.push(mk(new CylinderGeometry(0.11, 0.11, 0.008, 10), '#5cc0e6', [0.74, 0.055, 0], [0, 0, 0], [1, 1, 1], 0.02));
  parts.push(mk(new TorusGeometry(0.116, 0.01, 4, 12), '#69727c', [0.74, 0.11, 0], [Math.PI / 2, 0, 0]));
  parts.push(mk(new TorusGeometry(0.11, 0.006, 4, 8, Math.PI), '#4a5058', [0.74, 0.11, 0], [0, Math.PI / 2, 0]));
  // tackle box
  parts.push(mk(box, '#d0463c', [-0.38, -0.115, -0.2], [0, 0.25, 0], [0.24, 0.09, 0.14]));
  parts.push(mk(box, '#f0d9a8', [-0.38, -0.062, -0.2], [0, 0.25, 0], [0.25, 0.015, 0.15]));
  parts.push(mk(box, '#3a3a3e', [-0.38, -0.045, -0.2], [0, 0.25, 0], [0.09, 0.012, 0.02]));
  // lantern base + cap + bail
  parts.push(mk(cyl, '#3f4348', [-0.68, -0.135, 0.02], [0, 0, 0], [0.06, 0.02, 0.06]));
  parts.push(mk(cyl, '#3f4348', [-0.68, -0.005, 0.02], [0, 0, 0], [0.058, 0.014, 0.058]));
  parts.push(mk(new TorusGeometry(0.045, 0.005, 4, 8, Math.PI), '#3f4348', [-0.68, 0.0, 0.02], [0, 0, 0]));
  // coiled rope + net float on the tackle side
  parts.push(mk(new TorusGeometry(0.07, 0.022, 5, 10), '#d8c08a', [-0.15, -0.13, 0.22], [Math.PI / 2, 0, 0]));
  parts.push(mk(sphere, '#e8e2d0', [0.16, -0.14, -0.2], [0, 0, 0], [0.05, 0.05, 0.05]));
  return merge(parts);
}

export function createBoat(world: World) {
  const group = new Group();
  group.rotation.order = 'YZX';
  group.scale.setScalar(RIG_SCALE);
  const hull = new Mesh(buildProps(), flatMaterial(0.85));
  hull.castShadow = hull.receiveShadow = true;
  group.add(hull);

  const glassMat = new MeshStandardNodeMaterial({ color: '#ffd889', emissive: new Color('#ffa726'), emissiveIntensity: 2.2, roughness: 0.3, transparent: true, opacity: 0.92 });
  const glass = new Mesh(new CylinderGeometry(0.045, 0.045, 0.115, 8), glassMat);
  glass.position.set(-0.68, -0.07, 0.02);
  group.add(glass);

  const p = { x: BOAT.x as number, z: BOAT.z as number, y: world.heightAt(BOAT.x, BOAT.z), yaw: BOAT.heading as number, pitch: 0, roll: 0 };
  const kick = { roll: 0, rollV: 0, pitch: 0, pitchV: 0 };
  let clock = 0, rippleT = 1.5;
  const tmp = new Vector3();

  const sample = (lx: number, lz: number) => {
    const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
    lx *= RIG_SCALE; lz *= RIG_SCALE;
    return world.heightAt(p.x + lx * c + lz * s, p.z - lx * s + lz * c);
  };

  return {
    group,
    /** Current planar position / yaw / roll rate (for the fisherman and the game). */
    state: p,
    /** Give the hull a push: roll (rad/s impulse, +z side goes down) and pitch (bow up). */
    kick(roll: number, pitch = 0) { kick.rollV += roll; kick.pitchV += pitch; },
    localToWorld(x: number, y: number, z: number, out: Vector3) { return group.localToWorld(out.set(x, y, z)); },
    /** World-space centre of the bucket opening. */
    bucket(out: Vector3) { return group.localToWorld(out.set(0.74, 0.08, 0)); },
    update(dt: number) {
      clock += dt;
      // gentle mooring drift / yaw sway
      const px = BOAT.x + Math.sin(clock * 0.31) * 0.03 + Math.sin(clock * 0.13 + 1) * 0.02;
      const pz = BOAT.z + Math.cos(clock * 0.27) * 0.03 + Math.sin(clock * 0.11) * 0.015;
      const yaw = BOAT.heading + Math.sin(clock * 0.21) * 0.035 + Math.sin(clock * 0.09 + 2) * 0.03;
      p.x = damp(p.x, px, 2, dt); p.z = damp(p.z, pz, 2, dt); p.yaw = damp(p.yaw, yaw, 2, dt);
      // sample the waves under the hull
      const hb = sample(0.9, 0), hs = sample(-0.9, 0), hr = sample(0, 0.4), hl = sample(0, -0.4), hc = sample(0, 0);
      const target = (hb + hs + hr + hl + hc * 2) / 6 + 0.15 * RIG_SCALE;
      const pitchT = Math.atan2(hb - hs, 1.8 * RIG_SCALE), rollT = -Math.atan2(hr - hl, 0.8 * RIG_SCALE);
      const k = 1 - Math.exp(-dt * 6);
      p.y += (target - p.y) * k; p.pitch += (pitchT - p.pitch) * k; p.roll += (rollT - p.roll) * k;
      // kick springs (underdamped so the hull rocks back)
      kick.rollV += (-40 * kick.roll - 3.2 * kick.rollV) * dt; kick.roll += kick.rollV * dt;
      kick.pitchV += (-46 * kick.pitch - 3.4 * kick.pitchV) * dt; kick.pitch += kick.pitchV * dt;
      const bob = Math.sin(clock * 1.7) * 0.012;
      group.position.set(p.x, p.y + bob, p.z);
      group.rotation.set(p.roll + kick.roll + Math.sin(clock * 1.3) * 0.012, p.yaw, p.pitch + kick.pitch + Math.sin(clock * 1.1 + 1) * 0.01);
      group.updateMatrixWorld(true);
      glassMat.emissiveIntensity = 2 + Math.sin(clock * 9) * 0.15 + Math.sin(clock * 23) * 0.1;
      // soft ripples from the hull rocking
      rippleT -= dt;
      if (rippleT <= 0) {
        rippleT = 1.6 + Math.random() * 1.8;
        const side = Math.random() < 0.5 ? -1 : 1, lx = (Math.random() - 0.5) * 1.4, lz = side * (0.3 + Math.random() * 0.1);
        const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
        tmp.set(p.x + lx * c + lz * s, 0, p.z - lx * s + lz * c); tmp.y = world.heightAt(tmp.x, tmp.z);
        world.ripple(tmp, 0.12 + Math.abs(kick.roll) * 2);
      }
    },
  };
}
export type Boat = ReturnType<typeof createBoat>;
