/** @typedef {'square'|'tall'|'wide'|'any'} ShapeClue */

/**
 * @param {number} r0
 * @param {number} c0
 * @param {number} r1
 * @param {number} c1
 */
function rectArea(r0, c0, r1, c1) {
  return (r1 - r0) * (c1 - c0);
}

/** No single-cell patches: every patch has area ≥ 2. */
const MIN_PATCH_AREA = 2;

/**
 * @param {{ r0: number, c0: number, r1: number, c1: number }} R
 */
function hasValidSplit(R) {
  const h = R.r1 - R.r0;
  const w = R.c1 - R.c0;
  const rowNeed = Math.ceil(MIN_PATCH_AREA / w);
  if (h >= 2 * rowNeed) return true;
  const colNeed = Math.ceil(MIN_PATCH_AREA / h);
  if (w >= 2 * colNeed) return true;
  return false;
}

/**
 * Cells of R that lie on the outer rim of the n×n grid (easy “rim” deductions).
 * @param {{ r0: number; c0: number; r1: number; c1: number }} R
 */
function gridOuterBorderCellsInRect(R, n) {
  let cnt = 0;
  for (let r = R.r0; r < R.r1; r++) {
    for (let c = R.c0; c < R.c1; c++) {
      if (r === 0 || r === n - 1 || c === 0 || c === n - 1) cnt++;
    }
  }
  return cnt;
}

/**
 * @param {{ r0: number; c0: number; r1: number; c1: number }} R
 */
function rectBorderShare(R, n) {
  const a = rectArea(R.r0, R.c0, R.r1, R.c1);
  return a ? gridOuterBorderCellsInRect(R, n) / a : 0;
}

/**
 * @param {{ r0: number; c0: number; r1: number; c1: number }} R
 */
function rectInteriorMass(R, n) {
  return rectArea(R.r0, R.c0, R.r1, R.c1) - gridOuterBorderCellsInRect(R, n);
}

/**
 * Prefer splitting rectangles with more interior mass so the rim is not over‑fragmented.
 * @param {{ r0: number; c0: number; r1: number; c1: number }[]} big
 * @param {number} interiorStrength 0 = uniform pick
 */
function pickRectToSplit(big, n, interiorStrength, rng) {
  if (interiorStrength <= 1e-6 || big.length <= 1) {
    return big[Math.floor(rng() * big.length)];
  }
  /** @type {number[]} */
  const weights = [];
  let sum = 0;
  for (const R of big) {
    const a = rectArea(R.r0, R.c0, R.r1, R.c1);
    const t = rectInteriorMass(R, n) / (a + 0.01);
    const w = Math.pow(0.2 + 0.8 * t, 1 + 3.5 * interiorStrength) + 0.04;
    weights.push(w);
    sum += w;
  }
  let u = rng() * sum;
  for (let i = 0; i < big.length; i++) {
    u -= weights[i];
    if (u <= 0) return big[i];
  }
  return big[big.length - 1];
}

/**
 * Random partition of n×n into rectangles via recursive splits.
 * Never creates a 1×1 patch (minimum area 2 per rectangle).
 * @param {number} n
 * @param {{ minPatches?: number, maxPatches?: number, rng?: () => number, interiorSplitStrength?: number }} opts
 * @returns {{ r0: number, c0: number, r1: number, c1: number }[]}
 */
