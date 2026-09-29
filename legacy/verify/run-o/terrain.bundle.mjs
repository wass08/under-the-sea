import { BufferGeometry, Float32BufferAttribute, Vector3 } from "three/webgpu";
//#region src/lib/random.ts
/** Deterministic LCG; each call returns a number in [0, 1). */
function random(seed = 1) {
	return () => {
		seed = Math.imul(1664525, seed) + 1013904223 | 0;
		return (seed >>> 0) / 4294967296;
	};
}
//#endregion
//#region node_modules/simplex-noise/dist/esm/simplex-noise.js
const SQRT3 = /*#__PURE__*/ Math.sqrt(3);
const SQRT5 = /*#__PURE__*/ Math.sqrt(5);
const F2 = .5 * (SQRT3 - 1);
const G2 = (3 - SQRT3) / 6;
(SQRT5 - 1) / 4;
(5 - SQRT5) / 20;
const fastFloor = (x) => Math.floor(x) | 0;
const grad2 = /*#__PURE__*/ new Float64Array([
	1,
	1,
	-1,
	1,
	1,
	-1,
	-1,
	-1,
	1,
	0,
	-1,
	0,
	1,
	0,
	-1,
	0,
	0,
	1,
	0,
	-1,
	0,
	1,
	0,
	-1
]);
/**
* Creates a 2D noise function
* @param random the random function that will be used to build the permutation table
* @returns {NoiseFunction2D}
*/
function createNoise2D$1(random = Math.random) {
	const perm = buildPermutationTable(random);
	const permGrad2x = new Float64Array(perm).map((v) => grad2[v % 12 * 2]);
	const permGrad2y = new Float64Array(perm).map((v) => grad2[v % 12 * 2 + 1]);
	return function noise2D(x, y) {
		let n0 = 0;
		let n1 = 0;
		let n2 = 0;
		const s = (x + y) * F2;
		const i = fastFloor(x + s);
		const j = fastFloor(y + s);
		const t = (i + j) * G2;
		const X0 = i - t;
		const Y0 = j - t;
		const x0 = x - X0;
		const y0 = y - Y0;
		let i1, j1;
		if (x0 > y0) {
			i1 = 1;
			j1 = 0;
		} else {
			i1 = 0;
			j1 = 1;
		}
		const x1 = x0 - i1 + G2;
		const y1 = y0 - j1 + G2;
		const x2 = x0 - 1 + 2 * G2;
		const y2 = y0 - 1 + 2 * G2;
		const ii = i & 255;
		const jj = j & 255;
		let t0 = .5 - x0 * x0 - y0 * y0;
		if (t0 >= 0) {
			const gi0 = ii + perm[jj];
			const g0x = permGrad2x[gi0];
			const g0y = permGrad2y[gi0];
			t0 *= t0;
			n0 = t0 * t0 * (g0x * x0 + g0y * y0);
		}
		let t1 = .5 - x1 * x1 - y1 * y1;
		if (t1 >= 0) {
			const gi1 = ii + i1 + perm[jj + j1];
			const g1x = permGrad2x[gi1];
			const g1y = permGrad2y[gi1];
			t1 *= t1;
			n1 = t1 * t1 * (g1x * x1 + g1y * y1);
		}
		let t2 = .5 - x2 * x2 - y2 * y2;
		if (t2 >= 0) {
			const gi2 = ii + 1 + perm[jj + 1];
			const g2x = permGrad2x[gi2];
			const g2y = permGrad2y[gi2];
			t2 *= t2;
			n2 = t2 * t2 * (g2x * x2 + g2y * y2);
		}
		return 70 * (n0 + n1 + n2);
	};
}
/**
* Builds a random permutation table.
* This is exported only for (internal) testing purposes.
* Do not rely on this export.
* @private
*/
function buildPermutationTable(random) {
	const tableSize = 512;
	const p = new Uint8Array(tableSize);
	for (let i = 0; i < tableSize / 2; i++) p[i] = i;
	for (let i = 0; i < tableSize / 2 - 1; i++) {
		const r = i + ~~(random() * (256 - i));
		const aux = p[i];
		p[i] = p[r];
		p[r] = aux;
	}
	for (let i = 256; i < tableSize; i++) p[i] = p[i - 256];
	return p;
}
//#endregion
//#region src/lib/noise.ts
/** Seeded simplex field; pass it to the fractal helpers to share one landscape. */
function createNoise2D(seed) {
	return createNoise2D$1(random(seed));
}
const defaultNoise = createNoise2D(1);
function fractal(x, y, options, ridge) {
	const { octaves = 5, lacunarity = 2, gain = .5, noise = defaultNoise } = options;
	let sum = 0, weight = 1, total = 0;
	for (let i = 0; i < octaves; i++) {
		const n = noise(x, y);
		sum += (ridge ? 1 - Math.abs(n) : n) * weight;
		total += weight;
		weight *= gain;
		x *= lacunarity;
		y *= lacunarity;
	}
	return sum / total;
}
/** Normalized fractional Brownian motion of simplex octaves. */
function fbm(x, y, options = {}) {
	return fractal(x, y, options, false);
}
/** fBm of 1 − |noise|: creases become mountain ridges. */
function ridged(x, y, options = {}) {
	return fractal(x, y, options, true);
}
/** Blend broad fBm landforms with ridged detail, then flatten valleys with a power curve. */
function terrainHeight(x, y, params = {}) {
	const { amplitude = 4, frequency = .14, power = 2.7 } = params;
	x *= frequency;
	y *= frequency;
	const broad = fbm(x, y, {
		...params,
		octaves: 3,
		gain: .42
	}) * .5 + .5;
	const ridge = ridged(x * .8 + 9, y * .8 - 4, {
		...params,
		octaves: 3,
		gain: .3
	});
	const shape = Math.max(0, Math.min(1, (broad * .82 + ridge * .18 - .29) / .48));
	return amplitude * Math.pow(shape, power);
}
//#endregion
//#region src/lib/poisson.ts
/** Bridson Poisson-disk sampling with symmetric variable-radius exclusion. Saturates the rectangle. */
function poissonDisk({ bounds: [x0, y0, x1, y1], radius, minRadius, maxRadius, seed, attempts = 24 }) {
	if (!(minRadius > 0 && maxRadius >= minRadius && x1 > x0 && y1 > y0)) throw new Error("Invalid Poisson bounds/radii");
	const rng = random(seed), cellSize = minRadius / Math.SQRT2;
	const grid = /* @__PURE__ */ new Map(), points = [], radii = [], active = [];
	const coords = (x, y) => [Math.floor((x - x0) / cellSize), Math.floor((y - y0) / cellSize)];
	const localRadius = (x, y) => Math.max(minRadius, Math.min(maxRadius, radius(x, y)));
	function insert(x, y, r) {
		const id = points.length, key = coords(x, y).join(",");
		points.push([x, y]);
		radii.push(r);
		active.push(id);
		const bucket = grid.get(key) ?? [];
		bucket.push(id);
		grid.set(key, bucket);
	}
	const sx = x0 + rng() * (x1 - x0), sy = y0 + rng() * (y1 - y0);
	insert(sx, sy, localRadius(sx, sy));
	while (active.length) {
		const index = Math.floor(rng() * active.length), id = active[index], p = points[id];
		let found = false;
		for (let k = 0; k < attempts; k++) {
			const angle = rng() * Math.PI * 2, distance = radii[id] * Math.sqrt(1 + rng() * 3);
			const x = p[0] + Math.cos(angle) * distance, y = p[1] + Math.sin(angle) * distance;
			if (x < x0 || x >= x1 || y < y0 || y >= y1) continue;
			const r = localRadius(x, y), [gx, gy] = coords(x, y), reach = Math.ceil(maxRadius / cellSize);
			let valid = true;
			for (let a = gx - reach; a <= gx + reach && valid; a++) for (let b = gy - reach; b <= gy + reach && valid; b++) for (const other of grid.get(`${a},${b}`) ?? []) if (Math.hypot(x - points[other][0], y - points[other][1]) < Math.max(r, radii[other])) {
				valid = false;
				break;
			}
			if (valid) {
				insert(x, y, r);
				found = true;
				break;
			}
		}
		if (!found) {
			active[index] = active[active.length - 1];
			active.pop();
		}
	}
	return points;
}
//#endregion
//#region node_modules/robust-predicates/esm/util.js
const epsilon$1 = 11102230246251565e-32;
const splitter = 134217729;
const resulterrbound = 3.000000000000001 * epsilon$1;
function sum(elen, e, flen, f, h) {
	let Q, Qnew, hh, bvirt;
	let enow = e[0];
	let fnow = f[0];
	let eindex = 0;
	let findex = 0;
	if (fnow > enow === fnow > -enow) {
		Q = enow;
		enow = e[++eindex];
	} else {
		Q = fnow;
		fnow = f[++findex];
	}
	let hindex = 0;
	if (eindex < elen && findex < flen) {
		if (fnow > enow === fnow > -enow) {
			Qnew = enow + Q;
			hh = Q - (Qnew - enow);
			enow = e[++eindex];
		} else {
			Qnew = fnow + Q;
			hh = Q - (Qnew - fnow);
			fnow = f[++findex];
		}
		Q = Qnew;
		if (hh !== 0) h[hindex++] = hh;
		while (eindex < elen && findex < flen) {
			if (fnow > enow === fnow > -enow) {
				Qnew = Q + enow;
				bvirt = Qnew - Q;
				hh = Q - (Qnew - bvirt) + (enow - bvirt);
				enow = e[++eindex];
			} else {
				Qnew = Q + fnow;
				bvirt = Qnew - Q;
				hh = Q - (Qnew - bvirt) + (fnow - bvirt);
				fnow = f[++findex];
			}
			Q = Qnew;
			if (hh !== 0) h[hindex++] = hh;
		}
	}
	while (eindex < elen) {
		Qnew = Q + enow;
		bvirt = Qnew - Q;
		hh = Q - (Qnew - bvirt) + (enow - bvirt);
		enow = e[++eindex];
		Q = Qnew;
		if (hh !== 0) h[hindex++] = hh;
	}
	while (findex < flen) {
		Qnew = Q + fnow;
		bvirt = Qnew - Q;
		hh = Q - (Qnew - bvirt) + (fnow - bvirt);
		fnow = f[++findex];
		Q = Qnew;
		if (hh !== 0) h[hindex++] = hh;
	}
	if (Q !== 0 || hindex === 0) h[hindex++] = Q;
	return hindex;
}
function estimate(elen, e) {
	let Q = e[0];
	for (let i = 1; i < elen; i++) Q += e[i];
	return Q;
}
function vec(n) {
	return new Float64Array(n);
}
//#endregion
//#region node_modules/robust-predicates/esm/orient2d.js
const ccwerrboundA = 3.0000000000000018 * epsilon$1;
const ccwerrboundB = 2.0000000000000013 * epsilon$1;
const ccwerrboundC = 9.000000000000007 * epsilon$1 * epsilon$1;
const B = vec(4);
const C1 = vec(8);
const C2 = vec(12);
const D = vec(16);
const u$2 = vec(4);
function orient2dadapt(ax, ay, bx, by, cx, cy, detsum) {
	let acxtail, acytail, bcxtail, bcytail;
	let bvirt, c, ahi, alo, bhi, blo, _i, _j, _0, s1, s0, t1, t0, u3;
	const acx = ax - cx;
	const bcx = bx - cx;
	const acy = ay - cy;
	const bcy = by - cy;
	s1 = acx * bcy;
	c = splitter * acx;
	ahi = c - (c - acx);
	alo = acx - ahi;
	c = splitter * bcy;
	bhi = c - (c - bcy);
	blo = bcy - bhi;
	s0 = alo * blo - (s1 - ahi * bhi - alo * bhi - ahi * blo);
	t1 = acy * bcx;
	c = splitter * acy;
	ahi = c - (c - acy);
	alo = acy - ahi;
	c = splitter * bcx;
	bhi = c - (c - bcx);
	blo = bcx - bhi;
	t0 = alo * blo - (t1 - ahi * bhi - alo * bhi - ahi * blo);
	_i = s0 - t0;
	bvirt = s0 - _i;
	B[0] = s0 - (_i + bvirt) + (bvirt - t0);
	_j = s1 + _i;
	bvirt = _j - s1;
	_0 = s1 - (_j - bvirt) + (_i - bvirt);
	_i = _0 - t1;
	bvirt = _0 - _i;
	B[1] = _0 - (_i + bvirt) + (bvirt - t1);
	u3 = _j + _i;
	bvirt = u3 - _j;
	B[2] = _j - (u3 - bvirt) + (_i - bvirt);
	B[3] = u3;
	let det = estimate(4, B);
	let errbound = ccwerrboundB * detsum;
	if (det >= errbound || -det >= errbound) return det;
	bvirt = ax - acx;
	acxtail = ax - (acx + bvirt) + (bvirt - cx);
	bvirt = bx - bcx;
	bcxtail = bx - (bcx + bvirt) + (bvirt - cx);
	bvirt = ay - acy;
	acytail = ay - (acy + bvirt) + (bvirt - cy);
	bvirt = by - bcy;
	bcytail = by - (bcy + bvirt) + (bvirt - cy);
	if (acxtail === 0 && acytail === 0 && bcxtail === 0 && bcytail === 0) return det;
	errbound = ccwerrboundC * detsum + resulterrbound * Math.abs(det);
	det += acx * bcytail + bcy * acxtail - (acy * bcxtail + bcx * acytail);
	if (det >= errbound || -det >= errbound) return det;
	s1 = acxtail * bcy;
	c = splitter * acxtail;
	ahi = c - (c - acxtail);
	alo = acxtail - ahi;
	c = splitter * bcy;
	bhi = c - (c - bcy);
	blo = bcy - bhi;
	s0 = alo * blo - (s1 - ahi * bhi - alo * bhi - ahi * blo);
	t1 = acytail * bcx;
	c = splitter * acytail;
	ahi = c - (c - acytail);
	alo = acytail - ahi;
	c = splitter * bcx;
	bhi = c - (c - bcx);
	blo = bcx - bhi;
	t0 = alo * blo - (t1 - ahi * bhi - alo * bhi - ahi * blo);
	_i = s0 - t0;
	bvirt = s0 - _i;
	u$2[0] = s0 - (_i + bvirt) + (bvirt - t0);
	_j = s1 + _i;
	bvirt = _j - s1;
	_0 = s1 - (_j - bvirt) + (_i - bvirt);
	_i = _0 - t1;
	bvirt = _0 - _i;
	u$2[1] = _0 - (_i + bvirt) + (bvirt - t1);
	u3 = _j + _i;
	bvirt = u3 - _j;
	u$2[2] = _j - (u3 - bvirt) + (_i - bvirt);
	u$2[3] = u3;
	const C1len = sum(4, B, 4, u$2, C1);
	s1 = acx * bcytail;
	c = splitter * acx;
	ahi = c - (c - acx);
	alo = acx - ahi;
	c = splitter * bcytail;
	bhi = c - (c - bcytail);
	blo = bcytail - bhi;
	s0 = alo * blo - (s1 - ahi * bhi - alo * bhi - ahi * blo);
	t1 = acy * bcxtail;
	c = splitter * acy;
	ahi = c - (c - acy);
	alo = acy - ahi;
	c = splitter * bcxtail;
	bhi = c - (c - bcxtail);
	blo = bcxtail - bhi;
	t0 = alo * blo - (t1 - ahi * bhi - alo * bhi - ahi * blo);
	_i = s0 - t0;
	bvirt = s0 - _i;
	u$2[0] = s0 - (_i + bvirt) + (bvirt - t0);
	_j = s1 + _i;
	bvirt = _j - s1;
	_0 = s1 - (_j - bvirt) + (_i - bvirt);
	_i = _0 - t1;
	bvirt = _0 - _i;
	u$2[1] = _0 - (_i + bvirt) + (bvirt - t1);
	u3 = _j + _i;
	bvirt = u3 - _j;
	u$2[2] = _j - (u3 - bvirt) + (_i - bvirt);
	u$2[3] = u3;
	const C2len = sum(C1len, C1, 4, u$2, C2);
	s1 = acxtail * bcytail;
	c = splitter * acxtail;
	ahi = c - (c - acxtail);
	alo = acxtail - ahi;
	c = splitter * bcytail;
	bhi = c - (c - bcytail);
	blo = bcytail - bhi;
	s0 = alo * blo - (s1 - ahi * bhi - alo * bhi - ahi * blo);
	t1 = acytail * bcxtail;
	c = splitter * acytail;
	ahi = c - (c - acytail);
	alo = acytail - ahi;
	c = splitter * bcxtail;
	bhi = c - (c - bcxtail);
	blo = bcxtail - bhi;
	t0 = alo * blo - (t1 - ahi * bhi - alo * bhi - ahi * blo);
	_i = s0 - t0;
	bvirt = s0 - _i;
	u$2[0] = s0 - (_i + bvirt) + (bvirt - t0);
	_j = s1 + _i;
	bvirt = _j - s1;
	_0 = s1 - (_j - bvirt) + (_i - bvirt);
	_i = _0 - t1;
	bvirt = _0 - _i;
	u$2[1] = _0 - (_i + bvirt) + (bvirt - t1);
	u3 = _j + _i;
	bvirt = u3 - _j;
	u$2[2] = _j - (u3 - bvirt) + (_i - bvirt);
	u$2[3] = u3;
	const Dlen = sum(C2len, C2, 4, u$2, D);
	return D[Dlen - 1];
}
function orient2d(ax, ay, bx, by, cx, cy) {
	const detleft = (ay - cy) * (bx - cx);
	const detright = (ax - cx) * (by - cy);
	const det = detleft - detright;
	const detsum = Math.abs(detleft + detright);
	if (Math.abs(det) >= ccwerrboundA * detsum) return det;
	return -orient2dadapt(ax, ay, bx, by, cx, cy, detsum);
}
vec(4);
vec(4);
vec(4);
vec(4);
vec(4);
vec(4);
vec(4);
vec(4);
vec(4);
vec(8);
vec(8);
vec(8);
vec(4);
vec(8);
vec(8);
vec(16);
vec(12);
vec(192);
vec(192);
vec(4);
vec(4);
vec(4);
vec(4);
vec(4);
vec(4);
vec(4);
vec(4);
vec(8);
vec(8);
vec(8);
vec(8);
vec(8);
vec(8);
vec(8);
vec(8);
vec(8);
vec(4);
vec(4);
vec(4);
vec(8);
vec(16);
vec(16);
vec(16);
vec(32);
vec(32);
vec(48);
vec(64);
vec(1152);
vec(1152);
vec(4);
vec(4);
vec(4);
vec(4);
vec(4);
vec(4);
vec(4);
vec(4);
vec(4);
vec(4);
vec(24);
vec(24);
vec(24);
vec(24);
vec(24);
vec(24);
vec(24);
vec(24);
vec(24);
vec(24);
vec(1152);
vec(1152);
vec(1152);
vec(1152);
vec(1152);
vec(2304);
vec(2304);
vec(3456);
vec(5760);
vec(8);
vec(8);
vec(8);
vec(16);
vec(24);
vec(48);
vec(48);
vec(96);
vec(192);
vec(384);
vec(384);
vec(384);
vec(768);
vec(96);
vec(96);
vec(96);
vec(1152);
//#endregion
//#region node_modules/delaunator/index.js
const EPSILON = Math.pow(2, -52);
const EDGE_STACK = /* @__PURE__ */ new Uint32Array(512);
/** @template {ArrayLike<number>} T */
var Delaunator = class Delaunator {
	/**
	* Constructs a delaunay triangulation object given an array of points (`[x, y]` by default).
	* `getX` and `getY` are optional functions of the form `(point) => value` for custom point formats.
	*
	* @template P
	* @param {P[]} points
	* @param {(p: P) => number} [getX]
	* @param {(p: P) => number} [getY]
	*/
	static from(points, getX = defaultGetX, getY = defaultGetY) {
		const n = points.length;
		const coords = new Float64Array(n * 2);
		for (let i = 0; i < n; i++) {
			const p = points[i];
			coords[2 * i] = getX(p);
			coords[2 * i + 1] = getY(p);
		}
		return new Delaunator(coords);
	}
	/**
	* Constructs a delaunay triangulation object given an array of point coordinates of the form:
	* `[x0, y0, x1, y1, ...]` (use a typed array for best performance). Duplicate points are skipped.
	*
	* @param {T} coords
	*/
	constructor(coords) {
		const n = coords.length >> 1;
		if (n > 0 && typeof coords[0] !== "number") throw new Error("Expected coords to contain numbers.");
		this.coords = coords;
		const maxTriangles = Math.max(2 * n - 5, 0);
		/** @private */ this._triangles = new Uint32Array(maxTriangles * 3);
		/** @private */ this._halfedges = new Int32Array(maxTriangles * 3);
		/** @private */ this._hashSize = Math.ceil(Math.sqrt(n));
		/** @private */ this._hullPrev = new Uint32Array(n);
		/** @private */ this._hullNext = new Uint32Array(n);
		/** @private */ this._hullTri = new Uint32Array(n);
		/** @private */ this._hullHash = new Int32Array(this._hashSize);
		/** @private */ this._ids = new Uint32Array(n);
		/** @private */ this._dists = new Float64Array(n);
		/** @private */ this.trianglesLen = 0;
		/** @private */ this._cx = 0;
		/** @private */ this._cy = 0;
		/** @private */ this._hullStart = 0;
		/** A `Uint32Array` array of indices that reference points on the convex hull of the input data, counter-clockwise. */
		this.hull = this._triangles;
		/** A `Uint32Array` array of triangle vertex indices (each group of three numbers forms a triangle). All triangles are directed counterclockwise. */
		this.triangles = this._triangles;
		/**
		* A `Int32Array` array of triangle half-edge indices that allows you to traverse the triangulation.
		* `i`-th half-edge in the array corresponds to vertex `triangles[i]` the half-edge is coming from.
		* `halfedges[i]` is the index of a twin half-edge in an adjacent triangle (or `-1` for outer half-edges on the convex hull).
		*/
		this.halfedges = this._halfedges;
		this.update();
	}
	/**
	* Updates the triangulation if you modified `delaunay.coords` values in place, avoiding expensive memory allocations.
	* Useful for iterative relaxation algorithms such as Lloyd's.
	*/
	update() {
		const { coords, _hullPrev: hullPrev, _hullNext: hullNext, _hullTri: hullTri, _hullHash: hullHash } = this;
		const n = coords.length >> 1;
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		for (let i = 0; i < n; i++) {
			const x = coords[2 * i];
			const y = coords[2 * i + 1];
			if (x < minX) minX = x;
			if (y < minY) minY = y;
			if (x > maxX) maxX = x;
			if (y > maxY) maxY = y;
			this._ids[i] = i;
		}
		const cx = (minX + maxX) / 2;
		const cy = (minY + maxY) / 2;
		let i0 = 0, i1 = 0, i2 = 0;
		for (let i = 0, minDist = Infinity; i < n; i++) {
			const d = dist(cx, cy, coords[2 * i], coords[2 * i + 1]);
			if (d < minDist) {
				i0 = i;
				minDist = d;
			}
		}
		const i0x = coords[2 * i0];
		const i0y = coords[2 * i0 + 1];
		for (let i = 0, minDist = Infinity; i < n; i++) {
			if (i === i0) continue;
			const d = dist(i0x, i0y, coords[2 * i], coords[2 * i + 1]);
			if (d < minDist && d > 0) {
				i1 = i;
				minDist = d;
			}
		}
		let i1x = coords[2 * i1];
		let i1y = coords[2 * i1 + 1];
		let minRadius = Infinity;
		for (let i = 0; i < n; i++) {
			if (i === i0 || i === i1) continue;
			const r = circumradius(i0x, i0y, i1x, i1y, coords[2 * i], coords[2 * i + 1]);
			if (r < minRadius) {
				i2 = i;
				minRadius = r;
			}
		}
		let i2x = coords[2 * i2];
		let i2y = coords[2 * i2 + 1];
		if (minRadius === Infinity) {
			for (let i = 0; i < n; i++) this._dists[i] = coords[2 * i] - coords[0] || coords[2 * i + 1] - coords[1];
			quicksort(this._ids, this._dists, 0, n - 1);
			const hull = new Uint32Array(n);
			let j = 0;
			for (let i = 0, d0 = -Infinity; i < n; i++) {
				const id = this._ids[i];
				const d = this._dists[id];
				if (d > d0) {
					hull[j++] = id;
					d0 = d;
				}
			}
			this.hull = hull.subarray(0, j);
			this.triangles = /* @__PURE__ */ new Uint32Array(0);
			this.halfedges = /* @__PURE__ */ new Int32Array(0);
			return;
		}
		if (orient2d(i0x, i0y, i1x, i1y, i2x, i2y) < 0) {
			const i = i1;
			const x = i1x;
			const y = i1y;
			i1 = i2;
			i1x = i2x;
			i1y = i2y;
			i2 = i;
			i2x = x;
			i2y = y;
		}
		const center = circumcenter(i0x, i0y, i1x, i1y, i2x, i2y);
		this._cx = center.x;
		this._cy = center.y;
		for (let i = 0; i < n; i++) this._dists[i] = dist(coords[2 * i], coords[2 * i + 1], center.x, center.y);
		quicksort(this._ids, this._dists, 0, n - 1);
		this._hullStart = i0;
		let hullSize = 3;
		hullNext[i0] = hullPrev[i2] = i1;
		hullNext[i1] = hullPrev[i0] = i2;
		hullNext[i2] = hullPrev[i1] = i0;
		hullTri[i0] = 0;
		hullTri[i1] = 1;
		hullTri[i2] = 2;
		hullHash.fill(-1);
		hullHash[this._hashKey(i0x, i0y)] = i0;
		hullHash[this._hashKey(i1x, i1y)] = i1;
		hullHash[this._hashKey(i2x, i2y)] = i2;
		this.trianglesLen = 0;
		this._addTriangle(i0, i1, i2, -1, -1, -1);
		for (let k = 0, xp = 0, yp = 0; k < this._ids.length; k++) {
			const i = this._ids[k];
			const x = coords[2 * i];
			const y = coords[2 * i + 1];
			if (k > 0 && Math.abs(x - xp) <= EPSILON && Math.abs(y - yp) <= EPSILON) continue;
			xp = x;
			yp = y;
			if (i === i0 || i === i1 || i === i2) continue;
			let start = 0;
			for (let j = 0, key = this._hashKey(x, y); j < this._hashSize; j++) {
				start = hullHash[(key + j) % this._hashSize];
				if (start !== -1 && start !== hullNext[start]) break;
			}
			start = hullPrev[start];
			let e = start, q;
			while (q = hullNext[e], orient2d(x, y, coords[2 * e], coords[2 * e + 1], coords[2 * q], coords[2 * q + 1]) >= 0) {
				e = q;
				if (e === start) {
					e = -1;
					break;
				}
			}
			if (e === -1) continue;
			let t = this._addTriangle(e, i, hullNext[e], -1, -1, hullTri[e]);
			hullTri[i] = this._legalize(t + 2);
			hullTri[e] = t;
			hullSize++;
			let n = hullNext[e];
			while (q = hullNext[n], orient2d(x, y, coords[2 * n], coords[2 * n + 1], coords[2 * q], coords[2 * q + 1]) < 0) {
				t = this._addTriangle(n, i, q, hullTri[i], -1, hullTri[n]);
				hullTri[i] = this._legalize(t + 2);
				hullNext[n] = n;
				hullSize--;
				n = q;
			}
			if (e === start) while (q = hullPrev[e], orient2d(x, y, coords[2 * q], coords[2 * q + 1], coords[2 * e], coords[2 * e + 1]) < 0) {
				t = this._addTriangle(q, i, e, -1, hullTri[e], hullTri[q]);
				this._legalize(t + 2);
				hullTri[q] = t;
				hullNext[e] = e;
				hullSize--;
				e = q;
			}
			this._hullStart = hullPrev[i] = e;
			hullNext[e] = hullPrev[n] = i;
			hullNext[i] = n;
			hullHash[this._hashKey(x, y)] = i;
			hullHash[this._hashKey(coords[2 * e], coords[2 * e + 1])] = e;
		}
		this.hull = new Uint32Array(hullSize);
		for (let i = 0, e = this._hullStart; i < hullSize; i++) {
			this.hull[i] = e;
			e = hullNext[e];
		}
		this.triangles = this._triangles.subarray(0, this.trianglesLen);
		this.halfedges = this._halfedges.subarray(0, this.trianglesLen);
	}
	/**
	* Calculate an angle-based key for the edge hash used for advancing convex hull.
	*
	* @param {number} x
	* @param {number} y
	* @private
	*/
	_hashKey(x, y) {
		return Math.floor(pseudoAngle(x - this._cx, y - this._cy) * this._hashSize) % this._hashSize;
	}
	/**
	* Flip an edge in a pair of triangles if it doesn't satisfy the Delaunay condition.
	*
	* @param {number} a
	* @private
	*/
	_legalize(a) {
		const { _triangles: triangles, _halfedges: halfedges, coords } = this;
		let i = 0;
		let ar = 0;
		while (true) {
			const b = halfedges[a];
			const a0 = a - a % 3;
			ar = a0 + (a + 2) % 3;
			if (b === -1) {
				if (i === 0) break;
				a = EDGE_STACK[--i];
				continue;
			}
			const b0 = b - b % 3;
			const al = a0 + (a + 1) % 3;
			const bl = b0 + (b + 2) % 3;
			const p0 = triangles[ar];
			const pr = triangles[a];
			const pl = triangles[al];
			const p1 = triangles[bl];
			if (inCircle(coords[2 * p0], coords[2 * p0 + 1], coords[2 * pr], coords[2 * pr + 1], coords[2 * pl], coords[2 * pl + 1], coords[2 * p1], coords[2 * p1 + 1])) {
				triangles[a] = p1;
				triangles[b] = p0;
				const hbl = halfedges[bl];
				if (hbl === -1) {
					let e = this._hullStart;
					do {
						if (this._hullTri[e] === bl) {
							this._hullTri[e] = a;
							break;
						}
						e = this._hullPrev[e];
					} while (e !== this._hullStart);
				}
				this._link(a, hbl);
				this._link(b, halfedges[ar]);
				this._link(ar, bl);
				const br = b0 + (b + 1) % 3;
				if (i < EDGE_STACK.length) EDGE_STACK[i++] = br;
			} else {
				if (i === 0) break;
				a = EDGE_STACK[--i];
			}
		}
		return ar;
	}
	/**
	* Link two half-edges to each other.
	* @param {number} a
	* @param {number} b
	* @private
	*/
	_link(a, b) {
		this._halfedges[a] = b;
		if (b !== -1) this._halfedges[b] = a;
	}
	/**
	* Add a new triangle given vertex indices and adjacent half-edge ids.
	*
	* @param {number} i0
	* @param {number} i1
	* @param {number} i2
	* @param {number} a
	* @param {number} b
	* @param {number} c
	* @private
	*/
	_addTriangle(i0, i1, i2, a, b, c) {
		const t = this.trianglesLen;
		this._triangles[t] = i0;
		this._triangles[t + 1] = i1;
		this._triangles[t + 2] = i2;
		this._link(t, a);
		this._link(t + 1, b);
		this._link(t + 2, c);
		this.trianglesLen += 3;
		return t;
	}
};
/**
* Monotonically increases with real angle, but doesn't need expensive trigonometry.
*
* @param {number} dx
* @param {number} dy
*/
function pseudoAngle(dx, dy) {
	const p = dx / (Math.abs(dx) + Math.abs(dy));
	return (dy > 0 ? 3 - p : 1 + p) / 4;
}
/**
* Squared distance between two points.
*
* @param {number} ax
* @param {number} ay
* @param {number} bx
* @param {number} by
*/
function dist(ax, ay, bx, by) {
	const dx = ax - bx;
	const dy = ay - by;
	return dx * dx + dy * dy;
}
/**
* Check whether point P is inside a circle formed by points A, B, C.
*
* @param {number} ax
* @param {number} ay
* @param {number} bx
* @param {number} by
* @param {number} cx
* @param {number} cy
* @param {number} px
* @param {number} py
*/
function inCircle(ax, ay, bx, by, cx, cy, px, py) {
	const dx = ax - px;
	const dy = ay - py;
	const ex = bx - px;
	const ey = by - py;
	const fx = cx - px;
	const fy = cy - py;
	const ap = dx * dx + dy * dy;
	const bp = ex * ex + ey * ey;
	const cp = fx * fx + fy * fy;
	return dx * (ey * cp - bp * fy) - dy * (ex * cp - bp * fx) + ap * (ex * fy - ey * fx) < 0;
}
/**
* Squared radius of the circle formed by points A, B, C.
*
* @param {number} ax
* @param {number} ay
* @param {number} bx
* @param {number} by
* @param {number} cx
* @param {number} cy
*/
function circumradius(ax, ay, bx, by, cx, cy) {
	const dx = bx - ax;
	const dy = by - ay;
	const ex = cx - ax;
	const ey = cy - ay;
	const bl = dx * dx + dy * dy;
	const cl = ex * ex + ey * ey;
	const d = .5 / (dx * ey - dy * ex);
	const x = (ey * bl - dy * cl) * d;
	const y = (dx * cl - ex * bl) * d;
	return x * x + y * y;
}
/**
* Get coordinates of a circumcenter for points A, B, C.
*
* @param {number} ax
* @param {number} ay
* @param {number} bx
* @param {number} by
* @param {number} cx
* @param {number} cy
*/
function circumcenter(ax, ay, bx, by, cx, cy) {
	const dx = bx - ax;
	const dy = by - ay;
	const ex = cx - ax;
	const ey = cy - ay;
	const bl = dx * dx + dy * dy;
	const cl = ex * ex + ey * ey;
	const d = .5 / (dx * ey - dy * ex);
	return {
		x: ax + (ey * bl - dy * cl) * d,
		y: ay + (dx * cl - ex * bl) * d
	};
}
/**
* Sort points by distance via an array of point indices and an array of calculated distances.
*
* @param {Uint32Array} ids
* @param {Float64Array} dists
* @param {number} left
* @param {number} right
*/
function quicksort(ids, dists, left, right) {
	if (right - left <= 20) for (let i = left + 1; i <= right; i++) {
		const temp = ids[i];
		const tempDist = dists[temp];
		let j = i - 1;
		while (j >= left && dists[ids[j]] > tempDist) ids[j + 1] = ids[j--];
		ids[j + 1] = temp;
	}
	else {
		const median = left + right >> 1;
		let i = left + 1;
		let j = right;
		swap(ids, median, i);
		if (dists[ids[left]] > dists[ids[right]]) swap(ids, left, right);
		if (dists[ids[i]] > dists[ids[right]]) swap(ids, i, right);
		if (dists[ids[left]] > dists[ids[i]]) swap(ids, left, i);
		const temp = ids[i];
		const tempDist = dists[temp];
		while (true) {
			do
				i++;
			while (dists[ids[i]] < tempDist);
			do
				j--;
			while (dists[ids[j]] > tempDist);
			if (j < i) break;
			swap(ids, i, j);
		}
		ids[left + 1] = ids[j];
		ids[j] = temp;
		if (right - i + 1 >= j - left) {
			quicksort(ids, dists, i, right);
			quicksort(ids, dists, left, j - 1);
		} else {
			quicksort(ids, dists, left, j - 1);
			quicksort(ids, dists, i, right);
		}
	}
}
/**
* @param {Uint32Array} arr
* @param {number} i
* @param {number} j
*/
function swap(arr, i, j) {
	const tmp = arr[i];
	arr[i] = arr[j];
	arr[j] = tmp;
}
/** @param {[number, number]} p */
function defaultGetX(p) {
	return p[0];
}
/** @param {[number, number]} p */
function defaultGetY(p) {
	return p[1];
}
//#endregion
//#region node_modules/d3-delaunay/src/path.js
const epsilon = 1e-6;
var Path = class {
	constructor() {
		this._x0 = this._y0 = this._x1 = this._y1 = null;
		this._ = "";
	}
	moveTo(x, y) {
		this._ += `M${this._x0 = this._x1 = +x},${this._y0 = this._y1 = +y}`;
	}
	closePath() {
		if (this._x1 !== null) {
			this._x1 = this._x0, this._y1 = this._y0;
			this._ += "Z";
		}
	}
	lineTo(x, y) {
		this._ += `L${this._x1 = +x},${this._y1 = +y}`;
	}
	arc(x, y, r) {
		x = +x, y = +y, r = +r;
		const x0 = x + r;
		const y0 = y;
		if (r < 0) throw new Error("negative radius");
		if (this._x1 === null) this._ += `M${x0},${y0}`;
		else if (Math.abs(this._x1 - x0) > epsilon || Math.abs(this._y1 - y0) > epsilon) this._ += "L" + x0 + "," + y0;
		if (!r) return;
		this._ += `A${r},${r},0,1,1,${x - r},${y}A${r},${r},0,1,1,${this._x1 = x0},${this._y1 = y0}`;
	}
	rect(x, y, w, h) {
		this._ += `M${this._x0 = this._x1 = +x},${this._y0 = this._y1 = +y}h${+w}v${+h}h${-w}Z`;
	}
	value() {
		return this._ || null;
	}
};
//#endregion
//#region node_modules/d3-delaunay/src/polygon.js
var Polygon = class {
	constructor() {
		this._ = [];
	}
	moveTo(x, y) {
		this._.push([x, y]);
	}
	closePath() {
		this._.push(this._[0].slice());
	}
	lineTo(x, y) {
		this._.push([x, y]);
	}
	value() {
		return this._.length ? this._ : null;
	}
};
//#endregion
//#region node_modules/d3-delaunay/src/voronoi.js
var Voronoi = class {
	constructor(delaunay, [xmin, ymin, xmax, ymax] = [
		0,
		0,
		960,
		500
	]) {
		if (!((xmax = +xmax) >= (xmin = +xmin)) || !((ymax = +ymax) >= (ymin = +ymin))) throw new Error("invalid bounds");
		this.delaunay = delaunay;
		this._circumcenters = new Float64Array(delaunay.points.length * 2);
		this.vectors = new Float64Array(delaunay.points.length * 2);
		this.xmax = xmax, this.xmin = xmin;
		this.ymax = ymax, this.ymin = ymin;
		this._init();
	}
	update() {
		this.delaunay.update();
		this._init();
		return this;
	}
	_init() {
		const { delaunay: { points, hull, triangles }, vectors } = this;
		let bx, by;
		const circumcenters = this.circumcenters = this._circumcenters.subarray(0, triangles.length / 3 * 2);
		for (let i = 0, j = 0, n = triangles.length, x, y; i < n; i += 3, j += 2) {
			const t1 = triangles[i] * 2;
			const t2 = triangles[i + 1] * 2;
			const t3 = triangles[i + 2] * 2;
			const x1 = points[t1];
			const y1 = points[t1 + 1];
			const x2 = points[t2];
			const y2 = points[t2 + 1];
			const x3 = points[t3];
			const y3 = points[t3 + 1];
			const dx = x2 - x1;
			const dy = y2 - y1;
			const ex = x3 - x1;
			const ey = y3 - y1;
			const ab = (dx * ey - dy * ex) * 2;
			if (Math.abs(ab) < 1e-9) {
				if (bx === void 0) {
					bx = by = 0;
					for (const i of hull) bx += points[i * 2], by += points[i * 2 + 1];
					bx /= hull.length, by /= hull.length;
				}
				const a = 1e9 * Math.sign((bx - x1) * ey - (by - y1) * ex);
				x = (x1 + x3) / 2 - a * ey;
				y = (y1 + y3) / 2 + a * ex;
			} else {
				const d = 1 / ab;
				const bl = dx * dx + dy * dy;
				const cl = ex * ex + ey * ey;
				x = x1 + (ey * bl - dy * cl) * d;
				y = y1 + (dx * cl - ex * bl) * d;
			}
			circumcenters[j] = x;
			circumcenters[j + 1] = y;
		}
		let h = hull[hull.length - 1];
		let p0, p1 = h * 4;
		let x0, x1 = points[2 * h];
		let y0, y1 = points[2 * h + 1];
		vectors.fill(0);
		for (let i = 0; i < hull.length; ++i) {
			h = hull[i];
			p0 = p1, x0 = x1, y0 = y1;
			p1 = h * 4, x1 = points[2 * h], y1 = points[2 * h + 1];
			vectors[p0 + 2] = vectors[p1] = y0 - y1;
			vectors[p0 + 3] = vectors[p1 + 1] = x1 - x0;
		}
	}
	render(context) {
		const buffer = context == null ? context = new Path() : void 0;
		const { delaunay: { halfedges, inedges, hull }, circumcenters, vectors } = this;
		if (hull.length <= 1) return null;
		for (let i = 0, n = halfedges.length; i < n; ++i) {
			const j = halfedges[i];
			if (j < i) continue;
			const ti = Math.floor(i / 3) * 2;
			const tj = Math.floor(j / 3) * 2;
			const xi = circumcenters[ti];
			const yi = circumcenters[ti + 1];
			const xj = circumcenters[tj];
			const yj = circumcenters[tj + 1];
			this._renderSegment(xi, yi, xj, yj, context);
		}
		let h0, h1 = hull[hull.length - 1];
		for (let i = 0; i < hull.length; ++i) {
			h0 = h1, h1 = hull[i];
			const t = Math.floor(inedges[h1] / 3) * 2;
			const x = circumcenters[t];
			const y = circumcenters[t + 1];
			const v = h0 * 4;
			const p = this._project(x, y, vectors[v + 2], vectors[v + 3]);
			if (p) this._renderSegment(x, y, p[0], p[1], context);
		}
		return buffer && buffer.value();
	}
	renderBounds(context) {
		const buffer = context == null ? context = new Path() : void 0;
		context.rect(this.xmin, this.ymin, this.xmax - this.xmin, this.ymax - this.ymin);
		return buffer && buffer.value();
	}
	renderCell(i, context) {
		const buffer = context == null ? context = new Path() : void 0;
		const points = this._clip(i);
		if (points === null || !points.length) return;
		context.moveTo(points[0], points[1]);
		let n = points.length;
		while (points[0] === points[n - 2] && points[1] === points[n - 1] && n > 1) n -= 2;
		for (let i = 2; i < n; i += 2) if (points[i] !== points[i - 2] || points[i + 1] !== points[i - 1]) context.lineTo(points[i], points[i + 1]);
		context.closePath();
		return buffer && buffer.value();
	}
	*cellPolygons() {
		const { delaunay: { points } } = this;
		for (let i = 0, n = points.length / 2; i < n; ++i) {
			const cell = this.cellPolygon(i);
			if (cell) cell.index = i, yield cell;
		}
	}
	cellPolygon(i) {
		const polygon = new Polygon();
		this.renderCell(i, polygon);
		return polygon.value();
	}
	_renderSegment(x0, y0, x1, y1, context) {
		let S;
		const c0 = this._regioncode(x0, y0);
		const c1 = this._regioncode(x1, y1);
		if (c0 === 0 && c1 === 0) {
			context.moveTo(x0, y0);
			context.lineTo(x1, y1);
		} else if (S = this._clipSegment(x0, y0, x1, y1, c0, c1)) {
			context.moveTo(S[0], S[1]);
			context.lineTo(S[2], S[3]);
		}
	}
	contains(i, x, y) {
		if ((x = +x, x !== x) || (y = +y, y !== y)) return false;
		return this.delaunay._step(i, x, y) === i;
	}
	*neighbors(i) {
		const ci = this._clip(i);
		if (ci) for (const j of this.delaunay.neighbors(i)) {
			const cj = this._clip(j);
			if (cj) {
				loop: for (let ai = 0, li = ci.length; ai < li; ai += 2) for (let aj = 0, lj = cj.length; aj < lj; aj += 2) if (ci[ai] === cj[aj] && ci[ai + 1] === cj[aj + 1] && ci[(ai + 2) % li] === cj[(aj + lj - 2) % lj] && ci[(ai + 3) % li] === cj[(aj + lj - 1) % lj]) {
					yield j;
					break loop;
				}
			}
		}
	}
	_cell(i) {
		const { circumcenters, delaunay: { inedges, halfedges, triangles } } = this;
		const e0 = inedges[i];
		if (e0 === -1) return null;
		const points = [];
		let e = e0;
		do {
			const t = Math.floor(e / 3);
			points.push(circumcenters[t * 2], circumcenters[t * 2 + 1]);
			e = e % 3 === 2 ? e - 2 : e + 1;
			if (triangles[e] !== i) break;
			e = halfedges[e];
		} while (e !== e0 && e !== -1);
		return points;
	}
	_clip(i) {
		if (i === 0 && this.delaunay.hull.length === 1) return [
			this.xmax,
			this.ymin,
			this.xmax,
			this.ymax,
			this.xmin,
			this.ymax,
			this.xmin,
			this.ymin
		];
		const points = this._cell(i);
		if (points === null) return null;
		const { vectors: V } = this;
		const v = i * 4;
		return this._simplify(V[v] || V[v + 1] ? this._clipInfinite(i, points, V[v], V[v + 1], V[v + 2], V[v + 3]) : this._clipFinite(i, points));
	}
	_clipFinite(i, points) {
		const n = points.length;
		let P = null;
		let x0, y0, x1 = points[n - 2], y1 = points[n - 1];
		let c0, c1 = this._regioncode(x1, y1);
		let e0, e1 = 0;
		for (let j = 0; j < n; j += 2) {
			x0 = x1, y0 = y1, x1 = points[j], y1 = points[j + 1];
			c0 = c1, c1 = this._regioncode(x1, y1);
			if (c0 === 0 && c1 === 0) {
				e0 = e1, e1 = 0;
				if (P) P.push(x1, y1);
				else P = [x1, y1];
			} else {
				let S, sx0, sy0, sx1, sy1;
				if (c0 === 0) {
					if ((S = this._clipSegment(x0, y0, x1, y1, c0, c1)) === null) continue;
					[sx0, sy0, sx1, sy1] = S;
				} else {
					if ((S = this._clipSegment(x1, y1, x0, y0, c1, c0)) === null) continue;
					[sx1, sy1, sx0, sy0] = S;
					e0 = e1, e1 = this._edgecode(sx0, sy0);
					if (e0 && e1) this._edge(i, e0, e1, P, P.length);
					if (P) P.push(sx0, sy0);
					else P = [sx0, sy0];
				}
				e0 = e1, e1 = this._edgecode(sx1, sy1);
				if (e0 && e1) this._edge(i, e0, e1, P, P.length);
				if (P) P.push(sx1, sy1);
				else P = [sx1, sy1];
			}
		}
		if (P) {
			e0 = e1, e1 = this._edgecode(P[0], P[1]);
			if (e0 && e1) this._edge(i, e0, e1, P, P.length);
		} else if (this.contains(i, (this.xmin + this.xmax) / 2, (this.ymin + this.ymax) / 2)) return [
			this.xmax,
			this.ymin,
			this.xmax,
			this.ymax,
			this.xmin,
			this.ymax,
			this.xmin,
			this.ymin
		];
		return P;
	}
	_clipSegment(x0, y0, x1, y1, c0, c1) {
		const flip = c0 < c1;
		if (flip) [x0, y0, x1, y1, c0, c1] = [
			x1,
			y1,
			x0,
			y0,
			c1,
			c0
		];
		while (true) {
			if (c0 === 0 && c1 === 0) return flip ? [
				x1,
				y1,
				x0,
				y0
			] : [
				x0,
				y0,
				x1,
				y1
			];
			if (c0 & c1) return null;
			let x, y, c = c0 || c1;
			if (c & 8) x = x0 + (x1 - x0) * (this.ymax - y0) / (y1 - y0), y = this.ymax;
			else if (c & 4) x = x0 + (x1 - x0) * (this.ymin - y0) / (y1 - y0), y = this.ymin;
			else if (c & 2) y = y0 + (y1 - y0) * (this.xmax - x0) / (x1 - x0), x = this.xmax;
			else y = y0 + (y1 - y0) * (this.xmin - x0) / (x1 - x0), x = this.xmin;
			if (c0) x0 = x, y0 = y, c0 = this._regioncode(x0, y0);
			else x1 = x, y1 = y, c1 = this._regioncode(x1, y1);
		}
	}
	_clipInfinite(i, points, vx0, vy0, vxn, vyn) {
		let P = Array.from(points), p;
		if (p = this._project(P[0], P[1], vx0, vy0)) P.unshift(p[0], p[1]);
		if (p = this._project(P[P.length - 2], P[P.length - 1], vxn, vyn)) P.push(p[0], p[1]);
		if (P = this._clipFinite(i, P)) for (let j = 0, n = P.length, c0, c1 = this._edgecode(P[n - 2], P[n - 1]); j < n; j += 2) {
			c0 = c1, c1 = this._edgecode(P[j], P[j + 1]);
			if (c0 && c1) j = this._edge(i, c0, c1, P, j), n = P.length;
		}
		else if (this.contains(i, (this.xmin + this.xmax) / 2, (this.ymin + this.ymax) / 2)) P = [
			this.xmin,
			this.ymin,
			this.xmax,
			this.ymin,
			this.xmax,
			this.ymax,
			this.xmin,
			this.ymax
		];
		return P;
	}
	_edge(i, e0, e1, P, j) {
		while (e0 !== e1) {
			let x, y;
			switch (e0) {
				case 5:
					e0 = 4;
					continue;
				case 4:
					e0 = 6, x = this.xmax, y = this.ymin;
					break;
				case 6:
					e0 = 2;
					continue;
				case 2:
					e0 = 10, x = this.xmax, y = this.ymax;
					break;
				case 10:
					e0 = 8;
					continue;
				case 8:
					e0 = 9, x = this.xmin, y = this.ymax;
					break;
				case 9:
					e0 = 1;
					continue;
				case 1: e0 = 5, x = this.xmin, y = this.ymin;
			}
			if ((P[j] !== x || P[j + 1] !== y) && this.contains(i, x, y)) P.splice(j, 0, x, y), j += 2;
		}
		return j;
	}
	_project(x0, y0, vx, vy) {
		let t = Infinity, c, x, y;
		if (vy < 0) {
			if (y0 <= this.ymin) return null;
			if ((c = (this.ymin - y0) / vy) < t) y = this.ymin, x = x0 + (t = c) * vx;
		} else if (vy > 0) {
			if (y0 >= this.ymax) return null;
			if ((c = (this.ymax - y0) / vy) < t) y = this.ymax, x = x0 + (t = c) * vx;
		}
		if (vx > 0) {
			if (x0 >= this.xmax) return null;
			if ((c = (this.xmax - x0) / vx) < t) x = this.xmax, y = y0 + (t = c) * vy;
		} else if (vx < 0) {
			if (x0 <= this.xmin) return null;
			if ((c = (this.xmin - x0) / vx) < t) x = this.xmin, y = y0 + (t = c) * vy;
		}
		return [x, y];
	}
	_edgecode(x, y) {
		return (x === this.xmin ? 1 : x === this.xmax ? 2 : 0) | (y === this.ymin ? 4 : y === this.ymax ? 8 : 0);
	}
	_regioncode(x, y) {
		return (x < this.xmin ? 1 : x > this.xmax ? 2 : 0) | (y < this.ymin ? 4 : y > this.ymax ? 8 : 0);
	}
	_simplify(P) {
		if (P && P.length > 4) {
			for (let i = 0; i < P.length; i += 2) {
				const j = (i + 2) % P.length, k = (i + 4) % P.length;
				if (P[i] === P[j] && P[j] === P[k] || P[i + 1] === P[j + 1] && P[j + 1] === P[k + 1]) P.splice(j, 2), i -= 2;
			}
			if (!P.length) P = null;
		}
		return P;
	}
};
//#endregion
//#region node_modules/d3-delaunay/src/delaunay.js
const tau = 2 * Math.PI;
const pow = Math.pow;
function pointX(p) {
	return p[0];
}
function pointY(p) {
	return p[1];
}
function collinear(d) {
	const { triangles, coords } = d;
	for (let i = 0; i < triangles.length; i += 3) {
		const a = 2 * triangles[i], b = 2 * triangles[i + 1], c = 2 * triangles[i + 2];
		if ((coords[c] - coords[a]) * (coords[b + 1] - coords[a + 1]) - (coords[b] - coords[a]) * (coords[c + 1] - coords[a + 1]) > 1e-10) return false;
	}
	return true;
}
function jitter(x, y, r) {
	return [x + Math.sin(x + y) * r, y + Math.cos(x - y) * r];
}
var Delaunay = class Delaunay {
	static from(points, fx = pointX, fy = pointY, that) {
		return new Delaunay("length" in points ? flatArray(points, fx, fy, that) : Float64Array.from(flatIterable(points, fx, fy, that)));
	}
	constructor(points) {
		this._delaunator = new Delaunator(points);
		this.inedges = new Int32Array(points.length / 2);
		this._hullIndex = new Int32Array(points.length / 2);
		this.points = this._delaunator.coords;
		this._init();
	}
	update() {
		this._delaunator.update();
		this._init();
		return this;
	}
	_init() {
		const d = this._delaunator, points = this.points;
		if (d.hull && d.hull.length > 2 && collinear(d)) {
			this.collinear = Int32Array.from({ length: points.length / 2 }, (_, i) => i).sort((i, j) => points[2 * i] - points[2 * j] || points[2 * i + 1] - points[2 * j + 1]);
			const e = this.collinear[0], f = this.collinear[this.collinear.length - 1], bounds = [
				points[2 * e],
				points[2 * e + 1],
				points[2 * f],
				points[2 * f + 1]
			], r = 1e-8 * Math.hypot(bounds[3] - bounds[1], bounds[2] - bounds[0]);
			for (let i = 0, n = points.length / 2; i < n; ++i) {
				const p = jitter(points[2 * i], points[2 * i + 1], r);
				points[2 * i] = p[0];
				points[2 * i + 1] = p[1];
			}
			this._delaunator = new Delaunator(points);
		} else delete this.collinear;
		const halfedges = this.halfedges = this._delaunator.halfedges;
		const hull = this.hull = this._delaunator.hull;
		const triangles = this.triangles = this._delaunator.triangles;
		const inedges = this.inedges.fill(-1);
		const hullIndex = this._hullIndex.fill(-1);
		for (let e = 0, n = halfedges.length; e < n; ++e) {
			const p = triangles[e % 3 === 2 ? e - 2 : e + 1];
			if (halfedges[e] === -1 || inedges[p] === -1) inedges[p] = e;
		}
		for (let i = 0, n = hull.length; i < n; ++i) hullIndex[hull[i]] = i;
		if (hull.length <= 2 && hull.length > 0) {
			this.triangles = (/* @__PURE__ */ new Int32Array(3)).fill(-1);
			this.halfedges = (/* @__PURE__ */ new Int32Array(3)).fill(-1);
			this.triangles[0] = hull[0];
			inedges[hull[0]] = 1;
			if (hull.length === 2) {
				inedges[hull[1]] = 0;
				this.triangles[1] = hull[1];
				this.triangles[2] = hull[1];
			}
		}
	}
	voronoi(bounds) {
		return new Voronoi(this, bounds);
	}
	*neighbors(i) {
		const { inedges, hull, _hullIndex, halfedges, triangles, collinear } = this;
		if (collinear) {
			const l = collinear.indexOf(i);
			if (l > 0) yield collinear[l - 1];
			if (l < collinear.length - 1) yield collinear[l + 1];
			return;
		}
		const e0 = inedges[i];
		if (e0 === -1) return;
		let e = e0, p0 = -1;
		do {
			yield p0 = triangles[e];
			e = e % 3 === 2 ? e - 2 : e + 1;
			if (triangles[e] !== i) return;
			e = halfedges[e];
			if (e === -1) {
				const p = hull[(_hullIndex[i] + 1) % hull.length];
				if (p !== p0) yield p;
				return;
			}
		} while (e !== e0);
	}
	find(x, y, i = 0) {
		if ((x = +x, x !== x) || (y = +y, y !== y)) return -1;
		const i0 = i;
		let c;
		while ((c = this._step(i, x, y)) >= 0 && c !== i && c !== i0) i = c;
		return c;
	}
	_step(i, x, y) {
		const { inedges, hull, _hullIndex, halfedges, triangles, points } = this;
		if (inedges[i] === -1 || !points.length) return (i + 1) % (points.length >> 1);
		let c = i;
		let dc = pow(x - points[i * 2], 2) + pow(y - points[i * 2 + 1], 2);
		const e0 = inedges[i];
		let e = e0;
		do {
			let t = triangles[e];
			const dt = pow(x - points[t * 2], 2) + pow(y - points[t * 2 + 1], 2);
			if (dt < dc) dc = dt, c = t;
			e = e % 3 === 2 ? e - 2 : e + 1;
			if (triangles[e] !== i) break;
			e = halfedges[e];
			if (e === -1) {
				e = hull[(_hullIndex[i] + 1) % hull.length];
				if (e !== t) {
					if (pow(x - points[e * 2], 2) + pow(y - points[e * 2 + 1], 2) < dc) return e;
				}
				break;
			}
		} while (e !== e0);
		return c;
	}
	render(context) {
		const buffer = context == null ? context = new Path() : void 0;
		const { points, halfedges, triangles } = this;
		for (let i = 0, n = halfedges.length; i < n; ++i) {
			const j = halfedges[i];
			if (j < i) continue;
			const ti = triangles[i] * 2;
			const tj = triangles[j] * 2;
			context.moveTo(points[ti], points[ti + 1]);
			context.lineTo(points[tj], points[tj + 1]);
		}
		this.renderHull(context);
		return buffer && buffer.value();
	}
	renderPoints(context, r) {
		if (r === void 0 && (!context || typeof context.moveTo !== "function")) r = context, context = null;
		r = r == void 0 ? 2 : +r;
		const buffer = context == null ? context = new Path() : void 0;
		const { points } = this;
		for (let i = 0, n = points.length; i < n; i += 2) {
			const x = points[i], y = points[i + 1];
			context.moveTo(x + r, y);
			context.arc(x, y, r, 0, tau);
		}
		return buffer && buffer.value();
	}
	renderHull(context) {
		const buffer = context == null ? context = new Path() : void 0;
		const { hull, points } = this;
		const h = hull[0] * 2, n = hull.length;
		context.moveTo(points[h], points[h + 1]);
		for (let i = 1; i < n; ++i) {
			const h = 2 * hull[i];
			context.lineTo(points[h], points[h + 1]);
		}
		context.closePath();
		return buffer && buffer.value();
	}
	hullPolygon() {
		const polygon = new Polygon();
		this.renderHull(polygon);
		return polygon.value();
	}
	renderTriangle(i, context) {
		const buffer = context == null ? context = new Path() : void 0;
		const { points, triangles } = this;
		const t0 = triangles[i *= 3] * 2;
		const t1 = triangles[i + 1] * 2;
		const t2 = triangles[i + 2] * 2;
		context.moveTo(points[t0], points[t0 + 1]);
		context.lineTo(points[t1], points[t1 + 1]);
		context.lineTo(points[t2], points[t2 + 1]);
		context.closePath();
		return buffer && buffer.value();
	}
	*trianglePolygons() {
		const { triangles } = this;
		for (let i = 0, n = triangles.length / 3; i < n; ++i) yield this.trianglePolygon(i);
	}
	trianglePolygon(i) {
		const polygon = new Polygon();
		this.renderTriangle(i, polygon);
		return polygon.value();
	}
};
function flatArray(points, fx, fy, that) {
	const n = points.length;
	const array = new Float64Array(n * 2);
	for (let i = 0; i < n; ++i) {
		const p = points[i];
		array[i * 2] = fx.call(that, p, i, points);
		array[i * 2 + 1] = fy.call(that, p, i, points);
	}
	return array;
}
function* flatIterable(points, fx, fy, that) {
	let i = 0;
	for (const p of points) {
		yield fx.call(that, p, i, points);
		yield fy.call(that, p, i, points);
		++i;
	}
}
//#endregion
//#region src/lib/triangulate.ts
/** Triangulate local 2D points; topology retains the caller's point indices. */
function delaunayFrom(points) {
	return Delaunay.from(points);
}
//#endregion
//#region src/lib/terrain.ts
const smooth = (a, b, x) => {
	const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
	return t * t * (3 - 2 * t);
};
/** Flat-shaded Delaunay terrain; biome weights use the face-neighbour graph, not isolated normals. */
function generateTerrain({ level, size, count, seed, amplitude, mask, warp = 0, erosion = 0, island = false, carve = 0 }) {
	const rng = random(seed), noise = createNoise2D(seed), half = size / 2;
	const design = random(seed + 8101);
	const peakX = -1.05 + design() * .6, peakZ = -.7 + design() * .55;
	const ridgeX = .55 + design() * .8, ridgeZ = -.75 + design() * .8;
	const shelfWidth = 1.25 + design() * .55, ridgeHeight = 2.25 + design() * .36;
	const peakWidth = 1 + design() * .3, shelfX = .05 + design() * .65, shelfZ = .75 + design() * .4, ridgeLength = 1 + design() * .45;
	const field = (x, y, domainWarp = warp) => {
		const wx = x + domainWarp * size * noise(x / size * 1.3 + 31, y / size * 1.3 - 17), wy = y + domainWarp * size * noise(x / size * 1.3 - 12, y / size * 1.3 + 9);
		const detail = terrainHeight(wx, wy, {
			noise,
			amplitude,
			frequency: 1.5 / size
		});
		if (!island) return detail;
		const peak = 2.98 * Math.exp(-(Math.abs((x - peakX) / (x < peakX ? peakWidth * .8 : peakWidth)) ** 1.55 + Math.abs((y - peakZ) / 1.35) ** 1.7));
		const ridge = ridgeHeight * Math.exp(-(Math.abs((x - ridgeX) / ridgeLength) ** 2 + Math.abs((y - ridgeZ + (x - ridgeX) * .48) / .83) ** 2));
		const shelf = 2.1 * (1 - smooth(.62, 1.32, Math.hypot((x - shelfX) / shelfWidth, (y - shelfZ) / 1.42)));
		return Math.max(0, Math.max(peak, ridge, shelf) + (detail / amplitude - .38) * .34 + noise(wx * 1.45 + 4, wy * 1.45 - 6) * .075);
	};
	const e = size / 350;
	const slopeAt = (x, y) => Math.hypot(field(x + e, y) - field(x - e, y), field(x, y + e) - field(x, y - e)) / (2 * e);
	let points;
	if (level === 3) {
		const base = size / Math.sqrt(count) * 1.05;
		const radius = (x, y) => base / Math.sqrt(.65 + Math.min(2, slopeAt(x, y)) * 1.8);
		points = poissonDisk({
			bounds: [
				-half,
				-half,
				half,
				half
			],
			radius,
			minRadius: base / Math.sqrt(4.25),
			maxRadius: base / Math.sqrt(.65),
			seed
		});
	} else points = Array.from({ length: count }, () => [(rng() - .5) * size, (rng() - .5) * size]);
	const edges = Math.max(8, Math.ceil(Math.sqrt(count)));
	for (let i = 0; i < edges; i++) {
		const t = -half + size * i / edges;
		points.push([t, -half], [half, t], [-t, half], [-half, -t]);
	}
	const heights = Float32Array.from(points, ([x, y]) => {
		return (level === 1 ? rng() * amplitude : level === 2 ? (fbm(x * 2 / size, y * 2 / size, {
			noise,
			octaves: 5
		}) * .5 + .5) * amplitude : field(x, y)) * (mask?.(x, y) ?? 1);
	});
	const delaunay = delaunayFrom(points);
	const beforeThermal = Float32Array.from(heights);
	const unwarped = Float32Array.from(points, ([x, y]) => field(x, y, 0) * (mask?.(x, y) ?? 1));
	const neighbours = points.map((_, i) => [...delaunay.neighbors(i)]);
	for (let step = 0; step < erosion; step++) {
		const delta = new Float32Array(heights.length);
		for (let i = 0; i < heights.length; i++) {
			if (Math.abs(points[i][0]) >= half - 1e-6 || Math.abs(points[i][1]) >= half - 1e-6) continue;
			let best = -1, excess = 0;
			for (const j of neighbours[i]) {
				if (Math.abs(points[j][0]) >= half - 1e-6 || Math.abs(points[j][1]) >= half - 1e-6) continue;
				const d = Math.hypot(points[i][0] - points[j][0], points[i][1] - points[j][1]);
				const amount = heights[i] - heights[j] - .8 * d;
				if (amount > excess) {
					best = j;
					excess = amount;
				}
			}
			if (best >= 0) {
				const move = excess * .12;
				delta[i] -= move;
				delta[best] += move;
			}
		}
		heights.forEach((_, i) => heights[i] += delta[i]);
	}
	const afterThermal = Float32Array.from(heights), carved = new Float32Array(heights.length);
	const waterRng = random(seed + 42091), paths = [];
	const sources = heights.map((h, i) => h > amplitude * .42 ? i : -1).filter((i) => i >= 0);
	for (let drop = 0; drop < carve && sources.length; drop++) {
		let i = sources[Math.floor(waterRng() * sources.length)], sediment = 0;
		const path = [];
		for (let step = 0; step < 55; step++) {
			path.push(i);
			let next = -1, steepest = 0;
			for (const j of neighbours[i]) {
				const distance = Math.hypot(points[i][0] - points[j][0], points[i][1] - points[j][1]);
				const slope = (heights[i] - heights[j]) / Math.max(.01, distance);
				if (slope > steepest) {
					steepest = slope;
					next = j;
				}
			}
			if (next < 0 || heights[i] < .25) break;
			const cut = Math.min(.018, steepest * .013, Math.max(0, .24 - carved[i]));
			heights[i] -= cut;
			carved[i] += cut;
			sediment += cut;
			for (const j of neighbours[i]) if (heights[j] > heights[i] && carved[j] < .12) {
				const bank = Math.min(cut * .16, .12 - carved[j]);
				heights[j] -= bank;
				carved[j] += bank;
				sediment += bank;
			}
			i = next;
		}
		if (path.length >= 4) paths.push(path);
		if (Math.abs(points[i][0]) < half - 1e-6 && Math.abs(points[i][1]) < half - 1e-6) heights[i] += sediment * .12;
	}
	if (carve > 0) heights.forEach((_, i) => {
		const incision = carved[i] * .7 + neighbours[i].reduce((sum, j) => sum + carved[j], 0) / Math.max(1, neighbours[i].length) * .3;
		heights[i] = Math.max(0, afterThermal[i] - incision);
	});
	const visited = /* @__PURE__ */ new Set();
	let gullyCount = 0;
	for (let i = 0; i < carved.length; i++) if (carved[i] > .055 && !visited.has(i)) {
		const component = [], pending = [i];
		visited.add(i);
		while (pending.length) {
			const j = pending.pop();
			component.push(j);
			for (const k of neighbours[j]) if (carved[k] > .055 && !visited.has(k)) {
				visited.add(k);
				pending.push(k);
			}
		}
		const span = Math.max(...component.map((j) => afterThermal[j])) - Math.min(...component.map((j) => afterThermal[j]));
		if (component.length >= 8 && span > .25) gullyCount++;
	}
	const stats = (values) => ({
		min: Math.min(...values),
		max: Math.max(...values),
		mean: values.reduce((a, b) => a + b, 0) / values.length,
		rms: Math.sqrt(values.reduce((a, b) => a + b * b, 0) / values.length)
	});
	const difference = (a, b) => ({
		meanAbsolute: a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0) / a.length,
		maxAbsolute: Math.max(...a.map((v, i) => Math.abs(v - b[i]))),
		changed: a.filter((v, i) => Math.abs(v - b[i]) > 1e-6).length
	});
	const diagnostics = {
		unwarped: stats(unwarped),
		warped: stats(beforeThermal),
		thermal: stats(afterThermal),
		carved: stats(heights),
		warpChange: difference(beforeThermal, unwarped),
		thermalChange: difference(afterThermal, beforeThermal),
		carveChange: difference(heights, afterThermal),
		dropletPaths: paths.length,
		gullyCount,
		gullyVertices: carved.filter((v) => v > .055).length,
		maximumIncision: Math.max(...carved)
	};
	if (island) {
		const high = Math.max(...heights);
		heights.forEach((h, i) => heights[i] = h / high * 2.67);
		points.forEach((p) => p[1] *= 3.5 / 5.6);
		points.forEach((p, i) => {
			delaunay.points[i * 2] = p[0];
			delaunay.points[i * 2 + 1] = p[1];
		});
	}
	const faces = [];
	const a = new Vector3(), b = new Vector3(), c = new Vector3();
	for (let i = 0; i < delaunay.triangles.length; i += 3) {
		const ids = Array.from(delaunay.triangles.slice(i, i + 3));
		a.set(points[ids[1]][0] - points[ids[0]][0], heights[ids[1]] - heights[ids[0]], points[ids[1]][1] - points[ids[0]][1]);
		b.set(points[ids[2]][0] - points[ids[0]][0], heights[ids[2]] - heights[ids[0]], points[ids[2]][1] - points[ids[0]][1]);
		c.crossVectors(a, b).normalize();
		if (c.y < 0) ids.reverse();
		faces.push({
			ids,
			height: ids.reduce((s, j) => s + heights[j], 0) / 3,
			slope: 1 - Math.abs(c.y),
			x: ids.reduce((s, j) => s + points[j][0], 0) / 3,
			z: ids.reduce((s, j) => s + points[j][1], 0) / 3,
			adjacent: [
				0,
				1,
				2
			].map((j) => delaunay.halfedges[i + j]).filter((j) => j >= 0).map((j) => Math.floor(j / 3)),
			weights: [],
			biome: 0
		});
	}
	const cliffs = /* @__PURE__ */ new Set();
	if (island) faces.forEach((f, i) => {
		if (f.slope > .48) {
			cliffs.add(i);
			const bank = [...f.adjacent].sort((a, b) => faces[b].slope - faces[a].slope)[0];
			if (bank !== void 0) cliffs.add(bank);
		}
	});
	for (const [faceIndex, f] of faces.entries()) {
		const nearby = [f, ...f.adjacent.map((i) => faces[i])];
		const h = nearby.reduce((s, v) => s + v.height, 0) / nearby.length / (island ? 2.67 : amplitude);
		const slope = nearby.reduce((s, v) => s + v.slope, 0) / nearby.length;
		const boundary = noise(f.x / size * 2.1 + 13, f.z / size * 2.1 - 8) * .025;
		const snow = smooth(island ? .85 : .75, island ? .925 : .84, h + boundary * (island ? 1.65 : 1));
		const shore = island ? Math.max(1 - smooth(.12, .2, h), smooth(.67, .73, h) * (1 - smooth(.8, .83, h)) * (1 - smooth(.08, .2, slope))) : 1 - smooth(.14, .22, h + boundary);
		const rock = island ? smooth(.4, .57, slope + boundary) : Math.max(smooth(.24, .42, slope + boundary), smooth(.66, .83, h));
		f.weights = [
			shore * (1 - snow),
			(1 - shore) * (1 - rock) * (1 - snow),
			(1 - shore) * rock * (1 - snow),
			snow
		];
		if (cliffs.has(faceIndex)) f.weights = [
			0,
			0,
			1,
			0
		];
		f.biome = f.weights.indexOf(Math.max(...f.weights));
	}
	for (let pass = 0; pass < 4; pass++) {
		const labels = faces.map((f) => f.biome);
		faces.forEach((f, i) => {
			if (!cliffs.has(i) && f.adjacent.length === 3 && f.adjacent.every((j) => labels[j] !== f.biome)) {
				f.biome = [
					0,
					1,
					2,
					3
				].sort((a, b) => f.adjacent.filter((j) => labels[j] === b).length - f.adjacent.filter((j) => labels[j] === a).length)[0];
				f.weights = f.weights.map((v, i) => v * .15 + (i === f.biome ? .85 : 0));
			}
		});
	}
	const positions = [], biomes = [], slopes = [], weights = [];
	for (const [faceIndex, f] of faces.entries()) {
		const blend = cliffs.has(faceIndex) ? [
			0,
			0,
			1,
			0
		] : f.weights.map((w, k) => w * .8 + f.adjacent.reduce((s, j) => s + faces[j].weights[k], 0) / Math.max(1, f.adjacent.length) * .2);
		for (const id of f.ids) {
			positions.push(points[id][0], heights[id], points[id][1]);
			biomes.push(f.biome);
			slopes.push(f.slope);
			weights.push(...blend);
		}
	}
	const geometry = new BufferGeometry();
	geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
	const biome = new Float32Array(biomes);
	geometry.setAttribute("biome", new Float32BufferAttribute(biome, 1));
	geometry.setAttribute("biomeWeights", new Float32BufferAttribute(weights, 4));
	geometry.setAttribute("slope", new Float32BufferAttribute(slopes, 1));
	geometry.computeVertexNormals();
	geometry.computeBoundingSphere();
	return {
		geometry,
		seeds: new Float32Array(points.flat()),
		heights,
		delaunay,
		biome,
		faces,
		diagnostics
	};
}
function generateIslandTerrain(seed, options = {}) {
	const mask = (x, z) => Math.max(0, 1 - (Math.abs(x / 2.8) ** 4 + Math.abs(z / 2.8) ** 4)) ** .8;
	return generateTerrain({
		level: 3,
		size: 5.6,
		count: 1200,
		seed,
		amplitude: 3.1,
		mask,
		warp: .16,
		erosion: 8,
		carve: 420,
		island: true,
		...options
	});
}
//#endregion
export { generateIslandTerrain, generateTerrain };
