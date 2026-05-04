/* global buildPuzzle, shapeForRect, MIN_PATCH_AREA — set in generator.js */

const PATCH_COLORS = [
  "#d4a72c",
  "#3d6b4f",
  "#9b8dc9",
  "#2a8f8f",
  "#d9732b",
  "#e85d5d",
  "#5ba4d4",
  "#b84d8e",
  "#e8a598",
  "#6b8cae",
  "#c9a227",
  "#8f6b5c",
];

/** @type {ReturnType<typeof buildPuzzle> | null} */
let puzzle = null;
/** @type {number[][]} player patch id per cell, -1 empty */
let player = [];
let n = 6;
let nextPatchId = 0;
/** @type {number[][][]} */
let undoStack = [];
let timerStart = 0;
let timerId = 0;
let playing = false;

const gridHost = document.getElementById("gridHost");
const setupPanel = document.getElementById("setupPanel");
const playArea = document.getElementById("playArea");
const sizeSelect = document.getElementById("sizeSelect");
const difficultySelect = document.getElementById("difficultySelect");
const startBtn = document.getElementById("startBtn");
const undoBtn = document.getElementById("undoBtn");
const hintBtn = document.getElementById("hintBtn");
const newBtn = document.getElementById("newBtn");
const timerText = document.getElementById("timerText");
const toastEl = document.getElementById("toast");
const winModal = document.getElementById("winModal");
const winTime = document.getElementById("winTime");
const winNextBtn = document.getElementById("winNextBtn");
const winSetupBtn = document.getElementById("winSetupBtn");

let dragStart = null;
/** If drag began on a clue cell that already belongs to a patch, we may extend that patch. */
let clueExtendAnchor = /** @type {{ r: number; c: number } | null} */ (null);
/** @type {HTMLElement | null} */
let activeCells = [];

function showToast(msg, ms = 2200) {
  if (!toastEl) {
    window.alert(msg);
    return;
  }
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toastEl.classList.add("hidden"), ms);
}

function snapshot() {
  return player.map((row) => row.slice());
}

function pushUndo() {
  undoStack.push(snapshot());
  if (undoStack.length > 80) undoStack.shift();
}

function applySnapshot(s) {
  player = s.map((row) => row.slice());
  renderGrid();
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function startTimer() {
  clearInterval(timerId);
  timerStart = Date.now();
  timerId = setInterval(() => {
    const sec = Math.floor((Date.now() - timerStart) / 1000);
    timerText.textContent = formatTime(sec);
  }, 500);
}

function stopTimer() {
  clearInterval(timerId);
  timerId = 0;
}

function cellKey(r, c) {
  return `${r},${c}`;
}

function parseKey(k) {
  const [r, c] = k.split(",").map(Number);
  return { r, c };
}

function normalizeSelection(a, b) {
  const r0 = Math.min(a.r, b.r);
  const r1 = Math.max(a.r, b.r);
  const c0 = Math.min(a.c, b.c);
  const c1 = Math.max(a.c, b.c);
  return { r0, r1, c0, c1 };
}

function iterRect(sel, fn) {
  for (let r = sel.r0; r <= sel.r1; r++) {
    for (let c = sel.c0; c <= sel.c1; c++) {
      fn(r, c);
    }
  }
}

/**
 * Collect player ids in rect; -2 if mixed, -1 if all empty, else single id
 * @param {{r0:number,r1:number,c0:number,c1:number}} sel
 */
function rectPlayerState(sel) {
  let seen = null;
  let empty = true;
  iterRect(sel, (r, c) => {
    const v = player[r][c];
    if (v < 0) return;
    empty = false;
    if (seen === null) seen = v;
    else if (seen !== v) seen = -2;
  });
  if (empty) return -1;
  return seen;
}

function isRectangleSelection(sel) {
  return true;
}

function paintRect(sel, modeClear) {
  pushUndo();
  if (modeClear) {
    iterRect(sel, (r, c) => {
      player[r][c] = -1;
    });
  } else {
    const pid = nextPatchId++;
    iterRect(sel, (r, c) => {
      player[r][c] = pid;
    });
  }
  const stripped = removeInvalidPlayerPatches();
  renderGrid();
  checkWinSoon();
  if (stripped > 0) {
    showToast("That patch broke the rules (shape, size, or no clue) — it was removed.", 2600);
  }
}

function wipePatchIdEverywhere(patchId) {
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (player[r][c] === patchId) player[r][c] = -1;
    }
  }
}