function generateRectangles(n, opts = {}) {
  const rng = opts.rng ?? Math.random;
  const minPatches = opts.minPatches ?? Math.max(4, Math.floor((n * n) / 5));
  let maxPatches = opts.maxPatches ?? Math.min(n * n - 2, Math.floor((n * n) / 2) + n);
  if (maxPatches < minPatches) maxPatches = minPatches;
  const interiorStrength = opts.interiorSplitStrength ?? 0;

  let rects = [{ r0: 0, c0: 0, r1: n, c1: n }];

  function pickSplitIndexInRange(lo, hi) {
    const span = hi - lo + 1;
    if (span <= 0) return null;
    const u = rng();
    const bias = 0.35;
    const t = u ** (1 / (1 + bias));
    return lo + Math.floor(t * span);
  }

  const splitLimit = n * n * 64;
  let guard = 0;
  while (guard++ < splitLimit) {
    if (rects.length >= maxPatches && rects.length >= minPatches) break;
    const big = rects.filter(
      (R) => rectArea(R.r0, R.c0, R.r1, R.c1) >= MIN_PATCH_AREA && hasValidSplit(R)
    );
    if (big.length === 0) break;
    const R = pickRectToSplit(big, n, interiorStrength, rng);
    const h = R.r1 - R.r0;
    const w = R.c1 - R.c0;
    const rowNeed = Math.ceil(MIN_PATCH_AREA / w);
    const riLo = R.r0 + rowNeed;
    const riHi = R.r1 - rowNeed;
    const colNeed = Math.ceil(MIN_PATCH_AREA / h);
    const ciLo = R.c0 + colNeed;
    const ciHi = R.c1 - colNeed;
    const choices = [];
    if (h >= 2 * rowNeed && riLo <= riHi) choices.push("h");
    if (w >= 2 * colNeed && ciLo <= ciHi) choices.push("v");
    if (choices.length === 0) continue;
    const kind = choices[Math.floor(rng() * choices.length)];
    let R1;
    let R2;
    const splitTries = interiorStrength > 0.35 ? 12 : 6;
    if (kind === "h") {
      const splitAttempts = Math.min(splitTries, Math.max(1, riHi - riLo + 1));
      let best = null;
      let bestScore = -1;
      for (let k = 0; k < splitAttempts; k++) {
        const ri = pickSplitIndexInRange(riLo, riHi);
        if (ri == null) continue;
        const a1 = (ri - R.r0) * w;
        const a2 = (R.r1 - ri) * w;
        if (a1 < MIN_PATCH_AREA || a2 < MIN_PATCH_AREA) continue;
        const ratio = Math.min(a1, a2) / Math.max(a1, a2);
        const stripPenalty =
          (ri - R.r0 === 1 || R.r1 - ri === 1 ? 0.15 : 0) + (w === 1 ? 0.2 : 0);
        const R1t = { r0: R.r0, c0: R.c0, r1: ri, c1: R.c1 };
        const R2t = { r0: ri, c0: R.c0, r1: R.r1, c1: R.c1 };
        const edgePen =
          interiorStrength *
          1.35 *
          (rectBorderShare(R1t, n) ** 2 + rectBorderShare(R2t, n) ** 2);
        const sliverPen =
          interiorStrength *
          ((a1 <= 8 && rectBorderShare(R1t, n) >= 0.5 ? 0.42 : 0) +
            (a2 <= 8 && rectBorderShare(R2t, n) >= 0.5 ? 0.42 : 0));
        const score = ratio - stripPenalty - edgePen - sliverPen + rng() * 0.08;
        if (score > bestScore) {
          bestScore = score;
          best = ri;
        }
      }
      const ri = best ?? pickSplitIndexInRange(riLo, riHi);
      if (ri == null) continue;
      if ((ri - R.r0) * w < MIN_PATCH_AREA || (R.r1 - ri) * w < MIN_PATCH_AREA) continue;
      R1 = { r0: R.r0, c0: R.c0, r1: ri, c1: R.c1 };
      R2 = { r0: ri, c0: R.c0, r1: R.r1, c1: R.c1 };
    } else {
      const splitAttempts = Math.min(splitTries, Math.max(1, ciHi - ciLo + 1));
      let best = null;
      let bestScore = -1;
      for (let k = 0; k < splitAttempts; k++) {
        const ci = pickSplitIndexInRange(ciLo, ciHi);
        if (ci == null) continue;
        const a1 = h * (ci - R.c0);
        const a2 = h * (R.c1 - ci);
        if (a1 < MIN_PATCH_AREA || a2 < MIN_PATCH_AREA) continue;
        const ratio = Math.min(a1, a2) / Math.max(a1, a2);
        const stripPenalty =
          (ci - R.c0 === 1 || R.c1 - ci === 1 ? 0.15 : 0) + (h === 1 ? 0.2 : 0);
        const R1t = { r0: R.r0, c0: R.c0, r1: R.r1, c1: ci };
        const R2t = { r0: R.r0, c0: ci, r1: R.r1, c1: R.c1 };
        const edgePen =
          interiorStrength *
          1.35 *
          (rectBorderShare(R1t, n) ** 2 + rectBorderShare(R2t, n) ** 2);
        const sliverPen =
          interiorStrength *
          ((a1 <= 8 && rectBorderShare(R1t, n) >= 0.5 ? 0.42 : 0) +
            (a2 <= 8 && rectBorderShare(R2t, n) >= 0.5 ? 0.42 : 0));
        const score = ratio - stripPenalty - edgePen - sliverPen + rng() * 0.08;
        if (score > bestScore) {
          bestScore = score;
          best = ci;
        }
      }
      const ci = best ?? pickSplitIndexInRange(ciLo, ciHi);
      if (ci == null) continue;
      if (h * (ci - R.c0) < MIN_PATCH_AREA || h * (R.c1 - ci) < MIN_PATCH_AREA) continue;
      R1 = { r0: R.r0, c0: R.c0, r1: R.r1, c1: ci };
      R2 = { r0: R.r0, c0: ci, r1: R.r1, c1: R.c1 };
    }
    rects = rects.filter((x) => x !== R).concat(R1, R2);
    if (rects.length >= maxPatches) break;
  }

  return rects;
}

