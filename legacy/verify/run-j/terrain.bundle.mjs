import { BufferGeometry, Float32BufferAttribute, Vector3 } from "three/webgpu";
import { createNoise2D } from "simplex-noise";
import { Delaunay } from "d3-delaunay";
//#region src/lib/random.ts
/** Deterministic LCG; each call returns a number in [0, 1). */
function random(seed = 1) {
	return () => {
		seed = Math.imul(1664525, seed) + 1013904223 | 0;
		return (seed >>> 0) / 4294967296;
	};
}
//#endregion
//#region src/lib/noise.ts
/** Seeded simplex field; pass it to the fractal helpers to share one landscape. */
function createNoise2D$1(seed) {
	return createNoise2D(random(seed));
}
var defaultNoise = createNoise2D$1(1);
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
//#region src/lib/triangulate.ts
/** Triangulate local 2D points; topology retains the caller's point indices. */
function delaunayFrom(points) {
	return Delaunay.from(points);
}
//#endregion
//#region src/lib/terrain.ts
var smooth = (a, b, x) => {
	const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
	return t * t * (3 - 2 * t);
};
/** Flat-shaded Delaunay terrain; biome weights use the face-neighbour graph, not isolated normals. */
function generateTerrain({ level, size, count, seed, amplitude, mask, warp = 0, erosion = 0, island = false }) {
	const rng = random(seed), noise = createNoise2D$1(seed), half = size / 2;
	const field = (x, y) => {
		return terrainHeight(x + warp * size * noise(x / size * 1.3 + 31, y / size * 1.3 - 17), y + warp * size * noise(x / size * 1.3 - 12, y / size * 1.3 + 9), {
			noise,
			amplitude,
			frequency: 1.5 / size
		});
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
		let h = level === 1 ? rng() * amplitude : level === 2 ? (fbm(x * 2 / size, y * 2 / size, {
			noise,
			octaves: 5
		}) * .5 + .5) * amplitude : field(x, y);
		if (island) {
			const bend = noise(x * .43 + 6, y * .43 - 3) * .38;
			const ridge = Math.exp(-((x / 2.05) ** 2 + ((y + x * .18 + bend) / 1.35) ** 2));
			h = h * .62 + ridge * 1.65;
		}
		return h * (mask?.(x, y) ?? 1);
	});
	const delaunay = delaunayFrom(points);
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
	if (island) {
		const high = Math.max(...heights);
		heights.forEach((h, i) => heights[i] = (h / high) ** 1.1 * 3.1);
		points.forEach((p) => p[1] *= 3.05 / 4.9);
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
	for (const f of faces) {
		const nearby = [f, ...f.adjacent.map((i) => faces[i])];
		const h = nearby.reduce((s, v) => s + v.height, 0) / nearby.length / (island ? 3.1 : amplitude);
		const slope = nearby.reduce((s, v) => s + v.slope, 0) / nearby.length;
		const boundary = noise(f.x / size * 2.1 + 13, f.z / size * 2.1 - 8) * .025;
		const snow = smooth(island ? .84 : .75, island ? .915 : .84, h + boundary);
		const shore = island ? Math.max(1 - smooth(.1, .17, h), smooth(.68, .72, h) * (1 - smooth(.75, .79, h)) * (1 - smooth(.1, .25, slope))) : 1 - smooth(.14, .22, h + boundary);
		const rock = Math.max(smooth(.24, .42, slope + boundary), smooth(.66, .83, h));
		f.weights = [
			shore * (1 - snow),
			(1 - shore) * (1 - rock) * (1 - snow),
			(1 - shore) * rock * (1 - snow),
			snow
		];
		f.biome = f.weights.indexOf(Math.max(...f.weights));
	}
	for (let pass = 0; pass < 2; pass++) {
		const labels = faces.map((f) => f.biome);
		faces.forEach((f) => {
			if (f.adjacent.length === 3 && f.adjacent.every((j) => labels[j] !== f.biome)) {
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
	for (const f of faces) {
		const blend = f.weights.map((w, k) => w * .8 + f.adjacent.reduce((s, j) => s + faces[j].weights[k], 0) / Math.max(1, f.adjacent.length) * .2);
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
		faces
	};
}
var ISLAND_SEED = 42;
function generateIslandTerrain(seed = 42) {
	const mask = (x, z) => Math.max(0, 1 - (Math.abs(x / 2.45) ** 4 + Math.abs(z / 2.45) ** 4)) ** .8;
	return generateTerrain({
		level: 3,
		size: 4.9,
		count: 1200,
		seed,
		amplitude: 3.6,
		mask,
		warp: .16,
		erosion: 8,
		island: true
	});
}
//#endregion
export { ISLAND_SEED, generateIslandTerrain, generateTerrain };