/** Undoable: remove every cell with this player patch id. */
function clearEntirePatch(patchId) {
  if (patchId < 0) return;
  pushUndo();
  wipePatchIdEverywhere(patchId);
  renderGrid();
  checkWinSoon();
}

/**
 * Grow a patch: clear that id everywhere, then fill the rectangle (must include new empty cells).
 * @param {{r0:number,r1:number,c0:number,c1:number}} sel
 * @param {number} patchId
 */
function applyExtendRectangle(sel, patchId) {
  pushUndo();
  wipePatchIdEverywhere(patchId);
  iterRect(sel, (r, c) => {
    player[r][c] = patchId;
  });
  const stripped = removeInvalidPlayerPatches();
  renderGrid();
  checkWinSoon();
  if (stripped > 0) {
    showToast("That patch broke the rules — removed.", 2200);
  }
}

/**
 * Build solution patch id → set of cell keys for exact match checks.
 * @param {number[][]} sol
 */
function solutionPatchCellSets(sol) {
  /** @type {Map<number, Set<string>>} */
  const map = new Map();
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const sid = sol[r][c];
      const k = cellKey(r, c);
      if (!map.has(sid)) map.set(sid, new Set());
      map.get(sid).add(k);
    }
  }
  return map;
}

/**
 * Flood-fill one player-connected component; marks keys in `visited`.
 * @param {number} r
 * @param {number} c
 * @param {number} pid
 * @param {Set<string>} visited
 * @returns {Set<string>}
 */
function floodPlayerComponent(r, c, pid, visited) {
  const comp = new Set();
  const stack = [[r, c]];
  while (stack.length) {
    const [cr, cc] = stack.pop();
    const k = cellKey(cr, cc);
    if (visited.has(k)) continue;
    if (player[cr][cc] !== pid) continue;
    visited.add(k);
    comp.add(k);
    if (cr > 0) stack.push([cr - 1, cc]);
    if (cr + 1 < n) stack.push([cr + 1, cc]);
    if (cc > 0) stack.push([cr, cc - 1]);
    if (cc + 1 < n) stack.push([cr, cc + 1]);
  }
  return comp;
}

/** @param {(null | { shape: string, area: number })[][]} clues */
function countClueCellsOnBoard(clues) {
  let count = 0;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (clues[r][c]) count++;
    }
  }
  return count;
}

/**
 * @param {Set<string>} comp
 */
function componentIsValidPatch(comp) {
  if (!puzzle || comp.size === 0) return false;
  const { clues } = puzzle;
  let r0 = 999;
  let r1 = -1;
  let c0 = 999;
  let c1 = -1;
  let pid = -1;
  for (const k of comp) {
    const { r, c } = parseKey(k);
    r0 = Math.min(r0, r);
    r1 = Math.max(r1, r);
    c0 = Math.min(c0, c);
    c1 = Math.max(c1, c);
    if (pid < 0) pid = player[r][c];
  }
  const h = r1 - r0 + 1;
  const w = c1 - c0 + 1;
  const bboxArea = h * w;
  let inBbox = 0;
  for (let rr = r0; rr <= r1; rr++) {
    for (let cc = c0; cc <= c1; cc++) {
      if (player[rr][cc] === pid) inBbox++;
    }
  }
  if (inBbox !== comp.size || bboxArea !== comp.size) return false;

  let clueHits = 0;
  /** @type {{ shape: string, area: number } | null} */
  let only = null;
  for (const k of comp) {
    const { r, c } = parseKey(k);
    const cl = clues[r][c];
    if (cl) {
      clueHits++;
      only = cl;
    }
  }
  if (clueHits !== 1 || !only) return false;

  const shape = shapeForRect(h, w);
  if (bboxArea > only.area) return false;
  if (bboxArea === only.area) {
    if (only.shape !== "any" && only.shape !== shape) return false;
  }
  return true;
}