/**
 * @param {number} h
 * @param {number} w
 * @returns {ShapeClue}
 */
function shapeForRect(h, w) {
  if (h === w) return "square";
  if (h > w) return "tall";
  return "wide";
}

/**
 * Shikaku-style: every clue cell shows the patch area (number). Shape narrows valid rectangles.
 * @typedef {{ shape: ShapeClue, area: number }} CellClue
 * @typedef {{
 *   solution: number[][],
 *   clues: (CellClue|null)[][],
 *   rects: { r0: number; c0: number; r1: number; c1: number }[],
 *   clueCount: number,
 * }} Puzzle
 */

/**
 * Difficulty tuning:
 * - More patches ⇒ smaller average regions ⇒ harder (more local + global decisions).
 * - Higher `anyChance` + `anyMinFrac` (hard+) ⇒ more “any shape” clues ⇒ more rectangle ambiguity.
 * - Lower `cornerBias` ⇒ clues often sit away from patch corners (less visually obvious).
 * @type {Record<string, {
 *   minPatchFrac: number,
 *   maxPatchFrac: number,
 *   maxPatchBias: number,
 *   anyChance: number,
 *   anyMinFrac: number,
 *   cornerBias: number,
 *   interiorSplitStrength: number,
 *   clueAvoidBoardEdge: number,
 * }>}
 */
const DIFF = {
  easy: {
    minPatchFrac: 1 / 10,
    maxPatchFrac: 1 / 5.2,
    maxPatchBias: 0.35,
    anyChance: 0.32,
    anyMinFrac: 0,
    cornerBias: 0.9,
    interiorSplitStrength: 0,
    clueAvoidBoardEdge: 0,
  },
  medium: {
    minPatchFrac: 1 / 8,
    maxPatchFrac: 1 / 4.2,
    maxPatchBias: 0.52,
    anyChance: 0.2,
    anyMinFrac: 0,
    cornerBias: 0.62,
    interiorSplitStrength: 0.22,
    clueAvoidBoardEdge: 0.22,
  },
  hard: {
    minPatchFrac: 1 / 6,
    maxPatchFrac: 1 / 3.1,
    maxPatchBias: 0.72,
    anyChance: 0.48,
    anyMinFrac: 0.22,
    cornerBias: 0.32,
    interiorSplitStrength: 0.58,
    clueAvoidBoardEdge: 0.55,
  },
  expert: {
    minPatchFrac: 1 / 4.6,
    maxPatchFrac: 1 / 2.35,
    maxPatchBias: 0.88,
    anyChance: 0.68,
    anyMinFrac: 0.34,
    cornerBias: 0.1,
    interiorSplitStrength: 0.92,
    clueAvoidBoardEdge: 0.84,
  },
};

function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * After random clue shapes, force at least `anyMinFrac` of patches to use "any" (hard / expert).
 * @param {(null | { shape: ShapeClue, area: number })[][]} clues
 * @param {number} n
 * @param {number} anyMinFrac
 * @param {() => number} rng
 */
function enforceMinimumAnyClues(clues, n, anyMinFrac, rng) {
  if (anyMinFrac <= 0) return;
  /** @type {[number, number][]} */
  const clueCells = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (clues[r][c]) clueCells.push([r, c]);
    }
  }
  const total = clueCells.length;
  if (total === 0) return;
  const target = Math.min(total, Math.ceil(total * anyMinFrac));
  let anyCount = clueCells.filter(([r, c]) => clues[r][c]?.shape === "any").length;
  if (anyCount >= target) return;
  const nonAny = clueCells.filter(([r, c]) => clues[r][c] && clues[r][c].shape !== "any");
  shuffleInPlace(nonAny, rng);
  for (const [r, c] of nonAny) {
    if (anyCount >= target) break;
    const cl = clues[r][c];
    if (!cl || cl.shape === "any") continue;
    clues[r][c] = { shape: "any", area: cl.area };
    anyCount++;
  }
}

/**
 * @param {{ r0: number; c0: number; r1: number; c1: number }[]} rects
 * @param {number} n
 */
