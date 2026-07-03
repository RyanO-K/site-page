"use strict";
(() => {
  // src/shared/constants.ts
  var GRID = { cols: 10, rows: 15, cellSize: 32 };
  var CANVAS_WIDTH = GRID.cols * GRID.cellSize;
  var CANVAS_HEIGHT = GRID.rows * GRID.cellSize;
  var INITIAL_BLOCK_WIDTH = 7;
  var BASE_TICK_MS = 400;
  var SPEED_PER_DROP = 4;
  var MIN_TICK_MS = 80;
  var IDLE_TIMEOUT_MS = 1e4;
  var MAX_HIGH_SCORES = 10;
  var PERFECT_BONUS = 50;
  var POINTS_PER_CELL = 10;
  var COLORS = {
    background: "#1a1a2e",
    grid: "#16213e",
    platform: "#2a2060",
    blockBottom: "#7a2040",
    blockTop: "#e94560",
    blockActive: "#e94560",
    blockPerfect: "#f5a623",
    npcBlock: "#00b4d8",
    text: "#eaeaea",
    overlay: "rgba(0,0,0,0.6)"
  };

  // src/game/core.ts
  function computeTickInterval(dropCount2) {
    return Math.max(MIN_TICK_MS, BASE_TICK_MS - dropCount2 * SPEED_PER_DROP);
  }
  function computeLevel(dropCount2) {
    return Math.floor(dropCount2 / 5) + 1;
  }
  function intersectBlocks(a, b) {
    const left = Math.max(a.x, b.x);
    const right = Math.min(a.x + a.width, b.x + b.width);
    if (right <= left) return null;
    return { x: left, width: right - left };
  }
  function isPerfectMatch(a, b) {
    return a.x === b.x && a.width === b.width;
  }
  function createInitialState(grid = GRID) {
    const platform = { x: 0, width: grid.cols };
    const currentBlock = {
      x: Math.floor((grid.cols - INITIAL_BLOCK_WIDTH) / 2),
      width: INITIAL_BLOCK_WIDTH
    };
    return {
      placedBlocks: [platform],
      currentBlock,
      direction: "RIGHT",
      score: 0,
      status: "IDLE",
      tickCount: 0,
      level: 1,
      lastDropPerfect: false
    };
  }
  function moveTick(state2) {
    if (state2.status !== "PLAYING" && state2.status !== "NPC_DEMO") return state2;
    const { currentBlock, direction } = state2;
    const cols = GRID.cols;
    let newX = currentBlock.x + (direction === "RIGHT" ? 1 : -1);
    let newDir = direction;
    if (newX < 0) {
      newX = 0;
      newDir = "RIGHT";
    } else if (newX + currentBlock.width > cols) {
      newX = cols - currentBlock.width;
      newDir = "LEFT";
    }
    return {
      ...state2,
      currentBlock: { ...currentBlock, x: newX },
      direction: newDir,
      tickCount: state2.tickCount + 1
    };
  }
  function dropBlock(state2) {
    if (state2.status !== "PLAYING" && state2.status !== "NPC_DEMO") return state2;
    const topPlaced = state2.placedBlocks[state2.placedBlocks.length - 1];
    const intersection = intersectBlocks(state2.currentBlock, topPlaced);
    if (!intersection) {
      return { ...state2, status: "GAME_OVER", tickCount: state2.tickCount + 1 };
    }
    const perfect = isPerfectMatch(intersection, topPlaced) && isPerfectMatch(intersection, state2.currentBlock);
    const points = intersection.width * POINTS_PER_CELL + (perfect ? PERFECT_BONUS : 0);
    const newPlaced = [...state2.placedBlocks, intersection];
    const dropCount2 = newPlaced.length - 1;
    const newLevel = computeLevel(dropCount2);
    const nextBlock = { x: intersection.x, width: intersection.width };
    const nextDir = state2.direction === "RIGHT" ? "LEFT" : "RIGHT";
    return {
      ...state2,
      placedBlocks: newPlaced,
      currentBlock: nextBlock,
      direction: nextDir,
      score: state2.score + points,
      level: newLevel,
      lastDropPerfect: perfect,
      tickCount: state2.tickCount + 1
    };
  }

  // src/ui/renderer.ts
  function lerpColor(a, b, t) {
    const parse = (hex) => [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16)
    ];
    const [ar, ag, ab] = parse(a);
    const [br, bg, bb] = parse(b);
    return `rgb(${Math.round(ar + (br - ar) * t)},${Math.round(ag + (bg - ag) * t)},${Math.round(ab + (bb - ab) * t)})`;
  }
  function computeViewOffset(state2) {
    const currentRow = state2.placedBlocks.length;
    return Math.max(0, currentRow - (GRID.rows - 3));
  }
  function rowToY(row, viewOffset) {
    return (GRID.rows - 1 - (row - viewOffset)) * GRID.cellSize;
  }
  function drawBlock(ctx2, block, row, viewOffset, color, glowColor) {
    const x = block.x * GRID.cellSize + 1;
    const y = rowToY(row, viewOffset) + 1;
    const w = block.width * GRID.cellSize - 2;
    const h = GRID.cellSize - 2;
    if (glowColor) {
      ctx2.shadowColor = glowColor;
      ctx2.shadowBlur = 14;
    }
    ctx2.fillStyle = color;
    ctx2.beginPath();
    ctx2.roundRect(x, y, w, h, 3);
    ctx2.fill();
    ctx2.shadowBlur = 0;
    ctx2.fillStyle = "rgba(255,255,255,0.12)";
    ctx2.fillRect(x + 2, y + 2, w - 4, 4);
  }
  function render(ctx2, state2, highScore) {
    const { cellSize, cols, rows } = GRID;
    const viewOffset = computeViewOffset(state2);
    ctx2.fillStyle = COLORS.background;
    ctx2.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx2.strokeStyle = COLORS.grid;
    ctx2.lineWidth = 0.5;
    ctx2.globalAlpha = 0.5;
    for (let c = 0; c <= cols; c++) {
      ctx2.beginPath();
      ctx2.moveTo(c * cellSize, 0);
      ctx2.lineTo(c * cellSize, CANVAS_HEIGHT);
      ctx2.stroke();
    }
    for (let r = 0; r <= rows; r++) {
      ctx2.beginPath();
      ctx2.moveTo(0, r * cellSize);
      ctx2.lineTo(CANVAS_WIDTH, r * cellSize);
      ctx2.stroke();
    }
    ctx2.globalAlpha = 1;
    const totalPlaced = state2.placedBlocks.length;
    const firstVisible = viewOffset;
    const lastVisible = viewOffset + rows - 1;
    for (let i = firstVisible; i < totalPlaced && i <= lastVisible; i++) {
      const t = totalPlaced > 1 ? i / (totalPlaced - 1) : 0;
      const col = i === 0 ? COLORS.platform : lerpColor(COLORS.blockBottom, COLORS.blockTop, t);
      drawBlock(ctx2, state2.placedBlocks[i], i, viewOffset, col);
    }
    if (state2.status === "PLAYING" || state2.status === "NPC_DEMO") {
      const currentRow = totalPlaced;
      const topPlaced = state2.placedBlocks[totalPlaced - 1];
      ctx2.strokeStyle = "rgba(255,255,255,0.1)";
      ctx2.lineWidth = 1;
      ctx2.strokeRect(
        topPlaced.x * cellSize + 1,
        rowToY(currentRow, viewOffset) + 1,
        topPlaced.width * cellSize - 2,
        cellSize - 2
      );
      const activeColor = state2.status === "NPC_DEMO" ? COLORS.npcBlock : COLORS.blockActive;
      drawBlock(ctx2, state2.currentBlock, currentRow, viewOffset, activeColor, activeColor);
    }
    if (state2.status === "IDLE") {
      ctx2.fillStyle = COLORS.overlay;
      ctx2.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      ctx2.textAlign = "center";
      ctx2.fillStyle = COLORS.blockActive;
      ctx2.font = 'bold 28px "Courier New", monospace';
      ctx2.fillText("STACKER", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 24);
      ctx2.fillStyle = COLORS.text;
      ctx2.font = '13px "Courier New", monospace';
      ctx2.fillText("Press SPACE to play", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 8);
    }
    if (state2.status === "PAUSED") {
      ctx2.fillStyle = COLORS.overlay;
      ctx2.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      ctx2.fillStyle = COLORS.text;
      ctx2.font = 'bold 24px "Courier New", monospace';
      ctx2.textAlign = "center";
      ctx2.fillText("PAUSED", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
      ctx2.font = '12px "Courier New", monospace';
      ctx2.fillText("SPACE to resume", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 24);
    }
    if (state2.status === "NPC_DEMO") {
      ctx2.fillStyle = "rgba(0,180,216,0.4)";
      ctx2.font = '11px "Courier New", monospace';
      ctx2.textAlign = "right";
      ctx2.fillText("NPC DEMO", CANVAS_WIDTH - 6, 14);
    }
    ctx2.shadowBlur = 0;
  }

  // src/ui/input.ts
  function attachInputHandlers(dispatch2, getStatus) {
    document.addEventListener("keydown", (e) => {
      const status = getStatus();
      switch (e.code) {
        case "Space":
          e.preventDefault();
          if (status === "IDLE" || status === "GAME_OVER" || status === "WIN") {
            dispatch2({ type: "START_GAME" });
          } else if (status === "PLAYING") {
            dispatch2({ type: "DROP_BLOCK" });
          } else if (status === "PAUSED") {
            dispatch2({ type: "RESUME_GAME" });
          }
          break;
        case "Enter":
          if (status === "IDLE" || status === "GAME_OVER" || status === "WIN") {
            dispatch2({ type: "START_GAME" });
          } else if (status === "NPC_DEMO") {
            dispatch2({ type: "START_GAME" });
          }
          break;
        case "KeyP":
          if (status === "PLAYING") {
            dispatch2({ type: "PAUSE_GAME" });
          } else if (status === "PAUSED") {
            dispatch2({ type: "RESUME_GAME" });
          }
          break;
        case "KeyR":
          dispatch2({ type: "RESET_GAME" });
          break;
        case "ArrowDown":
        case "ArrowUp":
        case "ArrowLeft":
        case "ArrowRight":
          if (status === "NPC_DEMO") {
            dispatch2({ type: "RESET_GAME" });
          }
          break;
        default:
          break;
      }
    });
  }

  // src/score/score-manager.ts
  var LS_KEY = "stacker-scores";
  var ScoreManager = class _ScoreManager {
    constructor() {
      this.board = { entries: [], highScore: 0 };
    }
    async load() {
      try {
        const res = await fetch("./api/scores");
        const data = await res.json();
        this.board = data;
        localStorage.setItem(LS_KEY, JSON.stringify(this.board));
      } catch {
        try {
          const raw = localStorage.getItem(LS_KEY) ?? "null";
          const parsed = JSON.parse(raw);
          this.board = parsed ?? { entries: [], highScore: 0 };
        } catch {
          this.board = { entries: [], highScore: 0 };
        }
      }
      return this.board;
    }
    async submit(entry) {
      try {
        const res = await fetch("./api/scores", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(entry)
        });
        const data = await res.json();
        this.board = data;
        localStorage.setItem(LS_KEY, JSON.stringify(this.board));
      } catch {
        const merged = _ScoreManager.mergeEntry(this.board.entries, entry);
        this.board = { entries: merged, highScore: merged[0]?.score ?? 0 };
        localStorage.setItem(LS_KEY, JSON.stringify(this.board));
      }
      return this.board;
    }
    getBoard() {
      return this.board;
    }
    getHighScore() {
      return this.board.highScore;
    }
    static mergeEntry(entries, entry) {
      return [...entries, entry].sort((a, b) => b.score - a.score || a.timestamp - b.timestamp).slice(0, MAX_HIGH_SCORES);
    }
  };

  // src/npc/ai.ts
  var NpcController = class {
    constructor() {
      this.cooldown = 0;
    }
    /** Returns true if the NPC should drop this tick. */
    shouldDrop(state2) {
      if (this.cooldown > 0) {
        this.cooldown--;
        return false;
      }
      const topPlaced = state2.placedBlocks[state2.placedBlocks.length - 1];
      const intersection = intersectBlocks(state2.currentBlock, topPlaced);
      if (!intersection) return false;
      const overlapRatio = intersection.width / topPlaced.width;
      if (overlapRatio >= 0.9 && Math.random() < 0.65) {
        this.cooldown = 2;
        return true;
      }
      return false;
    }
    reset() {
      this.cooldown = 0;
    }
  };

  // src/ui/main.ts
  var canvas = document.getElementById("game-canvas");
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  var ctx = canvas.getContext("2d");
  var scoreManager = new ScoreManager();
  var state = createInitialState(GRID);
  var tickTimer = null;
  var idleTimer = null;
  var currentTickInterval = computeTickInterval(0);
  var npc = new NpcController();
  function updateScoreDom(board) {
    const list = document.getElementById("score-list");
    if (!list) return;
    list.innerHTML = "";
    for (const entry of board.entries) {
      const li = document.createElement("li");
      const nameSpan = document.createElement("span");
      nameSpan.textContent = entry.name;
      const scoreSpan = document.createElement("span");
      scoreSpan.textContent = String(entry.score);
      li.appendChild(nameSpan);
      li.appendChild(scoreSpan);
      list.appendChild(li);
    }
  }
  function dropCount() {
    return state.placedBlocks.length - 1;
  }
  function updateDom() {
    const container = document.getElementById("game-container");
    container.setAttribute("data-game-status", state.status);
    const scoreEl = document.getElementById("score-display");
    if (scoreEl) scoreEl.textContent = String(state.score);
    const levelEl = document.getElementById("level-display");
    if (levelEl) levelEl.textContent = String(state.level);
    const startBtn = document.getElementById("start-btn");
    if (startBtn) {
      startBtn.hidden = !(state.status === "IDLE" || state.status === "GAME_OVER");
    }
    const overlay = document.getElementById("game-over-overlay");
    if (overlay) overlay.hidden = state.status !== "GAME_OVER";
  }
  function startGameLoop() {
    if (tickTimer !== null) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
    currentTickInterval = computeTickInterval(dropCount());
    tickTimer = window.setInterval(() => {
      if (state.status === "NPC_DEMO" && npc.shouldDrop(state)) {
        state = dropBlock(state);
      } else {
        state = moveTick(state);
      }
      render(ctx, state, scoreManager.getHighScore());
      updateDom();
      if (state.status === "GAME_OVER") {
        if (tickTimer !== null) {
          clearInterval(tickTimer);
          tickTimer = null;
        }
        onGameOver();
        return;
      }
      const newInterval = computeTickInterval(dropCount());
      if (newInterval !== currentTickInterval) {
        startGameLoop();
      }
    }, currentTickInterval);
  }
  function startNpcDemo() {
    npc.reset();
    state = { ...createInitialState(GRID), status: "NPC_DEMO" };
    updateDom();
    startGameLoop();
  }
  function startIdleTimeout() {
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    idleTimer = window.setTimeout(() => startNpcDemo(), IDLE_TIMEOUT_MS);
  }
  function onGameOver() {
    render(ctx, state, scoreManager.getHighScore());
    updateDom();
    const finalScoreEl = document.getElementById("final-score");
    if (finalScoreEl) finalScoreEl.textContent = String(state.score);
    const initialsInput = document.getElementById("initials-input");
    if (initialsInput) initialsInput.focus();
  }
  function dispatch(event) {
    switch (event.type) {
      case "START_GAME":
        if (state.status === "IDLE" || state.status === "GAME_OVER" || state.status === "NPC_DEMO") {
          if (idleTimer !== null) {
            clearTimeout(idleTimer);
            idleTimer = null;
          }
          npc.reset();
          state = { ...createInitialState(GRID), status: "PLAYING" };
          updateDom();
          startGameLoop();
        }
        break;
      case "PAUSE_GAME":
        if (state.status === "PLAYING") {
          state = { ...state, status: "PAUSED" };
          if (tickTimer !== null) {
            clearInterval(tickTimer);
            tickTimer = null;
          }
          render(ctx, state, scoreManager.getHighScore());
          updateDom();
        }
        break;
      case "RESUME_GAME":
        if (state.status === "PAUSED") {
          state = { ...state, status: "PLAYING" };
          updateDom();
          startGameLoop();
        }
        break;
      case "RESET_GAME":
        if (tickTimer !== null) {
          clearInterval(tickTimer);
          tickTimer = null;
        }
        if (idleTimer !== null) {
          clearTimeout(idleTimer);
          idleTimer = null;
        }
        npc.reset();
        state = createInitialState(GRID);
        render(ctx, state, scoreManager.getHighScore());
        updateDom();
        startIdleTimeout();
        break;
      case "DROP_BLOCK":
        if (state.status === "PLAYING") {
          state = dropBlock(state);
          render(ctx, state, scoreManager.getHighScore());
          updateDom();
          if (state.status === "GAME_OVER") {
            if (tickTimer !== null) {
              clearInterval(tickTimer);
              tickTimer = null;
            }
            onGameOver();
          } else {
            const newInterval = computeTickInterval(dropCount());
            if (newInterval !== currentTickInterval) {
              startGameLoop();
            }
          }
        }
        break;
      case "SUBMIT_SCORE":
        scoreManager.submit({ name: event.name, score: state.score, timestamp: Date.now() }).then((board) => updateScoreDom(board)).catch(() => {
        });
        state = createInitialState(GRID);
        updateDom();
        startIdleTimeout();
        break;
      default:
        break;
    }
  }
  (async () => {
    try {
      const board = await scoreManager.load();
      updateScoreDom(board);
    } catch {
    }
  })();
  attachInputHandlers(dispatch, () => state.status);
  document.getElementById("start-btn")?.addEventListener("click", () => {
    dispatch({ type: "START_GAME" });
  });
  document.getElementById("submit-score-btn")?.addEventListener("click", () => {
    const input = document.getElementById("initials-input");
    const name = (input?.value ?? "AAA").slice(0, 3).toUpperCase() || "AAA";
    if (input) input.value = "";
    dispatch({ type: "SUBMIT_SCORE", name });
    startIdleTimeout();
  });
  render(ctx, state, scoreManager.getHighScore());
  updateDom();
  startIdleTimeout();
  window.__test__ = {
    forcePerfect() {
      const topPlaced = state.placedBlocks[state.placedBlocks.length - 1];
      state = { ...state, currentBlock: { x: topPlaced.x, width: topPlaced.width } };
    },
    forcePartialOverlap() {
      const topPlaced = state.placedBlocks[state.placedBlocks.length - 1];
      const newX = Math.min(topPlaced.x + 3, GRID.cols - state.currentBlock.width);
      state = { ...state, currentBlock: { ...state.currentBlock, x: newX } };
    },
    forceDrop() {
      if (tickTimer !== null) {
        clearInterval(tickTimer);
        tickTimer = null;
      }
      state = dropBlock(state);
      render(ctx, state, scoreManager.getHighScore());
      updateDom();
      if (state.status === "GAME_OVER") {
        onGameOver();
      } else {
        startGameLoop();
      }
    },
    forceGameOver() {
      if (tickTimer !== null) {
        clearInterval(tickTimer);
        tickTimer = null;
      }
      state = { ...state, status: "GAME_OVER" };
      render(ctx, state, scoreManager.getHighScore());
      updateDom();
      onGameOver();
    },
    getState() {
      return state;
    }
  };
})();