/** Clears every invalid filled component (wrong shape, overfilled, no clue, etc.). */
function removeInvalidPlayerPatches() {
  if (!puzzle) return 0;
  const visited = new Set();
  let cellsCleared = 0;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (player[r][c] < 0) continue;
      const k0 = cellKey(r, c);
      if (visited.has(k0)) continue;
      const pid = player[r][c];
      const comp = floodPlayerComponent(r, c, pid, visited);
      if (!componentIsValidPatch(comp)) {
        for (const k of comp) {
          const { r: rr, c: cc } = parseKey(k);
          player[rr][cc] = -1;
          cellsCleared++;
        }
      }
    }
  }
  return cellsCleared;
}

/** @returns {Map<number, number>} player patch id → connected size */
function getPlayerPatchSizesMap() {
  const visited = new Set();
  /** @type {Map<number, number>} */
  const map = new Map();
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (player[r][c] < 0) continue;
      const k0 = cellKey(r, c);
      if (visited.has(k0)) continue;
      const pid = player[r][c];
      const comp = floodPlayerComponent(r, c, pid, visited);
      map.set(pid, comp.size);
    }
  }
  return map;
}

/**
 * True if this player region is exactly the cell set of one solution rectangle.
 * @param {Set<string>} comp
 * @param {number[][]} sol
 * @param {Map<number, Set<string>>} solSets
 */
function playerComponentMatchesSolution(comp, sol, solSets) {
  const solIds = new Set();
  for (const k of comp) {
    const { r, c } = parseKey(k);
    solIds.add(sol[r][c]);
  }
  if (solIds.size !== 1) return false;
  const sid = /** @type {number} */ ([...solIds][0]);
  const expected = solSets.get(sid);
  if (!expected || comp.size !== expected.size) return false;
  for (const k of comp) {
    if (!expected.has(k)) return false;
  }
  return true;
}

/** Remove filled cells that belong to patches not matching any solution region exactly. */
function clearWrongHintPatches() {
  if (!puzzle) return 0;
  const sol = puzzle.solution;
  const solSets = solutionPatchCellSets(sol);
  const visited = new Set();
  const toClear = new Set();

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (player[r][c] < 0) continue;
      const k0 = cellKey(r, c);
      if (visited.has(k0)) continue;
      const pid = player[r][c];
      const comp = floodPlayerComponent(r, c, pid, visited);
      if (!playerComponentMatchesSolution(comp, sol, solSets)) {
        for (const k of comp) toClear.add(k);
      }
    }
  }

  if (toClear.size === 0) return 0;
  pushUndo();
  for (const k of toClear) {
    const { r, c } = parseKey(k);
    player[r][c] = -1;
  }
  renderGrid();
  checkWinSoon();
  return toClear.size;
}

/**
 * LinkedIn Patches / Shikaku: full grid, rectangles only, each patch has exactly one
 * numbered clue (area), shape restricts proportions. Any valid tiling wins.
 * @returns {{ ok: boolean, pulse?: [number, number] }}
 */
function validateCompletion() {
  if (!puzzle) return { ok: false };
  const { clues } = puzzle;
  const expectedRegionCount = countClueCellsOnBoard(clues);
  const visited = new Set();
  let regionCount = 0;

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (player[r][c] < 0) return { ok: false, pulse: [r, c] };
    }
  }

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const pid = player[r][c];
      const startKey = cellKey(r, c);
      if (visited.has(startKey)) continue;
      regionCount++;

      let r0 = r;
      let r1 = r;
      let c0 = c;
      let c1 = c;
      const stack = [[r, c]];

      while (stack.length) {
        const [cr, cc] = stack.pop();
        const k = cellKey(cr, cc);
        if (visited.has(k)) continue;
        if (player[cr][cc] !== pid) continue;
        visited.add(k);
        r0 = Math.min(r0, cr);
        r1 = Math.max(r1, cr);
        c0 = Math.min(c0, cc);
        c1 = Math.max(c1, cc);
        if (cr > 0) stack.push([cr - 1, cc]);
        if (cr + 1 < n) stack.push([cr + 1, cc]);
        if (cc > 0) stack.push([cr, cc - 1]);
        if (cc + 1 < n) stack.push([cr, cc + 1]);
      }

      const h = r1 - r0 + 1;
      const w = c1 - c0 + 1;
      const area = h * w;
      const fail = (/** @type {[number, number]} */ cell) => ({ ok: false, pulse: cell });
      if (area < MIN_PATCH_AREA) return fail([r0, c0]);

      let cellCount = 0;
      for (let rr = r0; rr <= r1; rr++) {
        for (let cc = c0; cc <= c1; cc++) {
          if (player[rr][cc] === pid) cellCount++;
        }
      }
      if (cellCount !== area) return fail([r0, c0]);
      for (let rr = r0; rr <= r1; rr++) {
        for (let cc = c0; cc <= c1; cc++) {
          if (player[rr][cc] !== pid) return fail([r0, c0]);
        }
      }

      const shape = shapeForRect(h, w);
      let cluesInRegion = 0;
      /** @type {{ shape: string, area: number } | null} */
      let onlyClue = null;
      for (let rr = r0; rr <= r1; rr++) {
        for (let cc = c0; cc <= c1; cc++) {
          const cl = clues[rr][cc];
          if (!cl) continue;
          cluesInRegion++;
          onlyClue = cl;
        }
      }
      if (cluesInRegion !== 1 || !onlyClue) return fail([r0, c0]);
      if (onlyClue.area !== area) return fail([r0, c0]);
      if (onlyClue.shape !== "any" && onlyClue.shape !== shape) return fail([r0, c0]);
    }
  }

  if (visited.size !== n * n || regionCount !== expectedRegionCount) {
    return { ok: false };
  }
  return { ok: true };
}