function verifyRectPartition(rects, n) {
  if (!rects || rects.length === 0) return false;
  const cov = Array.from({ length: n }, () => Array(n).fill(0));
  for (const R of rects) {
    if (!R || R.r1 <= R.r0 || R.c1 <= R.c0) return false;
    const a = rectArea(R.r0, R.c0, R.r1, R.c1);
    if (a < MIN_PATCH_AREA) return false;
    for (let r = R.r0; r < R.r1; r++) {
      for (let c = R.c0; c < R.c1; c++) {
        if (r < 0 || r >= n || c < 0 || c >= n) return false;
        if (cov[r][c]) return false;
        cov[r][c] = 1;
      }
    }
  }
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!cov[r][c]) return false;
    }
  }
  return true;
}

/**
 * @param {number} n
 * @param {'easy'|'medium'|'hard'|'expert'} difficulty
 * @param {{ rng?: () => number }} [opts]
 * @returns {Puzzle}
 */
function buildPuzzle(n, difficulty, opts = {}) {
  const rng = opts.rng ?? Math.random;
  const d = DIFF[difficulty] ?? DIFF.medium;

  const cells = n * n;
  const genCap = Math.min(Math.floor(cells / 2) + n + 2, cells - 1);
  let minNeed = Math.max(4, Math.floor(cells * d.minPatchFrac));
  let maxCap = Math.min(
    genCap,
    Math.max(minNeed + 2, Math.floor(cells * d.maxPatchFrac))
  );
  if (maxCap < minNeed + 1) maxCap = minNeed + 1;

  let rects = /** @type {{ r0: number; c0: number; r1: number; c1: number }[]} */ ([]);

  for (let attempt = 0; attempt < 72; attempt++) {
    const span = maxCap - minNeed;
    const bias = d.maxPatchBias;
    const u = rng();
    const skew = bias * u + (1 - bias) * u * u;
    let maxP = minNeed + 1 + Math.floor(skew * Math.max(1, span - 1));
    maxP = Math.min(maxCap, Math.max(minNeed + 1, maxP));

    rects = generateRectangles(n, {
      minPatches: minNeed,
      maxPatches: maxP,
      rng,
      interiorSplitStrength: d.interiorSplitStrength ?? 0,
    });

    const okAreas = rects.every(
      (R) => rectArea(R.r0, R.c0, R.r1, R.c1) >= MIN_PATCH_AREA
    );
    if (
      verifyRectPartition(rects, n) &&
      okAreas &&
      rects.length >= minNeed
    ) {
      break;
    }
    if (attempt % 14 === 13) {
      minNeed = Math.max(4, minNeed - 1);
      maxCap = Math.max(minNeed + 1, maxCap);
    }
  }

  if (!verifyRectPartition(rects, n)) {
    rects = [{ r0: 0, c0: 0, r1: n, c1: n }];
  }

  const solution = Array.from({ length: n }, () => Array(n).fill(0));
  rects.forEach((R, id) => {
    for (let r = R.r0; r < R.r1; r++) {
      for (let c = R.c0; c < R.c1; c++) {
        solution[r][c] = id;
      }
    }
  });

  const clues = Array.from({ length: n }, () => Array(n).fill(null));

  /** @type {Map<number, {r0:number,c0:number,r1:number,c1:number}>} */
  const idToRect = new Map();
  rects.forEach((R, id) => idToRect.set(id, R));

  for (let id = 0; id < rects.length; id++) {
    const R = idToRect.get(id);
    const h = R.r1 - R.r0;
    const w = R.c1 - R.c0;
    const area = h * w;
    const trueShape = shapeForRect(h, w);

    const allCells = [];
    const cornerCells = [];
    /** Cells of this patch not on the outer rim of the board (rim clues are easier). */
    const boardInteriorCells = [];
    for (let r = R.r0; r < R.r1; r++) {
      for (let c = R.c0; c < R.c1; c++) {
        allCells.push([r, c]);
        const onCorner =
          (r === R.r0 || r === R.r1 - 1) && (c === R.c0 || c === R.c1 - 1);
        if (onCorner) cornerCells.push([r, c]);
        if (r > 0 && r < n - 1 && c > 0 && c < n - 1) boardInteriorCells.push([r, c]);
      }
    }

    /** @type {[number, number][]} */
    let pool;
    if (boardInteriorCells.length > 0 && rng() < (d.clueAvoidBoardEdge ?? 0)) {
      pool = boardInteriorCells;
    } else if (cornerCells.length > 0 && rng() < d.cornerBias) {
      pool = cornerCells;
    } else {
      pool = allCells;
    }
    shuffleInPlace(pool, rng);
    const [r, c] = pool[0];

    let shape = trueShape;
    if (rng() < d.anyChance) shape = "any";
    clues[r][c] = { shape, area };
  }

  enforceMinimumAnyClues(clues, n, d.anyMinFrac ?? 0, rng);

  return { solution, clues, rects, clueCount: rects.length };
}
