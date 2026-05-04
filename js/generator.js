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
 * Random partition of n×n into rectangles via recursive splits.
 * Never creates a 1×1 patch (minimum area 2 per rectangle).
 * @param {number} n
 * @param {{ minPatches?: number, maxPatches?: number, rng?: () => number }} opts
 * @returns {{ r0: number, c0: number, r1: number, c1: number }[]}
 */
function generateRectangles(n, opts = {}) {
  const rng = opts.rng ?? Math.random;
  const minPatches = opts.minPatches ?? Math.max(4, Math.floor((n * n) / 5));
  let maxPatches = opts.maxPatches ?? Math.min(n * n - 2, Math.floor((n * n) / 2) + n);
  if (maxPatches < minPatches) maxPatches = minPatches;

  let rects = [{ r0: 0, c0: 0, r1: n, c1: n }];

  function pickSplitIndexInRange(lo, hi) {
    const span = hi - lo + 1;
    if (span <= 0) return null;
    const u = rng();
    const bias = 0.35;
    const t = u ** (1 / (1 + bias));
    return lo + Math.floor(t * span);
  }

  let guard = 0;
  while (rects.length < maxPatches && guard++ < n * n * 24) {
    const big = rects.filter(
      (R) => rectArea(R.r0, R.c0, R.r1, R.c1) >= MIN_PATCH_AREA && hasValidSplit(R)
    );
    if (big.length === 0) break;
    const R = big[Math.floor(rng() * big.length)];
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
    if (kind === "h") {
      const splitAttempts = Math.min(6, Math.max(1, riHi - riLo + 1));
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
        const score = ratio - stripPenalty + rng() * 0.08;
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
      const splitAttempts = Math.min(6, Math.max(1, ciHi - ciLo + 1));
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
        const score = ratio - stripPenalty + rng() * 0.08;
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
 * Difficulty: where the anchor sits and how often shape is "any" (full Shikaku freedom).
 * @type {Record<string, { anyChance: number, cornerBias: number }>}
 */
const DIFF = {
  easy: { anyChance: 0.05, cornerBias: 0.92 },
  medium: { anyChance: 0.1, cornerBias: 0.72 },
  hard: { anyChance: 0.18, cornerBias: 0.45 },
  expert: { anyChance: 0.26, cornerBias: 0.22 },
};

function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
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

  let minNeed = Math.max(5, Math.floor(n * 1.15));
  let rects = /** @type {{ r0: number; c0: number; r1: number; c1: number }[]} */ ([]);

  for (let attempt = 0; attempt < 48; attempt++) {
    const targetCount = Math.floor(n + 2 + rng() * Math.max(2, (n * n) / 4 - n + 1));
    let maxP = Math.min(
      Math.floor((n * n) / 2) + n + 2,
      Math.max(minNeed + 1, targetCount)
    );
    if (maxP < minNeed) maxP = minNeed;

    rects = generateRectangles(n, {
      minPatches: minNeed,
      maxPatches: maxP,
      rng,
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
    if (attempt % 10 === 9) minNeed = Math.max(3, minNeed - 1);
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
    for (let r = R.r0; r < R.r1; r++) {
      for (let c = R.c0; c < R.c1; c++) {
        allCells.push([r, c]);
        const onCorner =
          (r === R.r0 || r === R.r1 - 1) && (c === R.c0 || c === R.c1 - 1);
        if (onCorner) cornerCells.push([r, c]);
      }
    }

    const pool =
      cornerCells.length > 0 && rng() < d.cornerBias ? cornerCells : allCells;
    shuffleInPlace(pool, rng);
    const [r, c] = pool[0];

    let shape = trueShape;
    if (rng() < d.anyChance) shape = "any";
    clues[r][c] = { shape, area };
  }

  return { solution, clues, rects, clueCount: rects.length };
}