function cluesSatisfied() {
  return validateCompletion().ok;
}

function checkWinSoon() {
  if (!puzzle || !playing) return;
  requestAnimationFrame(() => {
    if (cluesSatisfied()) {
      playing = false;
      stopTimer();
      const sec = Math.floor((Date.now() - timerStart) / 1000);
      winTime.textContent = `Time: ${formatTime(sec)}`;
      winModal.classList.remove("hidden");
    }
  });
}

function undo() {
  if (undoStack.length === 0) {
    showToast("Nothing to undo");
    return;
  }
  applySnapshot(undoStack.pop());
}

function hint() {
  if (!puzzle || !playing) return;

  const removed = clearWrongHintPatches();
  if (removed > 0) {
    showToast(
      removed === 1
        ? "Hint: removed 1 incorrect cell."
        : `Hint: removed ${removed} incorrect cells (wrong or incomplete patches).`
    );
    return;
  }

  const sol = puzzle.solution;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (player[r][c] < 0) {
        pulseCell(r, c);
        showToast("Fill every cell — drag on empty squares to draw a patch.");
        return;
      }
    }
  }

  const wrong = new Set();
  const mark = (r, c) => wrong.add(cellKey(r, c));
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      for (const [dr, dc] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ]) {
        const rr = r + dr;
        const cc = c + dc;
        if (rr < 0 || rr >= n || cc < 0 || cc >= n) continue;
        const edgeP = player[r][c] === player[rr][cc];
        const edgeS = sol[r][c] === sol[rr][cc];
        if (edgeP !== edgeS) {
          mark(r, c);
          mark(rr, cc);
        }
      }
    }
  }

  if (wrong.size === 0) {
    const v = validateCompletion();
    if (v.ok) {
      showToast("Your grid satisfies all Patches rules.");
      return;
    }
    if (v.pulse) {
      pulseCell(v.pulse[0], v.pulse[1]);
      showToast("A patch here breaks the rules (one number per patch, area, shape, or not a rectangle).");
      return;
    }
    return;
  }
  const keys = [...wrong];
  const pick = keys[Math.floor(Math.random() * keys.length)];
  const { r: pr, c: pc } = parseKey(pick);
  pulseCell(pr, pc);
  showToast(
    "This border differs from the layout used to build the puzzle (hint only — some puzzles have more than one answer)."
  );
}

function pulseCell(r, c) {
  const el = gridHost.querySelector(`[data-r="${r}"][data-c="${c}"]`);
  if (!el) return;
  el.classList.remove("hint-pulse");
  void el.offsetWidth;
  el.classList.add("hint-pulse");
}

