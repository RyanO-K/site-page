"use strict";
(() => {
  // src/shared/constants.ts
  var GRID = {
    width: 20,
    height: 20,
    cellSize: 24
  };
  var CANVAS_WIDTH = GRID.width * GRID.cellSize;
  var CANVAS_HEIGHT = GRID.height * GRID.cellSize;
  var TICK_INTERVAL_MS = 150;
  var NPC_TICK_INTERVAL_MS = 100;
  var IDLE_TIMEOUT_MS = 1e4;
  var MAX_HIGH_SCORES = 10;
  var COLORS = {
    background: "#1a1a2e",
    grid: "#16213e",
    snakeHead: "#e94560",
    snakeBody: "#c23152",
    snakeTail: "#7a2040",
    food: "#f5a623",
    npcHead: "#00b4d8",
    npcBody: "#0077b6",
    npcTail: "#0055a0",
    text: "#eaeaea",
    overlay: "rgba(0,0,0,0.6)"
  };

  // src/game/core.ts
  function step(pos, direction) {
    const deltas = {
      UP: { dx: 0, dy: -1 },
      DOWN: { dx: 0, dy: 1 },
      LEFT: { dx: -1, dy: 0 },
      RIGHT: { dx: 1, dy: 0 }
    };
    const { dx, dy } = deltas[direction];
    return { x: pos.x + dx, y: pos.y + dy };
  }
  function posEqual(a, b) {
    return a.x === b.x && a.y === b.y;
  }
  function spawnFood(state2) {
    const { grid, snake } = state2;
    let position;
    do {
      position = {
        x: Math.floor(Math.random() * grid.width),
        y: Math.floor(Math.random() * grid.height)
      };
    } while (snake.body.some((seg) => posEqual(seg, position)));
    return { ...state2, food: { position } };
  }
  function createInitialState(grid) {
    const centerX = Math.floor(grid.width / 2);
    const centerY = Math.floor(grid.height / 2);
    const body = [
      { x: centerX, y: centerY },
      { x: centerX - 1, y: centerY },
      { x: centerX - 2, y: centerY }
    ];
    const baseState = {
      snake: {
        body,
        direction: "RIGHT",
        nextDirection: "RIGHT"
      },
      food: { position: { x: 0, y: 0 } },
      // placeholder, replaced by spawnFood
      score: 0,
      status: "IDLE",
      grid,
      tickCount: 0
    };
    return spawnFood(baseState);
  }
  function setDirection(state2, direction) {
    const current = state2.snake.direction;
    if (direction === current) {
      return state2;
    }
    const opposites = {
      UP: "DOWN",
      DOWN: "UP",
      LEFT: "RIGHT",
      RIGHT: "LEFT"
    };
    if (direction === opposites[current]) return state2;
    if (direction === opposites[state2.snake.nextDirection]) return state2;
    return {
      ...state2,
      snake: { ...state2.snake, nextDirection: direction }
    };
  }
  function tick(state2) {
    if (state2.status !== "PLAYING" && state2.status !== "NPC_DEMO") {
      return state2;
    }
    const direction = state2.snake.nextDirection;
    const currentHead = state2.snake.body[0];
    const newHead = step(currentHead, direction);
    const grownBody = [newHead, ...state2.snake.body];
    if (newHead.x < 0 || newHead.x >= state2.grid.width || newHead.y < 0 || newHead.y >= state2.grid.height) {
      return {
        ...state2,
        snake: { ...state2.snake, direction, body: grownBody.slice(0, -1) },
        status: "GAME_OVER",
        tickCount: state2.tickCount + 1
      };
    }
    const bodyWithoutTail = state2.snake.body.slice(0, -1);
    const selfCollision = bodyWithoutTail.some((seg) => posEqual(seg, newHead));
    if (selfCollision) {
      return {
        ...state2,
        snake: { ...state2.snake, direction, body: grownBody.slice(0, -1) },
        status: "GAME_OVER",
        tickCount: state2.tickCount + 1
      };
    }
    if (posEqual(newHead, state2.food.position)) {
      const newSnakeState = {
        ...state2,
        snake: { ...state2.snake, direction, body: grownBody },
        score: state2.score + 10,
        tickCount: state2.tickCount + 1
      };
      return spawnFood(newSnakeState);
    }
    const newBody = grownBody.slice(0, -1);
    return {
      ...state2,
      snake: { ...state2.snake, direction, body: newBody },
      tickCount: state2.tickCount + 1
    };
  }

  // src/ui/renderer.ts
  function render(ctx2, state2, highScore) {
    const { grid, snake, food, score, status } = state2;
    const { cellSize, width, height } = grid;
    const canvasW = width * cellSize;
    const canvasH = height * cellSize;
    ctx2.fillStyle = COLORS.background;
    ctx2.fillRect(0, 0, canvasW, canvasH);
    ctx2.save();
    ctx2.globalAlpha = 0.5;
    ctx2.strokeStyle = COLORS.grid;
    ctx2.lineWidth = 0.5;
    for (let x = 0; x <= width; x++) {
      ctx2.beginPath();
      ctx2.moveTo(x * cellSize, 0);
      ctx2.lineTo(x * cellSize, canvasH);
      ctx2.stroke();
    }
    for (let y = 0; y <= height; y++) {
      ctx2.beginPath();
      ctx2.moveTo(0, y * cellSize);
      ctx2.lineTo(canvasW, y * cellSize);
      ctx2.stroke();
    }
    ctx2.restore();
    const foodRadius = cellSize * 0.35;
    const fx = food.position.x * cellSize + cellSize / 2;
    const fy = food.position.y * cellSize + cellSize / 2;
    ctx2.fillStyle = COLORS.food;
    ctx2.beginPath();
    ctx2.arc(fx, fy, foodRadius, 0, Math.PI * 2);
    ctx2.fill();
    const isNpc = status === "NPC_DEMO";
    const headColor = isNpc ? COLORS.npcHead : COLORS.snakeHead;
    const tailColor = isNpc ? COLORS.npcTail : COLORS.snakeTail;
    const radius = cellSize * 0.2;
    const len = snake.body.length;
    for (let i = 1; i < len; i++) {
      const t = len > 2 ? (i - 1) / (len - 2) : 1;
      ctx2.fillStyle = lerpColor(headColor, tailColor, t);
      const seg = snake.body[i];
      drawRoundedRect(ctx2, seg.x * cellSize + 1, seg.y * cellSize + 1, cellSize - 2, cellSize - 2, radius);
      ctx2.fill();
    }
    if (len > 0) {
      const head = snake.body[0];
      ctx2.fillStyle = headColor;
      drawRoundedRect(ctx2, head.x * cellSize + 1, head.y * cellSize + 1, cellSize - 2, cellSize - 2, radius + 1);
      ctx2.fill();
      ctx2.save();
      ctx2.globalAlpha = 0.3;
      ctx2.fillStyle = "#ffffff";
      drawRoundedRect(ctx2, head.x * cellSize + 3, head.y * cellSize + 3, cellSize - 6, cellSize - 6, radius);
      ctx2.fill();
      ctx2.restore();
    }
    ctx2.fillStyle = COLORS.text;
    ctx2.font = `bold ${Math.max(11, cellSize * 0.55)}px 'Courier New', monospace`;
    ctx2.textBaseline = "top";
    ctx2.fillText(`SCORE: ${score}  BEST: ${highScore}`, 6, 6);
    if (status === "IDLE") {
      drawDimOverlay(ctx2, canvasW, canvasH);
      drawCenteredText(ctx2, "SNAKE", canvasW / 2, canvasH / 2 - 36, `bold ${cellSize * 2.5}px 'Courier New', monospace`, COLORS.snakeHead);
      drawCenteredText(ctx2, "Press SPACE to play", canvasW / 2, canvasH / 2 + 20, `${cellSize * 0.8}px 'Courier New', monospace`, COLORS.text);
    } else if (status === "GAME_OVER") {
      drawDimOverlay(ctx2, canvasW, canvasH);
      drawCenteredText(ctx2, "GAME OVER", canvasW / 2, canvasH / 2 - 44, `bold ${cellSize * 1.8}px 'Courier New', monospace`, COLORS.snakeHead);
      drawCenteredText(ctx2, `Score: ${score}`, canvasW / 2, canvasH / 2 + 4, `${cellSize}px 'Courier New', monospace`, COLORS.text);
      drawCenteredText(ctx2, "Press SPACE to restart", canvasW / 2, canvasH / 2 + 32, `${cellSize * 0.75}px 'Courier New', monospace`, COLORS.text);
    } else if (status === "PAUSED") {
      drawDimOverlay(ctx2, canvasW, canvasH);
      drawCenteredText(ctx2, "PAUSED", canvasW / 2, canvasH / 2 - 24, `bold ${cellSize * 2}px 'Courier New', monospace`, COLORS.text);
      drawCenteredText(ctx2, "Press SPACE to resume", canvasW / 2, canvasH / 2 + 20, `${cellSize * 0.75}px 'Courier New', monospace`, COLORS.text);
    } else if (status === "NPC_DEMO") {
      const tag = "NPC DEMO";
      const tagFont = `${cellSize * 0.65}px 'Courier New', monospace`;
      ctx2.font = tagFont;
      const tagW = ctx2.measureText(tag).width + 12;
      ctx2.save();
      ctx2.globalAlpha = 0.7;
      ctx2.fillStyle = COLORS.npcBody;
      ctx2.fillRect(canvasW - tagW - 4, 4, tagW, cellSize * 0.85);
      ctx2.restore();
      ctx2.fillStyle = COLORS.text;
      ctx2.font = tagFont;
      ctx2.textBaseline = "top";
      ctx2.textAlign = "right";
      ctx2.fillText(tag, canvasW - 10, 7);
      ctx2.textAlign = "left";
    }
  }
  function lerpColor(a, b, t) {
    const ah = parseInt(a.slice(1), 16);
    const bh = parseInt(b.slice(1), 16);
    const ar = ah >> 16 & 255, ag = ah >> 8 & 255, ab = ah & 255;
    const br = bh >> 16 & 255, bg = bh >> 8 & 255, bb = bh & 255;
    const r = Math.round(ar + (br - ar) * t);
    const g = Math.round(ag + (bg - ag) * t);
    const bl = Math.round(ab + (bb - ab) * t);
    return `#${(1 << 24 | r << 16 | g << 8 | bl).toString(16).slice(1)}`;
  }
  function drawRoundedRect(ctx2, x, y, w, h, r) {
    ctx2.beginPath();
    ctx2.moveTo(x + r, y);
    ctx2.lineTo(x + w - r, y);
    ctx2.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx2.lineTo(x + w, y + h - r);
    ctx2.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx2.lineTo(x + r, y + h);
    ctx2.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx2.lineTo(x, y + r);
    ctx2.quadraticCurveTo(x, y, x + r, y);
    ctx2.closePath();
  }
  function drawDimOverlay(ctx2, w, h) {
    ctx2.fillStyle = COLORS.overlay;
    ctx2.fillRect(0, 0, w, h);
  }
  function drawCenteredText(ctx2, text, x, y, font, color) {
    ctx2.font = font;
    ctx2.fillStyle = color;
    ctx2.textAlign = "center";
    ctx2.textBaseline = "middle";
    ctx2.fillText(text, x, y);
    ctx2.textAlign = "left";
    ctx2.textBaseline = "alphabetic";
  }

  // src/ui/input.ts
  function attachInputHandlers(dispatch2, getStatus) {
    const handler = (e) => {
      const status = getStatus();
      switch (e.key) {
        case "ArrowUp":
        case "w":
        case "W":
          e.preventDefault();
          dispatch2({ type: "SET_DIRECTION", direction: "UP" });
          break;
        case "ArrowDown":
        case "s":
        case "S":
          e.preventDefault();
          dispatch2({ type: "SET_DIRECTION", direction: "DOWN" });
          break;
        case "ArrowLeft":
        case "a":
        case "A":
          e.preventDefault();
          dispatch2({ type: "SET_DIRECTION", direction: "LEFT" });
          break;
        case "ArrowRight":
        case "d":
        case "D":
          e.preventDefault();
          dispatch2({ type: "SET_DIRECTION", direction: "RIGHT" });
          break;
        case " ":
        case "Enter":
          e.preventDefault();
          if (status === "IDLE" || status === "GAME_OVER") {
            dispatch2({ type: "START_GAME" });
          } else if (status === "PLAYING") {
            dispatch2({ type: "PAUSE_GAME" });
          } else if (status === "PAUSED") {
            dispatch2({ type: "RESUME_GAME" });
          }
          break;
        case "r":
        case "R":
          dispatch2({ type: "RESET_GAME" });
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }

  // src/score/score-manager.ts
  var LS_KEY = "snake-scores";
  var ScoreManager = class _ScoreManager {
    constructor() {
      this.board = { entries: [], highScore: 0 };
    }
    /** Fetch current scoreboard from server. Falls back to localStorage. */
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
          if (parsed !== null) {
            this.board = parsed;
          } else {
            this.board = { entries: [], highScore: 0 };
          }
        } catch {
          this.board = { entries: [], highScore: 0 };
        }
      }
      return this.board;
    }
    /** Submit a new score entry to the server and update local state. */
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
        this.updateBoard(merged);
      }
      return this.board;
    }
    /** Returns the current in-memory scoreboard. */
    getBoard() {
      return this.board;
    }
    /** Returns the current high score. */
    getHighScore() {
      return this.board.highScore;
    }
    /**
     * Merge a new entry into an existing array, sort descending by score,
     * trim to MAX_HIGH_SCORES. Pure function, no side effects.
     */
    static mergeEntry(entries, entry) {
      return [...entries, entry].sort((a, b) => b.score - a.score || a.timestamp - b.timestamp).slice(0, MAX_HIGH_SCORES);
    }
    /**
     * Sets this.board from a sorted entries array, saves to localStorage,
     * and returns the updated board.
     */
    updateBoard(entries) {
      this.board = {
        entries,
        highScore: entries[0]?.score ?? 0
      };
      localStorage.setItem(LS_KEY, JSON.stringify(this.board));
      return this.board;
    }
  };

  // src/npc/ai.ts
  function key(pos) {
    return `${pos.x},${pos.y}`;
  }
  function safeNeighbours(pos, state2) {
    const { grid, snake } = state2;
    const occupied = new Set(snake.body.map(key));
    const candidates = [
      { pos: { x: pos.x, y: pos.y - 1 }, dir: "UP" },
      { pos: { x: pos.x, y: pos.y + 1 }, dir: "DOWN" },
      { pos: { x: pos.x - 1, y: pos.y }, dir: "LEFT" },
      { pos: { x: pos.x + 1, y: pos.y }, dir: "RIGHT" }
    ];
    return candidates.filter(
      ({ pos: p }) => p.x >= 0 && p.x < grid.width && p.y >= 0 && p.y < grid.height && !occupied.has(key(p))
    );
  }
  function computeNpcDirection(state2) {
    const { snake, food, grid } = state2;
    const head = snake.body[0];
    const foodKey = key(food.position);
    const visited = new Set(snake.body.map(key));
    const firstStep = /* @__PURE__ */ new Map();
    const queue = [head];
    visited.add(key(head));
    let qi = 0;
    for (const { pos: nb, dir } of safeNeighbours(head, state2)) {
      const k = key(nb);
      if (!visited.has(k)) {
        visited.add(k);
        firstStep.set(k, dir);
        queue.push(nb);
      }
    }
    while (qi < queue.length) {
      const current = queue[qi++];
      const currentKey = key(current);
      if (currentKey === foodKey) {
        return firstStep.get(foodKey);
      }
      const neighbours = [
        { pos: { x: current.x, y: current.y - 1 }, dir: "UP" },
        { pos: { x: current.x, y: current.y + 1 }, dir: "DOWN" },
        { pos: { x: current.x - 1, y: current.y }, dir: "LEFT" },
        { pos: { x: current.x + 1, y: current.y }, dir: "RIGHT" }
      ];
      for (const { pos: nb } of neighbours) {
        if (nb.x >= 0 && nb.x < grid.width && nb.y >= 0 && nb.y < grid.height) {
          const k = key(nb);
          if (!visited.has(k)) {
            visited.add(k);
            firstStep.set(k, firstStep.get(currentKey));
            queue.push(nb);
          }
        }
      }
    }
    const safeNbs = safeNeighbours(head, state2);
    if (safeNbs.length > 0) {
      let bestDir = safeNbs[0].dir;
      let bestCount = -1;
      const bodyOccupied = new Set(snake.body.map(key));
      for (const { pos: nb, dir } of safeNbs) {
        const ffVisited = new Set(bodyOccupied);
        ffVisited.add(key(nb));
        const ffQueue = [nb];
        let fqi = 0;
        let count = 0;
        while (fqi < ffQueue.length) {
          const cur = ffQueue[fqi++];
          count++;
          const ffNeighbours = [
            { x: cur.x, y: cur.y - 1 },
            { x: cur.x, y: cur.y + 1 },
            { x: cur.x - 1, y: cur.y },
            { x: cur.x + 1, y: cur.y }
          ];
          for (const p of ffNeighbours) {
            if (p.x >= 0 && p.x < grid.width && p.y >= 0 && p.y < grid.height) {
              const k = key(p);
              if (!ffVisited.has(k)) {
                ffVisited.add(k);
                ffQueue.push(p);
              }
            }
          }
        }
        if (count > bestCount) {
          bestCount = count;
          bestDir = dir;
        }
      }
      return bestDir;
    }
    return snake.direction;
  }
  var NpcController = class {
    /** Returns the next direction the NPC wants to move. */
    getNextDirection(state2) {
      return computeNpcDirection(state2);
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
  var npcController = new NpcController();
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
  function updateDom() {
    const container = document.getElementById("game-container");
    container.setAttribute("data-game-status", state.status);
    container.setAttribute("data-snake-direction", state.snake.direction);
    const scoreEl = document.getElementById("score-display");
    if (scoreEl) scoreEl.textContent = String(state.score);
    const startBtn = document.getElementById("start-btn");
    if (startBtn) startBtn.hidden = !(state.status === "IDLE" || state.status === "GAME_OVER");
    const overlay = document.getElementById("game-over-overlay");
    if (overlay) overlay.hidden = state.status !== "GAME_OVER";
  }
  function startGameLoop() {
    if (tickTimer !== null) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
    const interval = state.status === "NPC_DEMO" ? NPC_TICK_INTERVAL_MS : TICK_INTERVAL_MS;
    tickTimer = window.setInterval(() => {
      if (state.status === "NPC_DEMO") {
        state = setDirection(state, npcController.getNextDirection(state));
      }
      state = tick(state);
      render(ctx, state, scoreManager.getHighScore());
      updateDom();
      if (state.status === "GAME_OVER") {
        if (tickTimer !== null) {
          clearInterval(tickTimer);
          tickTimer = null;
        }
        onGameOver();
      }
    }, interval);
  }
  function startNpcDemo() {
    state = { ...createInitialState(GRID), status: "NPC_DEMO" };
    updateDom();
    startGameLoop();
  }
  function startIdleTimeout() {
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    idleTimer = window.setTimeout(() => {
      startNpcDemo();
    }, IDLE_TIMEOUT_MS);
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
        if (state.status === "IDLE" || state.status === "GAME_OVER") {
          if (idleTimer !== null) {
            clearTimeout(idleTimer);
            idleTimer = null;
          }
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
        state = createInitialState(GRID);
        render(ctx, state, scoreManager.getHighScore());
        updateDom();
        startIdleTimeout();
        break;
      case "SET_DIRECTION":
        if (state.status === "NPC_DEMO") {
          if (tickTimer !== null) {
            clearInterval(tickTimer);
            tickTimer = null;
          }
          state = createInitialState(GRID);
          render(ctx, state, scoreManager.getHighScore());
          updateDom();
          startIdleTimeout();
        } else if (state.status !== "PAUSED") {
          state = setDirection(state, event.direction);
          updateDom();
        }
        break;
      case "SUBMIT_SCORE":
        scoreManager.submit({ name: event.name, score: state.score, timestamp: Date.now() }).then((board) => updateScoreDom(board)).catch(() => {
        });
        state = createInitialState(GRID);
        updateDom();
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
    forceEatFood() {
      const head = state.snake.body[0];
      const nextPos = step(head, state.snake.direction);
      state = { ...state, food: { position: nextPos } };
    },
    forceWallCollision() {
      state = {
        ...state,
        snake: {
          ...state.snake,
          body: [{ x: state.grid.width - 1, y: Math.floor(state.grid.height / 2) }, ...state.snake.body.slice(1)],
          direction: "RIGHT",
          nextDirection: "RIGHT"
        }
      };
    },
    forceSelfCollision() {
      if (tickTimer !== null) {
        clearInterval(tickTimer);
        tickTimer = null;
      }
      state = { ...state, status: "GAME_OVER" };
      render(ctx, state, scoreManager.getHighScore());
      updateDom();
      const finalScoreEl = document.getElementById("final-score");
      if (finalScoreEl) finalScoreEl.textContent = String(state.score);
    }
  };
})();