function regionStyle(r, c) {
  const pid = player[r][c];
  if (pid < 0) return { bg: null, radius: "6px", width: "1px" };

  const color = PATCH_COLORS[pid % PATCH_COLORS.length];
  const top = r === 0 || player[r - 1][c] !== pid;
  const bottom = r === n - 1 || player[r + 1][c] !== pid;
  const left = c === 0 || player[r][c - 1] !== pid;
  const right = c === n - 1 || player[r][c + 1] !== pid;

  const radTL = top && left ? "10px" : "0";
  const radTR = top && right ? "10px" : "0";
  const radBR = bottom && right ? "10px" : "0";
  const radBL = bottom && left ? "10px" : "0";
  const radius = `${radTL} ${radTR} ${radBR} ${radBL}`;

  const bw = "2px";
  const bc = "rgba(255,255,255,0.92)";
  const borderTop = top ? `${bw} solid ${bc}` : "none";
  const borderBottom = bottom ? `${bw} solid ${bc}` : "none";
  const borderLeft = left ? `${bw} solid ${bc}` : "none";
  const borderRight = right ? `${bw} solid ${bc}` : "none";

  return {
    bg: color,
    radius,
    borderTop,
    borderBottom,
    borderLeft,
    borderRight,
  };
}

function renderGrid() {
  if (!puzzle) return;
  gridHost.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
  gridHost.style.gridTemplateRows = `repeat(${n}, 1fr)`;
  gridHost.innerHTML = "";

  const patchSizes = getPlayerPatchSizesMap();

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.r = String(r);
      cell.dataset.c = String(c);
      const st = regionStyle(r, c);
      if (st.bg) {
        cell.classList.add("filled");
        cell.style.background = st.bg;
        cell.style.borderRadius = st.radius;
        cell.style.borderTop = st.borderTop;
        cell.style.borderRight = st.borderRight;
        cell.style.borderBottom = st.borderBottom;
        cell.style.borderLeft = st.borderLeft;
      }

      const clue = puzzle.clues[r][c];
      if (clue) {
        const inner = document.createElement("div");
        inner.className = "cell-inner clue-layer";
        const icon = document.createElement("span");
        icon.className = `clue-icon clue-${clue.shape}`;
        icon.setAttribute("aria-label", clue.shape);
        inner.appendChild(icon);
        const pid = player[r][c];
        const cur = pid >= 0 && patchSizes.has(pid) ? patchSizes.get(pid) : 0;
        const num = document.createElement("span");
        num.className = "clue-num";
        const curEl = document.createElement("span");
        curEl.className = "clue-num-current";
        curEl.textContent = String(cur);
        const sep = document.createElement("span");
        sep.className = "clue-num-sep";
        sep.textContent = "/";
        const tgtEl = document.createElement("span");
        tgtEl.className = "clue-num-target";
        tgtEl.textContent = String(clue.area);
        num.appendChild(curEl);
        num.appendChild(sep);
        num.appendChild(tgtEl);
        inner.appendChild(num);
        cell.appendChild(inner);
      }

      cell.addEventListener("pointerdown", onPointerDown);
      gridHost.appendChild(cell);
    }
  }
}

/** @param {PointerEvent} e */
function onPointerDown(e) {
  if (!playing || !puzzle) return;
  const t = /** @type {HTMLElement} */ (e.currentTarget);
  const r = Number(t.dataset.r);
  const c = Number(t.dataset.c);
  dragStart = { r, c };
  clueExtendAnchor = null;
  if (puzzle.clues[r][c] && player[r][c] >= 0) {
    clueExtendAnchor = { r, c };
  }
  activeCells = [];
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp, { once: true });
  e.preventDefault();
}

function onPointerMove(e) {
  if (!dragStart || !playing) return;
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const cell = el?.closest?.(".cell");
  if (!cell || !gridHost.contains(cell)) return;
  const r = Number(cell.dataset.r);
  const c = Number(cell.dataset.c);
  const sel = normalizeSelection(dragStart, { r, c });
  highlightSelection(sel);
}

function highlightSelection(sel) {
  gridHost.querySelectorAll(".cell.selecting").forEach((x) => x.classList.remove("selecting"));
  iterRect(sel, (r, c) => {
    const el = gridHost.querySelector(`[data-r="${r}"][data-c="${c}"]`);
    el?.classList.add("selecting");
  });
}

function onPointerUp(e) {
  window.removeEventListener("pointermove", onPointerMove);
  if (!dragStart || !playing) {
    dragStart = null;
    clueExtendAnchor = null;
    gridHost.querySelectorAll(".cell.selecting").forEach((x) => x.classList.remove("selecting"));
    return;
  }
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const cell = el?.closest?.(".cell");
  let end = dragStart;
  if (cell && gridHost.contains(cell)) {
    end = { r: Number(cell.dataset.r), c: Number(cell.dataset.c) };
  }
  const sel = normalizeSelection(dragStart, end);
  const anchor = clueExtendAnchor;
  dragStart = null;
  clueExtendAnchor = null;
  gridHost.querySelectorAll(".cell.selecting").forEach((x) => x.classList.remove("selecting"));

  if (!isRectangleSelection(sel)) return;

  const state = rectPlayerState(sel);
  if (state === -2) {
    showToast("Selection spans multiple patches — undo or clear a region first.");
    return;
  }

  if (anchor && puzzle.clues[anchor.r][anchor.c]) {
    const pid = player[anchor.r][anchor.c];
    if (pid >= 0) {
      let onlyPidOrEmpty = true;
      let hasEmpty = false;
      iterRect(sel, (r, c) => {
        if (player[r][c] < 0) hasEmpty = true;
        else if (player[r][c] !== pid) onlyPidOrEmpty = false;
      });
      if (onlyPidOrEmpty && hasEmpty) {
        const wSel = sel.c1 - sel.c0 + 1;
        const hSel = sel.r1 - sel.r0 + 1;
        if (wSel * hSel < MIN_PATCH_AREA) {
          showToast("Each patch must cover at least two cells.");
          return;
        }
        applyExtendRectangle(sel, pid);
        return;
      }
    }
  }

  if (state === -1) {
    const wSel = sel.c1 - sel.c0 + 1;
    const hSel = sel.r1 - sel.r0 + 1;
    if (wSel * hSel < MIN_PATCH_AREA) {
      showToast("Each patch must cover at least two cells.");
      return;
    }
    paintRect(sel, false);
    return;
  }

  const wSel = sel.c1 - sel.c0 + 1;
  const hSel = sel.r1 - sel.r0 + 1;
  if (wSel * hSel === 1) {
    const cr = sel.r0;
    const cc = sel.c0;
    if (puzzle.clues[cr][cc] && player[cr][cc] >= 0) {
      clearEntirePatch(player[cr][cc]);
      return;
    }
  }

  paintRect(sel, true);
}

function beginGame() {
  try {
    n = Number(sizeSelect.value);
    const difficulty = /** @type {'easy'|'medium'|'hard'|'expert'} */ (
      difficultySelect.value
    );
    puzzle = buildPuzzle(n, difficulty);
    player = Array.from({ length: n }, () => Array(n).fill(-1));
    nextPatchId = 0;
    undoStack = [];
    dragStart = null;
    clueExtendAnchor = null;
    playing = true;
    setupPanel.classList.add("hidden");
    playArea.classList.remove("hidden");
    playArea.scrollIntoView({ behavior: "smooth", block: "nearest" });
    renderGrid();
    timerText.textContent = "0:00";
    startTimer();
    winModal.classList.add("hidden");
  } catch (err) {
    console.error(err);
    showToast("Could not start puzzle. Try again or pick a different size.");
    playing = false;
    setupPanel.classList.remove("hidden");
    playArea.classList.add("hidden");
  }
}

function wireUi() {
  if (!startBtn || !gridHost) {
    console.error("Patches: missing #startBtn or #gridHost");
    return;
  }
  if (typeof buildPuzzle !== "function") {
    console.error("Patches: js/generator.js did not load (buildPuzzle missing). Check the Network tab.");
    startBtn.disabled = true;
    startBtn.textContent = "Error: reload page";
    return;
  }
  startBtn.addEventListener("click", beginGame);
  newBtn?.addEventListener("click", () => {
    winModal?.classList.add("hidden");
    beginGame();
  });
  winNextBtn?.addEventListener("click", () => {
    winModal?.classList.add("hidden");
    beginGame();
  });
  winSetupBtn?.addEventListener("click", () => {
    winModal?.classList.add("hidden");
    stopTimer();
    playing = false;
    playArea?.classList.add("hidden");
    setupPanel?.classList.remove("hidden");
  });
  undoBtn?.addEventListener("click", undo);
  hintBtn?.addEventListener("click", hint);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", wireUi);
} else {
  wireUi();
}
