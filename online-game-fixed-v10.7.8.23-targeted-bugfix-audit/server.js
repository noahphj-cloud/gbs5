const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const queues = {
  axis4: [],
  gomoku: [],
  quoridor: [],
  dab: [],
  blokus: [],
  orbito: [],
  halma: [],
  airhockey: []
};

const rooms = {};
const players = {};

const QUEUE_TTL_MS = 20 * 1000;
const MATCHED_NO_SSE_TTL_MS = 45 * 1000;
const ENDED_PLAYER_TTL_MS = 60 * 1000;
const MAX_BODY_BYTES = 64 * 1024;
const API_ENDPOINTS = ['join', 'events', 'state', 'queue-status', 'move', 'chat', 'leave', 'airhockey-ws'];

function normalizePlayerName(value) {
  const cleaned = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 20);
  return cleaned || '플레이어';
}

function getRoomPlayerNames(room) {
  if (!room || !Array.isArray(room.players)) return [];
  return room.players.map((pid, index) => {
    const player = players[pid];
    return {
      playerId: pid,
      playerIndex: index,
      playerName: player && player.playerName ? player.playerName : ('플레이어 ' + (index + 1))
    };
  });
}


const DAB_BOX_ROWS = 5;
const DAB_BOX_COLS = 7;
const DAB_DOT_ROWS = DAB_BOX_ROWS + 1;
const DAB_DOT_COLS = DAB_BOX_COLS + 1;

const AXIS4_GRID = 10;
const GOMOKU_GRID = 19;
const QUORIDOR_N = 9;
const ORBITO_GRID = 4;
const HALMA_ROWS = [1,2,3,4,13,12,11,10,9,10,11,12,13,4,3,2,1];
const BLOKUS_BOARD_SIZE = 14;
const BLOKUS_PIECES = [
  [[0,0]],
  [[0,0],[1,0]],
  [[0,0],[1,0],[2,0]],
  [[0,0],[1,0],[0,1]],
  [[0,0],[1,0],[0,1],[1,1]],
  [[0,0],[1,0],[2,0],[3,0]],
  [[0,0],[1,0],[2,0],[0,1]],
  [[0,0],[1,0],[2,0],[1,1]],
  [[0,0],[1,0],[1,1],[2,1]],
  [[1,0],[0,1],[1,1],[1,2],[2,2]],
  [[0,0],[1,0],[2,0],[3,0],[4,0]],
  [[0,0],[0,1],[0,2],[0,3],[1,0]],
  [[0,0],[0,1],[1,1],[1,2],[1,3]],
  [[0,0],[1,0],[0,1],[1,1],[0,2]],
  [[0,0],[1,0],[2,0],[1,1],[1,2]],
  [[0,0],[0,1],[1,1],[2,0],[2,1]],
  [[0,0],[0,1],[0,2],[1,0],[2,0]],
  [[0,0],[1,0],[1,1],[2,1],[2,2]],
  [[1,0],[0,1],[1,1],[2,1],[1,2]],
  [[0,0],[0,1],[0,2],[0,3],[1,1]],
  [[0,0],[1,0],[1,1],[1,2],[2,2]]
];
const BLOKUS_PLAYER_DATA = [
  // start is stored as [row, col] to match board[y][x]
  { id: 1, name: '빨강', color: '#f87171', start: [4, 4] },
  { id: 2, name: '파랑', color: '#60a5fa', start: [9, 9] }
];
const QUORIDOR_START = [
  { x: 4, y: 0, goal: 8, walls: 10 },
  { x: 4, y: 8, goal: 0, walls: 10 }
];

const AIR_W = 420;
const AIR_H = 700;
const AIR_GOAL_W = 210;
const AIR_PUCK_R = 14;
const AIR_PAD_R = 26;
const AIR_FRICTION = 0.994;
const AIR_SPIN_FRICTION = 0.986;
const AIR_MAX_PUCK_SPEED = 18;
const AIR_MAX_PUCK_SPIN = 1.25;
const AIR_PUCK_RESTITUTION = 0.88;
const AIR_WALL_RESTITUTION = 0.94;
const AIR_WALL_TANGENT_DAMPING = 0.985;
const AIR_WALL_SPIN_TRANSFER = 0.006;
const AIR_PADDLE_TRANSFER = 0.25;
const AIR_TANGENT_DAMPING = 0.72;
const AIR_TANGENT_TRANSFER = 0.45;
const AIR_SPIN_TRANSFER = 0.018;
const AIR_SPIN_TO_TANGENT = 0.04;
const AIR_CONTACT_MARGIN = 0.8;
const AIR_MIN_SHOT_SPEED = 4.8;
const AIR_MAX_PADDLE_SPEED = 24;
const AIR_SERVE_DELAY_MS = 1000;
// 에어하키는 속도/충돌 계산을 30fps 기준 단위로 유지하되,
// 실제 서버 tick은 60fps로 돌려 입력 반영 지연을 줄인다.
const AIR_BASE_TICK_MS = 1000 / 30;
const AIR_TICK_MS = 1000 / 60;
const AIR_BROADCAST_MS = 1000 / 24;
const AIR_SOCKET_IDLE_MS = 30 * 1000;


const HALMA_DIRS = [[2,0],[-2,0],[1,1],[-1,1],[1,-1],[-1,-1]];
const halmaCells = [];
const halmaCellMap = new Map();
for (let row = 0; row < HALMA_ROWS.length; row += 1) {
  const len = HALMA_ROWS[row];
  const startGX = -(len - 1);
  for (let i = 0; i < len; i += 1) {
    const gx = startGX + i * 2;
    const id = halmaCells.length;
    halmaCells.push({ id, row, i, gx, gy: row, neighbors: [] });
    halmaCellMap.set(`${gx},${row}`, id);
  }
}
halmaCells.forEach((cell) => {
  HALMA_DIRS.forEach(([dx, dy]) => {
    const nid = halmaCellMap.get(`${cell.gx + dx},${cell.gy + dy}`);
    if (nid != null) cell.neighbors.push(nid);
  });
});
const halmaHomes = {
  top: halmaCells.filter((c) => c.row <= 3).map((c) => c.id),
  bottom: halmaCells.filter((c) => c.row >= 13).map((c) => c.id)
};
const halmaColorDefs = [
  { name: '빨강', fill: '#ef4444', stroke: '#7f1d1d' },
  { name: '파랑', fill: '#3b82f6', stroke: '#1d4ed8' }
];


function createBlokusPlayerState(base) {
  return {
    id: base.id,
    name: base.name,
    color: base.color,
    start: base.start.slice(),
    firstMove: true,
    used: Array(BLOKUS_PIECES.length).fill(false),
    remainingCells: 89,
    eliminated: false
  };
}

function createBlokusState() {
  return {
    mode: 2,
    boardSize: BLOKUS_BOARD_SIZE,
    board: Array.from({ length: BLOKUS_BOARD_SIZE }, () => Array(BLOKUS_BOARD_SIZE).fill(0)),
    players: BLOKUS_PLAYER_DATA.map(createBlokusPlayerState),
    current: 0,
    gameOver: false,
    winner: 0,
    draw: false
  };
}

function blokusCloneCells(cells) {
  return cells.map((c) => [c[0], c[1]]);
}

function blokusNormalize(cells) {
  let minX = Infinity;
  let minY = Infinity;
  cells.forEach((c) => {
    if (c[0] < minX) minX = c[0];
    if (c[1] < minY) minY = c[1];
  });
  return cells
    .map((c) => [c[0] - minX, c[1] - minY])
    .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

function blokusTransformCells(cells, rot, flip) {
  const out = blokusCloneCells(cells).map((c) => {
    let x = c[0];
    let y = c[1];
    if (flip) x = -x;
    for (let i = 0; i < rot; i += 1) {
      const tmp = x;
      x = y;
      y = -tmp;
    }
    return [x, y];
  });
  return blokusNormalize(out);
}

function blokusGetPlacementCells(pieceIndex, rotation, flipped, row, col) {
  const shape = blokusTransformCells(BLOKUS_PIECES[pieceIndex], rotation, flipped);
  return shape.map((c) => [col + c[0], row + c[1]]);
}

function blokusIsLegalPlacement(board, boardSize, player, placement) {
  if (!player || player.eliminated) return false;
  let touchCorner = false;
  let coversStart = false;
  for (let i = 0; i < placement.length; i += 1) {
    const x = placement[i][0];
    const y = placement[i][1];
    if (x < 0 || x >= boardSize || y < 0 || y >= boardSize) return false;
    if (board[y][x] !== 0) return false;
    if (y === player.start[0] && x === player.start[1]) coversStart = true;
  }
  const dirs4 = [[1,0],[-1,0],[0,1],[0,-1]];
  const dirsDiag = [[1,1],[1,-1],[-1,1],[-1,-1]];
  for (let i = 0; i < placement.length; i += 1) {
    const px = placement[i][0];
    const py = placement[i][1];
    for (let d = 0; d < dirs4.length; d += 1) {
      const nx = px + dirs4[d][0];
      const ny = py + dirs4[d][1];
      if (nx >= 0 && nx < boardSize && ny >= 0 && ny < boardSize && board[ny][nx] === player.id) return false;
    }
    for (let d = 0; d < dirsDiag.length; d += 1) {
      const dx = px + dirsDiag[d][0];
      const dy = py + dirsDiag[d][1];
      if (dx >= 0 && dx < boardSize && dy >= 0 && dy < boardSize && board[dy][dx] === player.id) {
        touchCorner = true;
      }
    }
  }
  if (player.firstMove) return coversStart;
  return touchCorner;
}

function blokusHasLegalMove(state, playerIndex) {
  const player = state.players[playerIndex];
  if (!player || player.eliminated) return false;
  for (let pieceIndex = 0; pieceIndex < BLOKUS_PIECES.length; pieceIndex += 1) {
    if (player.used[pieceIndex]) continue;
    const seen = new Set();
    for (let flip = 0; flip < 2; flip += 1) {
      for (let rot = 0; rot < 4; rot += 1) {
        const shape = blokusTransformCells(BLOKUS_PIECES[pieceIndex], rot, !!flip);
        const key = JSON.stringify(shape);
        if (seen.has(key)) continue;
        seen.add(key);
        let maxX = 0;
        let maxY = 0;
        shape.forEach((c) => {
          if (c[0] > maxX) maxX = c[0];
          if (c[1] > maxY) maxY = c[1];
        });
        for (let row = 0; row <= state.boardSize - (maxY + 1); row += 1) {
          for (let col = 0; col <= state.boardSize - (maxX + 1); col += 1) {
            const placement = shape.map((c) => [col + c[0], row + c[1]]);
            if (blokusIsLegalPlacement(state.board, state.boardSize, player, placement)) return true;
          }
        }
      }
    }
  }
  return false;
}

function blokusNextAliveIndex(playersList, idx) {
  if (!playersList.length) return 0;
  for (let step = 1; step <= playersList.length; step += 1) {
    const next = (idx + step) % playersList.length;
    if (!playersList[next].eliminated) return next;
  }
  return idx;
}

function blokusResolveTurnState(state) {
  if (state.gameOver) return;
  let guard = 0;
  while (guard < state.players.length) {
    const player = state.players[state.current];
    if (!player) break;
    if (player.eliminated) {
      state.current = blokusNextAliveIndex(state.players, state.current);
      guard += 1;
      continue;
    }
    if (blokusHasLegalMove(state, state.current)) return;
    player.eliminated = true;
    const alive = state.players.filter((p) => !p.eliminated);
    if (alive.length <= 1) {
      state.gameOver = true;
      state.draw = alive.length === 0;
      state.winner = alive.length === 1 ? alive[0].id : 0;
      return;
    }
    state.current = blokusNextAliveIndex(state.players, state.current);
    guard += 1;
  }
  if (!state.gameOver) {
    state.gameOver = true;
    state.draw = true;
    state.winner = 0;
  }
}

function applyBlokusMove(state, payload, playerIndex) {
  if (state.gameOver) return { ok: false, status: 409, error: 'game already over' };
  if (!payload || typeof payload !== 'object') return { ok: false, status: 400, error: 'invalid blokus payload' };
  if (state.current !== playerIndex) return { ok: false, status: 409, error: 'blokus current player mismatch' };

  const pieceIndex = Number(payload.pieceIndex);
  const row = Number(payload.row);
  const col = Number(payload.col);
  const rotation = ((Number(payload.rotation) % 4) + 4) % 4;
  const flipped = !!payload.flipped;
  if (!Number.isInteger(pieceIndex) || pieceIndex < 0 || pieceIndex >= BLOKUS_PIECES.length) {
    return { ok: false, status: 400, error: 'invalid blokus piece' };
  }
  if (!Number.isInteger(row) || !Number.isInteger(col)) {
    return { ok: false, status: 400, error: 'invalid blokus coordinates' };
  }

  const player = state.players[playerIndex];
  if (!player || player.eliminated) return { ok: false, status: 409, error: 'player already eliminated' };
  if (player.used[pieceIndex]) return { ok: false, status: 409, error: 'piece already used' };

  const placement = blokusGetPlacementCells(pieceIndex, rotation, flipped, row, col);
  if (!blokusIsLegalPlacement(state.board, state.boardSize, player, placement)) {
    return { ok: false, status: 409, error: 'illegal blokus placement' };
  }

  placement.forEach((c) => {
    state.board[c[1]][c[0]] = player.id;
  });
  player.used[pieceIndex] = true;
  player.firstMove = false;
  player.remainingCells -= placement.length;
  state.current = blokusNextAliveIndex(state.players, state.current);
  blokusResolveTurnState(state);

  return {
    ok: true,
    authoritativeMove: { kind: 'blokus', payload: { pieceIndex, row, col, rotation, flipped, playerIndex } },
    keepTurn: false,
    gameOver: state.gameOver,
    nextTurnIndex: state.current
  };
}

function createOrbitoState() {
  return {
    board: Array.from({ length: ORBITO_GRID }, () => Array(ORBITO_GRID).fill(0)),
    current: 1,
    reserves: { 1: 8, 2: 8 },
    stage: 'move',
    gameOver: false,
    winner: 0,
    draw: false,
    selectedEnemy: null,
    pendingEnemyTarget: null,
    pendingPlace: null,
    extraRotationsLeft: 0
  };
}

const ORBITO_OUTER = [[0,0],[0,1],[0,2],[0,3],[1,3],[2,3],[3,3],[3,2],[3,1],[3,0],[2,0],[1,0]];
const ORBITO_INNER = [[1,1],[1,2],[2,2],[2,1]];
function orbitoCloneBoard(src) { return src.map((row) => row.slice()); }
function orbitoMoveOnOrbit(x, y) {
  for (let i = 0; i < ORBITO_OUTER.length; i += 1) {
    if (ORBITO_OUTER[i][0] === x && ORBITO_OUTER[i][1] === y) {
      const n = ORBITO_OUTER[(i + 1) % ORBITO_OUTER.length];
      return { x: n[0], y: n[1] };
    }
  }
  for (let i = 0; i < ORBITO_INNER.length; i += 1) {
    if (ORBITO_INNER[i][0] === x && ORBITO_INNER[i][1] === y) {
      const n = ORBITO_INNER[(i + 1) % ORBITO_INNER.length];
      return { x: n[0], y: n[1] };
    }
  }
  return { x, y };
}
function orbitoHasAdjacentEmpty(board, x, y) {
  for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
    const nx = x + dx; const ny = y + dy;
    if (nx >= 0 && nx < ORBITO_GRID && ny >= 0 && ny < ORBITO_GRID && board[ny][nx] === 0) return true;
  }
  return false;
}
function orbitoIsAdjacent(x1, y1, x2, y2) { return Math.abs(x1 - x2) + Math.abs(y1 - y2) === 1; }
function orbitoRotateBoard(board) {
  const next = Array.from({ length: ORBITO_GRID }, () => Array(ORBITO_GRID).fill(0));
  for (let y = 0; y < ORBITO_GRID; y += 1) {
    for (let x = 0; x < ORBITO_GRID; x += 1) {
      const val = board[y][x];
      if (!val) continue;
      const moved = orbitoMoveOnOrbit(x, y);
      next[moved.y][moved.x] = val;
    }
  }
  return next;
}
function orbitoLineVal(a, b, c, d, v) { return a === v && b === v && c === v && d === v; }
function orbitoCheckLines(board) {
  let red = false; let blue = false;
  for (let y = 0; y < ORBITO_GRID; y += 1) {
    if (orbitoLineVal(board[y][0], board[y][1], board[y][2], board[y][3], 1)) red = true;
    if (orbitoLineVal(board[y][0], board[y][1], board[y][2], board[y][3], 2)) blue = true;
  }
  for (let x = 0; x < ORBITO_GRID; x += 1) {
    if (orbitoLineVal(board[0][x], board[1][x], board[2][x], board[3][x], 1)) red = true;
    if (orbitoLineVal(board[0][x], board[1][x], board[2][x], board[3][x], 2)) blue = true;
  }
  if (orbitoLineVal(board[0][0], board[1][1], board[2][2], board[3][3], 1)) red = true;
  if (orbitoLineVal(board[0][0], board[1][1], board[2][2], board[3][3], 2)) blue = true;
  if (orbitoLineVal(board[0][3], board[1][2], board[2][1], board[3][0], 1)) red = true;
  if (orbitoLineVal(board[0][3], board[1][2], board[2][1], board[3][0], 2)) blue = true;
  return { red, blue };
}
function applyOrbitoMove(state, payload, playerIndex) {
  if (state.gameOver) return { ok: false, status: 409, error: 'game already over' };
  const player = playerIndex + 1;
  if (state.current !== player) return { ok: false, status: 409, error: 'orbito current player mismatch' };
  if (!payload || typeof payload !== 'object') return { ok: false, status: 400, error: 'invalid orbito payload' };

  const action = payload.action || (payload.rotateOnly ? 'rotate' : (payload.place ? 'place' : (payload.moveEnemy ? 'move_enemy' : '')));
  if (!action) return { ok: false, status: 400, error: 'invalid orbito action' };

  const board = orbitoCloneBoard(state.board);
  const reserves = { 1: state.reserves[1], 2: state.reserves[2] };
  let keepTurn = false;
  let gameOver = false;

  if (action === 'move_enemy') {
    if (state.stage !== 'move') return { ok: false, status: 409, error: 'enemy move only allowed in move stage' };
    const enemy = player === 1 ? 2 : 1;
    if (!payload.moveEnemy || typeof payload.moveEnemy !== 'object') return { ok: false, status: 400, error: 'enemy move required' };
    const from = payload.moveEnemy.from || {};
    const to = payload.moveEnemy.to || {};
    const fx = Number(from.x), fy = Number(from.y), tx = Number(to.x), ty = Number(to.y);
    if (![fx, fy, tx, ty].every(Number.isInteger)) return { ok: false, status: 400, error: 'invalid orbito enemy move' };
    if (fx < 0 || fx >= ORBITO_GRID || fy < 0 || fy >= ORBITO_GRID || tx < 0 || tx >= ORBITO_GRID || ty < 0 || ty >= ORBITO_GRID) return { ok: false, status: 400, error: 'invalid orbito enemy move' };
    if (board[fy][fx] !== enemy) return { ok: false, status: 409, error: 'enemy source mismatch' };
    if (board[ty][tx] !== 0) return { ok: false, status: 409, error: 'enemy target occupied' };
    if (!orbitoIsAdjacent(fx, fy, tx, ty)) return { ok: false, status: 409, error: 'enemy move not adjacent' };
    board[fy][fx] = 0;
    board[ty][tx] = enemy;
    state.board = board;
    state.stage = 'place';
    state.selectedEnemy = null;
    state.pendingEnemyTarget = null;
    state.pendingPlace = null;
    state.reserves = reserves;
    keepTurn = true;
  } else if (action === 'skip_enemy') {
    if (state.stage !== 'move') return { ok: false, status: 409, error: 'enemy skip only allowed in move stage' };
    state.board = board;
    state.stage = 'place';
    state.selectedEnemy = null;
    state.pendingEnemyTarget = null;
    state.pendingPlace = null;
    state.reserves = reserves;
    keepTurn = true;
  } else if (action === 'place') {
    if (state.stage !== 'place') return { ok: false, status: 409, error: 'place only allowed in place stage' };
    if (reserves[player] <= 0) return { ok: false, status: 409, error: 'no stones remaining' };
    if (!payload.place || typeof payload.place !== 'object') return { ok: false, status: 400, error: 'place required' };
    const px = Number(payload.place.x), py = Number(payload.place.y);
    if (![px, py].every(Number.isInteger) || px < 0 || px >= ORBITO_GRID || py < 0 || py >= ORBITO_GRID) return { ok: false, status: 400, error: 'invalid orbito place' };
    if (board[py][px] !== 0) return { ok: false, status: 409, error: 'place occupied' };
    board[py][px] = player;
    reserves[player] -= 1;
    state.board = board;
    state.reserves = reserves;
    state.pendingPlace = { x: px, y: py };
    state.stage = 'rotate';
    state.selectedEnemy = null;
    state.pendingEnemyTarget = null;
    keepTurn = true;
  } else if (action === 'rotate') {
    if (state.stage !== 'rotate') return { ok: false, status: 409, error: 'rotate only allowed in rotate stage' };
    state.board = orbitoRotateBoard(board);
    state.selectedEnemy = null;
    state.pendingEnemyTarget = null;
    state.pendingPlace = null;
    const lines = orbitoCheckLines(state.board);
    if (lines.red && lines.blue) {
      state.gameOver = true; state.draw = true; state.winner = 0; gameOver = true;
    } else if (lines.red) {
      state.gameOver = true; state.winner = 1; gameOver = true;
    } else if (lines.blue) {
      state.gameOver = true; state.winner = 2; gameOver = true;
    } else if (reserves[1] === 0 && reserves[2] === 0) {
      if (state.extraRotationsLeft === 0) state.extraRotationsLeft = 5;
      state.extraRotationsLeft -= 1;
      if (state.extraRotationsLeft === 0) {
        state.gameOver = true; state.draw = true; state.winner = 0; gameOver = true;
      } else {
        state.current = player === 1 ? 2 : 1;
        state.stage = 'rotate';
      }
    } else {
      state.current = player === 1 ? 2 : 1;
      state.stage = 'move';
    }
    state.reserves = reserves;
  } else {
    return { ok: false, status: 400, error: 'invalid orbito action' };
  }

  return {
    ok: true,
    authoritativeMove: { kind: 'orbito', payload: {
      player,
      action,
      moveEnemy: payload.moveEnemy ? { from: { x: Number(payload.moveEnemy.from.x), y: Number(payload.moveEnemy.from.y) }, to: { x: Number(payload.moveEnemy.to.x), y: Number(payload.moveEnemy.to.y) } } : null,
      skippedEnemy: !!payload.skippedEnemy,
      place: payload.place ? { x: Number(payload.place.x), y: Number(payload.place.y) } : null,
      rotateOnly: action === 'rotate'
    } },
    keepTurn,
    gameOver
  };
}

function createHalmaState() {
  const playersState = [
    { id: 1, name: halmaColorDefs[0].name, fill: halmaColorDefs[0].fill, stroke: halmaColorDefs[0].stroke, home: [...halmaHomes.top], target: [...halmaHomes.bottom] },
    { id: 2, name: halmaColorDefs[1].name, fill: halmaColorDefs[1].fill, stroke: halmaColorDefs[1].stroke, home: [...halmaHomes.bottom], target: [...halmaHomes.top] }
  ];
  const occupancy = Array(halmaCells.length).fill(0);
  playersState.forEach((p, idx) => p.home.forEach((cellId) => { occupancy[cellId] = idx + 1; }));
  return {
    mode: 2,
    players: playersState,
    occupancy,
    current: 0,
    selected: null,
    chainJump: false,
    chainVisited: [],
    gameOver: false,
    draw: false,
    winner: 0
  };
}

function halmaGetMovesForPiece(state, id, onlyJumps, visitedSet) {
  const out = [];
  const cell = halmaCells[id];
  if (!cell) return out;
  if (!onlyJumps) {
    cell.neighbors.forEach((nid) => {
      if (state.occupancy[nid] === 0) out.push({ to: nid, type: 'step' });
    });
  }
  HALMA_DIRS.forEach(([dx, dy]) => {
    const mid = halmaCellMap.get(`${cell.gx + dx},${cell.gy + dy}`);
    const to = halmaCellMap.get(`${cell.gx + dx * 2},${cell.gy + dy * 2}`);
    if (mid == null || to == null) return;
    if (state.occupancy[mid] !== 0 && state.occupancy[to] === 0) {
      if (visitedSet && visitedSet.has(to)) return;
      out.push({ to, type: 'jump' });
    }
  });
  return out;
}

function halmaHasAnyMove(state, playerId) {
  for (let i = 0; i < state.occupancy.length; i += 1) {
    if (state.occupancy[i] !== playerId) continue;
    if (halmaGetMovesForPiece(state, i, false, null).length) return true;
  }
  return false;
}

function halmaCheckWin(state, playerIdx) {
  const target = state.players[playerIdx] && state.players[playerIdx].target;
  return Array.isArray(target) && target.every((cellId) => state.occupancy[cellId] === playerIdx + 1);
}

function halmaAdvanceTurn(state) {
  state.selected = null;
  state.chainJump = false;
  state.chainVisited = [];
  let next = (state.current + 1) % state.players.length;
  for (let attempts = 0; attempts < state.players.length; attempts += 1) {
    if (halmaHasAnyMove(state, next + 1)) {
      state.current = next;
      return true;
    }
    next = (next + 1) % state.players.length;
  }
  state.current = next;
  state.gameOver = true;
  state.draw = true;
  state.winner = 0;
  return false;
}

function applyHalmaMove(state, payload, playerIndex) {
  if (state.gameOver) return { ok: false, status: 409, error: 'game already over' };
  if (state.current !== playerIndex) return { ok: false, status: 409, error: 'halma current player mismatch' };
  if (!payload || typeof payload !== 'object') return { ok: false, status: 400, error: 'invalid halma payload' };
  const player = playerIndex + 1;

  if (payload.action === 'end_turn') {
    if (!state.chainJump) return { ok: false, status: 409, error: 'no halma chain jump to end' };
    if (!Number.isInteger(state.selected) || state.occupancy[state.selected] !== player) {
      return { ok: false, status: 409, error: 'invalid halma chain selection' };
    }
    const advanced = halmaAdvanceTurn(state);
    return { ok: true, authoritativeMove: { kind: 'halma', payload: { action: 'end_turn', playerIndex } }, keepTurn: false, gameOver: !advanced || !!state.gameOver, nextTurnIndex: state.current };
  }

  if (payload.action !== 'move') return { ok: false, status: 400, error: 'invalid halma action' };
  const from = Number(payload.from);
  const to = Number(payload.to);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from >= halmaCells.length || to < 0 || to >= halmaCells.length) {
    return { ok: false, status: 400, error: 'invalid halma coordinates' };
  }
  if (state.occupancy[from] !== player) return { ok: false, status: 409, error: 'halma piece mismatch' };
  if (state.chainJump && state.selected !== from) return { ok: false, status: 409, error: 'must continue with same halma piece' };

  const visitedSet = new Set(Array.isArray(state.chainVisited) ? state.chainVisited : []);
  const continuingChain = !!state.chainJump;
  const legal = halmaGetMovesForPiece(state, from, continuingChain, visitedSet).find((m) => m.to === to);
  if (!legal) return { ok: false, status: 409, error: 'illegal halma move' };

  state.occupancy[from] = 0;
  state.occupancy[to] = player;
  state.selected = to;

  let keepTurn = false;
  let gameOver = false;
  if (legal.type === 'jump') {
    if (!continuingChain) visitedSet.add(from);
    state.chainJump = true;
    visitedSet.add(to);
    state.chainVisited = Array.from(visitedSet);
    if (halmaCheckWin(state, playerIndex)) {
      state.gameOver = true;
      state.winner = player;
      gameOver = true;
      state.chainJump = false;
      state.selected = null;
      state.chainVisited = [];
    } else {
      const nextJumps = halmaGetMovesForPiece(state, to, true, visitedSet);
      if (nextJumps.length) {
        keepTurn = true;
        state.current = playerIndex;
      } else {
        const advanced = halmaAdvanceTurn(state);
        if (!advanced || state.gameOver) gameOver = true;
      }
    }
  } else {
    state.chainJump = false;
    state.chainVisited = [];
    if (halmaCheckWin(state, playerIndex)) {
      state.gameOver = true;
      state.winner = player;
      gameOver = true;
      state.selected = null;
    } else {
      const advanced = halmaAdvanceTurn(state);
      if (!advanced || state.gameOver) gameOver = true;
    }
  }

  return { ok: true, authoritativeMove: { kind: 'halma', payload: { action: 'move', from, to, moveType: legal.type, playerIndex } }, keepTurn, gameOver, nextTurnIndex: state.current };
}

function createAxis4State() {
  return {
    board: Array.from({ length: AXIS4_GRID }, () => Array(AXIS4_GRID).fill(0)),
    moveCount: 0,
    turn: 1,
    gameOver: false,
    winner: 0,
    draw: false,
    lastMove: null
  };
}

function createGomokuState() {
  return {
    board: Array.from({ length: GOMOKU_GRID }, () => Array(GOMOKU_GRID).fill(0)),
    moveCount: 0,
    turn: 1,
    gameOver: false,
    winner: 0,
    draw: false,
    lastMove: null
  };
}

function createQuoridorState() {
  return {
    pawns: QUORIDOR_START.map((p) => ({ ...p })),
    hBlocks: Array.from({ length: QUORIDOR_N - 1 }, () => Array(QUORIDOR_N).fill(false)),
    vBlocks: Array.from({ length: QUORIDOR_N }, () => Array(QUORIDOR_N - 1).fill(false)),
    current: 0,
    mode: 'move',
    pendingWall: null,
    gameOver: false,
    winner: null
  };
}


function createAirPaddles() {
  return [
    { x: AIR_W / 2, y: 110, px: AIR_W / 2, py: 110, vx: 0, vy: 0, inputSeq: 0, lastInputAt: 0 },
    { x: AIR_W / 2, y: AIR_H - 110, px: AIR_W / 2, py: AIR_H - 110, vx: 0, vy: 0, inputSeq: 0, lastInputAt: 0 }
  ];
}

function createAirHockeyState() {
  return {
    width: AIR_W,
    height: AIR_H,
    goalWidth: AIR_GOAL_W,
    puckRadius: AIR_PUCK_R,
    paddleRadius: AIR_PAD_R,
    paddles: createAirPaddles(),
    puck: { x: AIR_W / 2, y: AIR_H / 2, vx: 0, vy: 0, angle: 0, omega: 0 },
    scores: [0, 0],
    phase: 'waiting',
    serveAt: 0,
    serveDir: Math.random() < 0.5 ? 1 : -1,
    gameOver: false,
    winner: 0,
    status: '상대와 실시간 연결을 준비하는 중이야.',
    tick: 0
  };
}

function airResetPuck(state) {
  state.puck.x = AIR_W / 2;
  state.puck.y = AIR_H / 2;
  state.puck.vx = 0;
  state.puck.vy = 0;
  state.puck.angle = 0;
  state.puck.omega = 0;
}

function airResetPaddles(state) {
  state.paddles = createAirPaddles();
}

function airScheduleServe(state, dir, delayMs, statusText) {
  airResetPuck(state);
  state.serveDir = dir || (Math.random() < 0.5 ? 1 : -1);
  state.serveAt = now() + (typeof delayMs === 'number' ? delayMs : AIR_SERVE_DELAY_MS);
  state.phase = 'serve';
  state.status = statusText || '1초 뒤 퍽이 출발해.';
}

function airServePuck(state) {
  const p = state.puck;
  p.vx = (Math.random() * 2 - 1) * 3;
  p.vy = state.serveDir * (4 + Math.random() * 2);
  p.omega = (Math.random() * 2 - 1) * 0.18;
  state.phase = 'active';
  state.serveAt = 0;
  state.status = '게임 진행 중!';
}

function airClampPaddle(p, playerIndex) {
  const topHalf = playerIndex === 0;
  const minX = AIR_PAD_R + 12;
  const maxX = AIR_W - AIR_PAD_R - 12;
  const minY = topHalf ? AIR_PAD_R + 12 : AIR_H / 2 + 20 + AIR_PAD_R;
  const maxY = topHalf ? AIR_H / 2 - 20 - AIR_PAD_R : AIR_H - AIR_PAD_R - 12;
  p.x = Math.max(minX, Math.min(maxX, Number.isFinite(p.x) ? p.x : AIR_W / 2));
  p.y = Math.max(minY, Math.min(maxY, Number.isFinite(p.y) ? p.y : (topHalf ? 110 : AIR_H - 110)));
}

function airUpdatePaddleVelocity(p, dtRatio) {
  const safeDt = Math.max(0.25, Number.isFinite(dtRatio) ? dtRatio : 1);
  // vx/vy는 30fps 기준 한 tick당 이동량으로 환산해서 기존 충돌감은 유지한다.
  p.vx = (p.x - p.px) / safeDt;
  p.vy = (p.y - p.py) / safeDt;
  const speed = Math.hypot(p.vx, p.vy);
  // 휴대폰 터치가 순간적으로 크게 튈 때 서버 물리 계산이 과격해지는 것을 방지한다.
  if (speed > AIR_MAX_PADDLE_SPEED) {
    p.vx = p.vx / speed * AIR_MAX_PADDLE_SPEED;
    p.vy = p.vy / speed * AIR_MAX_PADDLE_SPEED;
  }
  p.px = p.x;
  p.py = p.y;
}

function airClampPuckSpin(puck) {
  if (!puck) return;
  puck.omega = Number.isFinite(puck.omega) ? puck.omega : 0;
  if (puck.omega > AIR_MAX_PUCK_SPIN) puck.omega = AIR_MAX_PUCK_SPIN;
  if (puck.omega < -AIR_MAX_PUCK_SPIN) puck.omega = -AIR_MAX_PUCK_SPIN;
}

function airSpinPuck(state, dtRatio) {
  const puck = state.puck;
  puck.angle = Number.isFinite(puck.angle) ? puck.angle : 0;
  puck.omega = Number.isFinite(puck.omega) ? puck.omega : 0;
  puck.angle += puck.omega * dtRatio;
  if (Math.abs(puck.angle) > Math.PI * 10) puck.angle %= Math.PI * 2;
  puck.omega *= Math.pow(AIR_SPIN_FRICTION, dtRatio);
  if (Math.abs(puck.omega) < 0.002) puck.omega = 0;
  airClampPuckSpin(puck);
}

function airAddSpinFromPaddle(puck, puckTangent, paddleTangent) {
  // 단순 원판 모델: 접선 방향 상대속도가 마찰 충격을 만들고, 그 일부를 각속도로 바꾼다.
  // 완전한 강체 물리엔진은 아니지만, 접선 충돌이 회전을 만든다는 효과는 안정적으로 반영한다.
  const relativeSurface = (paddleTangent - puckTangent) - ((puck.omega || 0) * AIR_PUCK_R);
  const deltaOmega = Math.max(-0.42, Math.min(0.42, relativeSurface * AIR_SPIN_TRANSFER));
  puck.omega = (puck.omega || 0) + deltaOmega;
  airClampPuckSpin(puck);
}

function airApplyWallSpin(state, wall, tangentVelocity) {
  const puck = state.puck;
  const tangent = Number.isFinite(tangentVelocity) ? tangentVelocity : 0;
  let sign = 1;
  if (wall === 'right' || wall === 'top') sign = -1;
  puck.omega = (puck.omega || 0) + sign * tangent * AIR_WALL_SPIN_TRANSFER;
  airClampPuckSpin(puck);
}

function airResolvePuckBounds(state) {
  const puck = state.puck;
  const leftGoal = (AIR_W - AIR_GOAL_W) / 2;
  const rightGoal = leftGoal + AIR_GOAL_W;

  if (puck.x - AIR_PUCK_R < 0) {
    const tangentBefore = puck.vy;
    puck.x = AIR_PUCK_R;
    puck.vx = Math.abs(puck.vx) * AIR_WALL_RESTITUTION;
    puck.vy *= AIR_WALL_TANGENT_DAMPING;
    airApplyWallSpin(state, 'left', tangentBefore);
  }
  if (puck.x + AIR_PUCK_R > AIR_W) {
    const tangentBefore = puck.vy;
    puck.x = AIR_W - AIR_PUCK_R;
    puck.vx = -Math.abs(puck.vx) * AIR_WALL_RESTITUTION;
    puck.vy *= AIR_WALL_TANGENT_DAMPING;
    airApplyWallSpin(state, 'right', tangentBefore);
  }

  if (puck.y - AIR_PUCK_R <= 0) {
    if (puck.x >= leftGoal && puck.x <= rightGoal) return 1;
    const tangentBefore = puck.vx;
    puck.y = AIR_PUCK_R;
    puck.vy = Math.abs(puck.vy) * AIR_WALL_RESTITUTION;
    puck.vx *= AIR_WALL_TANGENT_DAMPING;
    airApplyWallSpin(state, 'top', tangentBefore);
  }
  if (puck.y + AIR_PUCK_R >= AIR_H) {
    if (puck.x >= leftGoal && puck.x <= rightGoal) return 0;
    const tangentBefore = puck.vx;
    puck.y = AIR_H - AIR_PUCK_R;
    puck.vy = -Math.abs(puck.vy) * AIR_WALL_RESTITUTION;
    puck.vx *= AIR_WALL_TANGENT_DAMPING;
    airApplyWallSpin(state, 'bottom', tangentBefore);
  }
  return -1;
}

function airSeparatePuckFromPaddle(state, p, separationMargin = AIR_CONTACT_MARGIN, detectionMargin = 0) {
  const puck = state.puck;
  const dx = puck.x - p.x;
  const dy = puck.y - p.y;
  const dist = Math.hypot(dx, dy);
  const minD = AIR_PUCK_R + AIR_PAD_R;
  if (dist >= minD + detectionMargin) return null;

  let nx = 0;
  let ny = p.y < AIR_H / 2 ? 1 : -1;
  if (dist > 0.0001) {
    nx = dx / dist;
    ny = dy / dist;
  }

  const targetDist = minD + separationMargin;
  puck.x = p.x + nx * targetDist;
  puck.y = p.y + ny * targetDist;
  return { nx, ny };
}

function airKeepPuckOutsidePaddles(state, separationMargin = 0.35) {
  // 실제 겹침이 있을 때만 분리한다.
  // minD+margin 범위까지 미리 밀어내면 접촉 직전에도 서버가 퍽을 순간 이동시켜 물리가 어색해진다.
  airSeparatePuckFromPaddle(state, state.paddles[0], separationMargin, 0);
  airSeparatePuckFromPaddle(state, state.paddles[1], separationMargin, 0);
}

function airCollidePaddle(state, p) {
  const puck = state.puck;
  const contact = airSeparatePuckFromPaddle(state, p, AIR_CONTACT_MARGIN, 0);
  if (!contact) return;
  const { nx, ny } = contact;

  const tangentX = -ny;
  const tangentY = nx;
  const puckNormal = puck.vx * nx + puck.vy * ny;
  const puckTangent = puck.vx * tangentX + puck.vy * tangentY;
  const paddleNormal = p.vx * nx + p.vy * ny;
  const paddleTangent = p.vx * tangentX + p.vy * tangentY;
  const relativeNormal = puckNormal - paddleNormal;

  // 이미 서로 멀어지는 중이면 속도는 건드리지 않고 위치만 접촉선 밖으로 보정한다.
  if (relativeNormal >= 0) return;

  // 움직이는 패들을 무한 질량 벽처럼 보고 상대속도를 반사한다.
  // 기존의 강제 최소 속도 위주 계산보다 패들-퍽 겹침/유령 밀침이 훨씬 적다.
  let outNormal = puckNormal - (1 + AIR_PUCK_RESTITUTION) * relativeNormal;
  if (paddleNormal > 0) {
    outNormal += Math.min(3.5, paddleNormal * AIR_PADDLE_TRANSFER);
    outNormal = Math.max(outNormal, Math.min(AIR_MIN_SHOT_SPEED, paddleNormal + 2.2));
  }
  airAddSpinFromPaddle(puck, puckTangent, paddleTangent);
  const spinGrip = Math.max(-1.4, Math.min(1.4, (puck.omega || 0) * AIR_PUCK_R * AIR_SPIN_TO_TANGENT));
  const outTangent = puckTangent * AIR_TANGENT_DAMPING + paddleTangent * AIR_TANGENT_TRANSFER + spinGrip;

  puck.vx = nx * outNormal + tangentX * outTangent;
  puck.vy = ny * outNormal + tangentY * outTangent;
  const speed = Math.hypot(puck.vx, puck.vy);
  if (speed > AIR_MAX_PUCK_SPEED) {
    puck.vx = puck.vx / speed * AIR_MAX_PUCK_SPEED;
    puck.vy = puck.vy / speed * AIR_MAX_PUCK_SPEED;
  }

  airSeparatePuckFromPaddle(state, p, AIR_CONTACT_MARGIN, AIR_CONTACT_MARGIN);
}

function airConnectedCount(room) {
  if (!room || room.gameType !== 'airhockey') return 0;
  return room.players.reduce((count, pid) => {
    const player = players[pid];
    return count + (player && player.airSocket && !player.airSocket.destroyed ? 1 : 0);
  }, 0);
}

function airPublicState(room) {
  if (!room || !room.state || !room.state.airhockey) return null;
  const state = room.state.airhockey;
  return {
    roomId: room.roomId,
    gameType: 'airhockey',
    revision: room.revision || 0,
    connected: airConnectedCount(room),
    acks: room.players.map((pid) => {
      const player = players[pid];
      return player && Number.isFinite(player.airLastInputSeq) ? player.airLastInputSeq : 0;
    }),
    serverTickMs: AIR_TICK_MS,
    baseTickMs: AIR_BASE_TICK_MS,
    state
  };
}

function airBroadcast(room, type, payload) {
  if (!room || room.gameType !== 'airhockey') return;
  const data = Object.assign({ type }, payload || {});
  room.players.forEach((pid) => {
    const player = players[pid];
    if (player && player.airSocket && !player.airSocket.destroyed) wsSendJson(player.airSocket, data);
  });
}

function airBroadcastState(room) {
  const payload = airPublicState(room);
  if (!payload) return;
  // 실시간 렌더링 보간용 서버 시각. 클라이언트가 늦게 받은 패킷을 부드럽게 따라가도록 사용한다.
  payload.serverTime = now();
  airBroadcast(room, 'state', payload);
}

function airMaybeStartRealtime(room) {
  if (!room || room.gameType !== 'airhockey' || !room.state || !room.state.airhockey) return;
  const state = room.state.airhockey;
  if (state.gameOver) return;
  if (airConnectedCount(room) < 2) {
    if (state.phase !== 'waiting') {
      state.phase = 'waiting';
      state.serveAt = 0;
      state.status = '상대 실시간 연결을 기다리는 중이야.';
      airResetPuck(state);
      room.revision = (room.revision || 0) + 1;
    }
    airBroadcastState(room);
    return;
  }
  if (state.phase === 'waiting') {
    airResetPaddles(state);
    room.players.forEach((pid) => {
      const p = players[pid];
      if (p) p.airLastInputSeq = 0;
    });
    airScheduleServe(state, Math.random() < 0.5 ? 1 : -1, AIR_SERVE_DELAY_MS, '양쪽 연결 완료! 1초 뒤 시작');
    room.revision = (room.revision || 0) + 1;
    airBroadcastState(room);
  }
}

function airHandleInput(player, payload) {
  if (!player || player.playerIndex == null || player.status !== 'matched') return;
  player.airLastFrameAt = now();
  const room = player.roomId ? rooms[player.roomId] : null;
  if (!room || room.gameType !== 'airhockey' || !room.state || !room.state.airhockey) return;
  const state = room.state.airhockey;
  if (state.gameOver) return;
  const idx = player.playerIndex;
  const p = state.paddles[idx];
  if (!p) return;
  const seq = Number(payload && payload.seq);
  // 최신 클라이언트는 모든 입력에 양수 seq를 보낸다. seq가 없거나 0/음수면
  // 오래된 입력이 순서 검사를 우회할 수 있으므로 무시한다.
  if (!Number.isFinite(seq) || seq <= 0) return;
  if (Number.isFinite(p.inputSeq) && seq <= p.inputSeq) return;
  p.inputSeq = seq;
  player.airLastInputSeq = seq;
  const x = Number(payload && payload.x);
  const y = Number(payload && payload.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  // 클라이언트가 잘못된 좌표/화면 밖 좌표를 보내도 서버 물리 상태가 깨지지 않게 원천 차단한다.
  const beforeX = p.x;
  const beforeY = p.y;
  p.lastInputAt = now();
  p.x = Math.max(-AIR_W, Math.min(AIR_W * 2, x));
  p.y = Math.max(-AIR_H, Math.min(AIR_H * 2, y));
  airClampPaddle(p, idx);
  // serve/waiting 중에는 물리 tick이 revision을 올리지 않을 수 있다.
  // 입력으로 패들 좌표나 ack가 바뀌면 revision을 올려서 같은 리비전 패킷 무시 때문에
  // 상대 패들 위치/내 입력 ack가 늦게 반영되는 문제를 막는다.
  if (beforeX !== p.x || beforeY !== p.y || (Number.isFinite(seq) && seq > 0)) {
    room.revision = (room.revision || 0) + 1;
  }
  // 입력이 들어온 프레임에서는 이전 좌표를 너무 오래 끌고 가지 않도록 한다.
  // 실제 속도는 다음 tick에서 제한해서 계산한다.
}

function airStepRoom(room) {
  if (!room || room.gameType !== 'airhockey' || !room.state || !room.state.airhockey) return false;
  const state = room.state.airhockey;
  const t = now();
  const prevTick = Number.isFinite(room.airLastTickAt) ? room.airLastTickAt : t;
  room.airLastTickAt = t;
  const dtRatio = Math.max(0.25, Math.min(2.5, (t - prevTick) / AIR_BASE_TICK_MS || 1));

  if (state.gameOver) return false;
  if (airConnectedCount(room) < 2) {
    if (state.phase !== 'waiting') {
      state.phase = 'waiting';
      state.serveAt = 0;
      state.status = '상대 실시간 연결을 기다리는 중이야.';
      airResetPuck(state);
      room.revision = (room.revision || 0) + 1;
      return true;
    }
    return false;
  }
  if (state.phase === 'waiting') {
    airResetPaddles(state);
    room.players.forEach((pid) => {
      const p = players[pid];
      if (p) p.airLastInputSeq = 0;
    });
    airScheduleServe(state, state.serveDir || 1, AIR_SERVE_DELAY_MS, '양쪽 연결 완료! 1초 뒤 시작');
    room.revision = (room.revision || 0) + 1;
    return true;
  }

  state.paddles.forEach((p, idx) => {
    airClampPaddle(p, idx);
    airUpdatePaddleVelocity(p, dtRatio);
  });

  if (state.phase === 'serve') {
    // serve 대기 중에는 퍽과 패들을 서버 기준으로 계속 고정/보정하되, 물리는 진행하지 않는다.
    if (t < state.serveAt) return true;
    airServePuck(state);
  }

  const puck = state.puck;
  let scorer = -1;
  const moveSteps = Math.max(1, Math.ceil(Math.hypot(puck.vx * dtRatio, puck.vy * dtRatio) / 8));
  const subDt = dtRatio / moveSteps;
  for (let i = 0; i < moveSteps; i += 1) {
    // 충돌 후 바뀐 속도를 남은 sub-step에 즉시 반영한다.
    // 벽/골 충돌도 sub-step 안에서 처리해야 고속 퍽이 벽 안쪽까지 파고든 뒤
    // 한 번에 보정되는 순간이동 느낌이 줄어든다.
    puck.x += puck.vx * subDt;
    puck.y += puck.vy * subDt;
    airCollidePaddle(state, state.paddles[0]);
    airCollidePaddle(state, state.paddles[1]);
    scorer = airResolvePuckBounds(state);
    if (scorer >= 0) break;
  }

  if (scorer < 0) {
    const friction = Math.pow(AIR_FRICTION, dtRatio);
    puck.vx *= friction;
    puck.vy *= friction;
    airSpinPuck(state, dtRatio);
    if (Math.abs(puck.vx) < 0.01) puck.vx = 0;
    if (Math.abs(puck.vy) < 0.01) puck.vy = 0;
    airKeepPuckOutsidePaddles(state, 0.35);
  }

  if (scorer >= 0) {
    state.scores[scorer] += 1;
    airResetPaddles(state);
    if (state.scores[scorer] >= 5) {
      state.gameOver = true;
      state.winner = scorer + 1;
      state.phase = 'gameover';
      state.status = (scorer === 0 ? '빨강' : '파랑') + ' 승리!';
      airResetPuck(state);
    } else {
      airScheduleServe(state, scorer === 0 ? 1 : -1, AIR_SERVE_DELAY_MS, (scorer === 0 ? '빨강' : '파랑') + ' 득점! 1초 뒤 다시 시작');
    }
  }
  state.tick = (state.tick || 0) + 1;
  room.revision = (room.revision || 0) + 1;
  return true;
}

function airTickAllRooms() {
  const t = now();
  Object.keys(rooms).forEach((roomId) => {
    const room = rooms[roomId];
    if (!room || room.gameType !== 'airhockey') return;
    const shouldBroadcast = airStepRoom(room);
    if (!shouldBroadcast) return;
    if (!room.airLastBroadcastAt || t - room.airLastBroadcastAt >= AIR_BROADCAST_MS) {
      room.airLastBroadcastAt = t;
      airBroadcastState(room);
    }
  });
}

setInterval(airTickAllRooms, AIR_TICK_MS).unref();

function airHeartbeatSockets() {
  const t = now();
  Object.keys(players).forEach((pid) => {
    const player = players[pid];
    if (!player || !player.airSocket || player.airSocket.destroyed) return;
    if (player.airLastFrameAt && t - player.airLastFrameAt > AIR_SOCKET_IDLE_MS) {
      closeAirSocket(player, 1001);
      return;
    }
    wsSendPing(player.airSocket);
  });
}

setInterval(airHeartbeatSockets, 10000).unref();

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function countDir(board, size, r, c, dr, dc, who) {
  let count = 0;
  let nr = r + dr;
  let nc = c + dc;
  while (nr >= 0 && nr < size && nc >= 0 && nc < size && board[nr][nc] === who) {
    count += 1;
    nr += dr;
    nc += dc;
  }
  return count;
}

function axisAllowed(board, r, c, lastMove) {
  if (board[r][c] !== 0) return false;
  if (!lastMove || !Number.isInteger(lastMove.r) || !Number.isInteger(lastMove.c)) return true;
  return r === lastMove.r || c === lastMove.c;
}

function axisHasAnyLegalMove(state) {
  for (let r = 0; r < AXIS4_GRID; r += 1) {
    for (let c = 0; c < AXIS4_GRID; c += 1) {
      if (axisAllowed(state.board, r, c, state.lastMove)) return true;
    }
  }
  return false;
}

function applyAxis4Move(state, payload, playerIndex) {
  const player = playerIndex + 1;
  const arr = Array.isArray(payload) ? payload : [payload && payload.r, payload && payload.c, payload && payload.player];
  const r = Number(arr[0]);
  const c = Number(arr[1]);
  if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r >= AXIS4_GRID || c < 0 || c >= AXIS4_GRID) {
    return { ok: false, status: 400, error: 'invalid axis4 coordinates' };
  }
  if (state.gameOver) return { ok: false, status: 409, error: 'game already over' };
  if (state.turn !== player) return { ok: false, status: 409, error: 'axis4 current player mismatch' };
  if (!axisAllowed(state.board, r, c, state.lastMove)) return { ok: false, status: 409, error: 'illegal axis4 move' };
  state.board[r][c] = player;
  state.moveCount += 1;
  state.lastMove = { r, c, player };
  const win = [[1,0],[0,1],[1,1],[1,-1]].some(([dr, dc]) => 1 + countDir(state.board, AXIS4_GRID, r, c, dr, dc, player) + countDir(state.board, AXIS4_GRID, r, c, -dr, -dc, player) >= 4);
  let gameOver = false;
  if (win) {
    state.gameOver = true;
    state.winner = player;
    gameOver = true;
  } else {
    state.turn = player === 1 ? 2 : 1;
    if (state.moveCount >= AXIS4_GRID * AXIS4_GRID || !axisHasAnyLegalMove(state)) {
      state.gameOver = true;
      state.draw = true;
      state.winner = 0;
      gameOver = true;
    }
  }
  return { ok: true, authoritativeMove: { kind: 'axis4', payload: [r, c, player] }, keepTurn: false, gameOver };
}

function lineLength(board, r, c, dr, dc, p) {
  return 1 + countDir(board, GOMOKU_GRID, r, c, dr, dc, p) + countDir(board, GOMOKU_GRID, r, c, -dr, -dc, p);
}


function gomokuInRange(r, c) {
  return r >= 0 && r < GOMOKU_GRID && c >= 0 && c < GOMOKU_GRID;
}

function gomokuMakeLineString(board, r, c, dr, dc, p, radius = 5) {
  let s = '';
  for (let i = -radius; i <= radius; i += 1) {
    const nr = r + dr * i;
    const nc = c + dc * i;
    if (!gomokuInRange(nr, nc)) s += '2';
    else if (board[nr][nc] === p) s += '1';
    else if (board[nr][nc] === 0) s += '0';
    else s += '2';
  }
  return s;
}

function gomokuHasExactFiveAt(board, r, c, p) {
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  return dirs.some(([dr, dc]) => lineLength(board, r, c, dr, dc, p) === 5);
}

function gomokuHasOverlineAt(board, r, c, p) {
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  return dirs.some(([dr, dc]) => lineLength(board, r, c, dr, dc, p) >= 6);
}

function gomokuHasStraightFourAt(board, r, c, dr, dc, p) {
  const s = gomokuMakeLineString(board, r, c, dr, dc, p, 5);
  return s.includes('011110');
}

function gomokuDirectionOffsets(radius = 4) {
  const offsets = [];
  for (let i = -radius; i <= radius; i += 1) offsets.push(i);
  return offsets;
}
const GOMOKU_OFFSETS = gomokuDirectionOffsets(4);

function gomokuCountFourDirectionsPlaced(board, r, c, p) {
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  let count = 0;
  for (const [dr, dc] of dirs) {
    let found = false;
    for (const step of GOMOKU_OFFSETS) {
      const nr = r + dr * step;
      const nc = c + dc * step;
      if (!gomokuInRange(nr, nc) || board[nr][nc] !== 0) continue;
      board[nr][nc] = p;
      const makesFive = lineLength(board, nr, nc, dr, dc, p) === 5;
      board[nr][nc] = 0;
      if (makesFive) {
        found = true;
        break;
      }
    }
    if (found) count += 1;
  }
  return count;
}

function gomokuIsForbiddenPlaced(board, r, c, p, depth = 0) {
  if (p !== 1) return null;
  const winNow = gomokuHasExactFiveAt(board, r, c, p);
  if (winNow) return null;
  if (gomokuHasOverlineAt(board, r, c, p)) return { reason: '장목 금수' };
  const doubleFour = gomokuCountFourDirectionsPlaced(board, r, c, p) >= 2;
  if (doubleFour) return { reason: '사사 금수' };
  if (depth >= 2) return null;
  const doubleThree = gomokuCountOpenThreeDirectionsPlaced(board, r, c, p, depth) >= 2;
  if (doubleThree) return { reason: '삼삼 금수' };
  return null;
}

function gomokuCountOpenThreeDirectionsPlaced(board, r, c, p, depth = 0) {
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  let count = 0;
  for (const [dr, dc] of dirs) {
    let found = false;
    for (const step of GOMOKU_OFFSETS) {
      const nr = r + dr * step;
      const nc = c + dc * step;
      if (!gomokuInRange(nr, nc) || board[nr][nc] !== 0) continue;
      board[nr][nc] = p;
      const straightFour = !gomokuHasExactFiveAt(board, nr, nc, p) && gomokuHasStraightFourAt(board, nr, nc, dr, dc, p);
      const allowed = straightFour && !gomokuIsForbiddenPlaced(board, nr, nc, p, depth + 1);
      board[nr][nc] = 0;
      if (allowed) {
        found = true;
        break;
      }
    }
    if (found) count += 1;
  }
  return count;
}

function getGomokuForbiddenInfo(board, r, c, p) {
  if (p !== 1 || !gomokuInRange(r, c) || board[r][c] !== 0) return null;
  board[r][c] = p;
  const result = gomokuIsForbiddenPlaced(board, r, c, p, 0);
  board[r][c] = 0;
  return result;
}

function applyGomokuMove(state, payload, playerIndex) {
  const player = playerIndex + 1;
  const arr = Array.isArray(payload) ? payload : [payload && payload.r, payload && payload.c, payload && payload.player];
  const r = Number(arr[0]);
  const c = Number(arr[1]);
  if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r >= GOMOKU_GRID || c < 0 || c >= GOMOKU_GRID) {
    return { ok: false, status: 400, error: 'invalid gomoku coordinates' };
  }
  if (state.gameOver) return { ok: false, status: 409, error: 'game already over' };
  if (state.turn !== player) return { ok: false, status: 409, error: 'gomoku current player mismatch' };
  if (state.board[r][c] !== 0) return { ok: false, status: 409, error: 'cell already taken' };
  if (player === 1) {
    const forbidden = getGomokuForbiddenInfo(state.board, r, c, player);
    if (forbidden) return { ok: false, status: 409, error: forbidden.reason };
  }
  state.board[r][c] = player;
  state.moveCount += 1;
  state.lastMove = { r, c, player };
  const win = player === 1 ? gomokuHasExactFiveAt(state.board, r, c, player) : [[1,0],[0,1],[1,1],[1,-1]].some(([dr, dc]) => lineLength(state.board, r, c, dr, dc, player) >= 5);
  let gameOver = false;
  if (win) {
    state.gameOver = true;
    state.winner = player;
    gameOver = true;
  } else {
    state.turn = player === 1 ? 2 : 1;
    if (state.moveCount >= GOMOKU_GRID * GOMOKU_GRID) {
      state.gameOver = true;
      state.draw = true;
      state.winner = 0;
      gameOver = true;
    }
  }
  return { ok: true, authoritativeMove: { kind: 'gomoku', payload: [r, c, player] }, keepTurn: false, gameOver };
}

function quoridorInBounds(x, y) { return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < QUORIDOR_N && y >= 0 && y < QUORIDOR_N; }
function quoridorIsBlocked(state, x1, y1, x2, y2) {
  if (x1 === x2) {
    const minY = Math.min(y1, y2);
    return !!state.hBlocks[minY][x1];
  }
  if (y1 === y2) {
    const minX = Math.min(x1, x2);
    return !!state.vBlocks[y1][minX];
  }
  return true;
}
function quoridorHasHorizontalWallAnchor(state, x, y) {
  return y >= 0 && y < QUORIDOR_N - 1 && x >= 0 && x < QUORIDOR_N - 1 && !!(state.hBlocks[y] && state.hBlocks[y][x] && state.hBlocks[y][x + 1]);
}
function quoridorHasVerticalWallAnchor(state, x, y) {
  return y >= 0 && y < QUORIDOR_N - 1 && x >= 0 && x < QUORIDOR_N - 1 && !!(state.vBlocks[y] && state.vBlocks[y][x] && state.vBlocks[y + 1] && state.vBlocks[y + 1][x]);
}
function quoridorCanReachGoal(state, startX, startY, goalRow) {
  const q = [[startX, startY]];
  const seen = new Set([`${startX},${startY}`]);
  for (let i=0;i<q.length;i++) {
    const [x,y] = q[i];
    if (y === goalRow) return true;
    for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx=x+dx, ny=y+dy;
      const key=`${nx},${ny}`;
      if (!quoridorInBounds(nx,ny) || quoridorIsBlocked(state,x,y,nx,ny) || seen.has(key)) continue;
      seen.add(key); q.push([nx,ny]);
    }
  }
  return false;
}
function quoridorWallLegal(state, playerIndex, x, y, ori) {
  const pawn = state.pawns[playerIndex];
  if (!pawn || pawn.walls <= 0) return false;
  if (ori === 'h') {
    if (!(Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < QUORIDOR_N - 1 && y >= 0 && y < QUORIDOR_N - 1)) return false;
    if (quoridorHasHorizontalWallAnchor(state, x, y)) return false;
    if (state.hBlocks[y][x] || state.hBlocks[y][x + 1]) return false;
    if (quoridorHasVerticalWallAnchor(state, x, y)) return false;
    state.hBlocks[y][x] = true;
    state.hBlocks[y][x + 1] = true;
    try {
      return quoridorCanReachGoal(state, state.pawns[0].x, state.pawns[0].y, state.pawns[0].goal) && quoridorCanReachGoal(state, state.pawns[1].x, state.pawns[1].y, state.pawns[1].goal);
    } finally {
      state.hBlocks[y][x] = false;
      state.hBlocks[y][x + 1] = false;
    }
  }
  if (ori === 'v') {
    if (!(Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < QUORIDOR_N - 1 && y >= 0 && y < QUORIDOR_N - 1)) return false;
    if (quoridorHasVerticalWallAnchor(state, x, y)) return false;
    if (state.vBlocks[y][x] || state.vBlocks[y + 1][x]) return false;
    if (quoridorHasHorizontalWallAnchor(state, x, y)) return false;
    state.vBlocks[y][x] = true;
    state.vBlocks[y + 1][x] = true;
    try {
      return quoridorCanReachGoal(state, state.pawns[0].x, state.pawns[0].y, state.pawns[0].goal) && quoridorCanReachGoal(state, state.pawns[1].x, state.pawns[1].y, state.pawns[1].goal);
    } finally {
      state.vBlocks[y][x] = false;
      state.vBlocks[y + 1][x] = false;
    }
  }
  return false;
}
function quoridorValidMoves(state, playerIndex) {
  const me = state.pawns[playerIndex];
  const op = state.pawns[1 - playerIndex];
  const result = [];
  for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
    const nx = me.x + dx, ny = me.y + dy;
    if (!quoridorInBounds(nx, ny) || quoridorIsBlocked(state, me.x, me.y, nx, ny)) continue;
    if (!(op.x === nx && op.y === ny)) {
      result.push({ x: nx, y: ny });
    } else {
      const jx = nx + dx, jy = ny + dy;
      if (quoridorInBounds(jx, jy) && !quoridorIsBlocked(state, nx, ny, jx, jy)) {
        result.push({ x: jx, y: jy });
      } else {
        const sides = dx !== 0 ? [[0,1],[0,-1]] : [[1,0],[-1,0]];
        for (const [sx,sy] of sides) {
          const tx = nx + sx, ty = ny + sy;
          if (!quoridorInBounds(tx, ty) || quoridorIsBlocked(state, nx, ny, tx, ty)) continue;
          result.push({ x: tx, y: ty });
        }
      }
    }
  }
  const seen = new Set();
  return result.filter((m) => { const k=`${m.x},${m.y}`; if (seen.has(k)) return false; seen.add(k); return true; });
}
function applyQuoridorMove(state, payload, playerIndex) {
  if (state.gameOver) return { ok: false, status: 409, error: 'game already over' };
  if (state.current !== playerIndex) return { ok: false, status: 409, error: 'quoridor current player mismatch' };
  if (!payload || typeof payload !== 'object' || !payload.type) return { ok: false, status: 400, error: 'invalid quoridor payload' };
  const idx = playerIndex;
  if (payload.type === 'move') {
    const x = Number(payload.x), y = Number(payload.y);
    const legal = quoridorValidMoves(state, idx).some((m) => m.x === x && m.y === y);
    if (!legal) return { ok: false, status: 409, error: 'illegal quoridor move' };
    state.pawns[idx].x = x;
    state.pawns[idx].y = y;
    state.current = idx === 0 ? 1 : 0;
    state.mode = 'move';
    state.pendingWall = null;
    let gameOver = false;
    if (state.pawns[idx].y === state.pawns[idx].goal) {
      state.gameOver = true; state.winner = idx + 1; gameOver = true; state.current = idx;
    }
    return { ok: true, authoritativeMove: { kind: 'quoridor', payload: { type: 'move', x, y, playerIndex: idx } }, keepTurn: false, gameOver };
  }
  if (payload.type === 'wall') {
    const x = Number(payload.x), y = Number(payload.y), ori = payload.ori;
    if (!quoridorWallLegal(state, idx, x, y, ori)) return { ok: false, status: 409, error: 'illegal quoridor wall' };
    if (ori === 'h') {
      state.hBlocks[y][x] = true;
      state.hBlocks[y][x + 1] = true;
    } else {
      state.vBlocks[y][x] = true;
      state.vBlocks[y + 1][x] = true;
    }
    state.pawns[idx].walls -= 1;
    state.current = idx === 0 ? 1 : 0;
    state.mode = 'move';
    state.pendingWall = null;
    return { ok: true, authoritativeMove: { kind: 'quoridor', payload: { type: 'wall', x, y, ori, playerIndex: idx } }, keepTurn: false, gameOver: false };
  }
  return { ok: false, status: 400, error: 'invalid quoridor action' };
}

function getRoomGameOver(room) {
  if (!room || !room.state) return false;
  const state = room.state;
  if (room.gameType === 'axis4' && state.axis4) return !!state.axis4.gameOver;
  if (room.gameType === 'gomoku' && state.gomoku) return !!state.gomoku.gameOver;
  if (room.gameType === 'dab' && state.dab) return !!state.dab.gameOver;
  if (room.gameType === 'blokus' && state.blokus) return !!state.blokus.gameOver;
  if (room.gameType === 'quoridor' && state.quoridor) return !!state.quoridor.gameOver;
  if (room.gameType === 'orbito' && state.orbito) return !!state.orbito.gameOver;
  if (room.gameType === 'halma' && state.halma) return !!state.halma.gameOver;
  if (room.gameType === 'airhockey' && state.airhockey) return !!state.airhockey.gameOver;
  return false;
}

function getRoomSnapshot(room) {
  if (!room) return null;
  return {
    roomId: room.roomId,
    gameType: room.gameType,
    turnIndex: room.turnIndex,
    revision: typeof room.revision === 'number' ? room.revision : 0,
    gameOver: getRoomGameOver(room),
    state: clone(room.state || {})
  };
}

function createDabState() {
  const hLines = Array.from({ length: DAB_DOT_ROWS }, () => Array(DAB_BOX_COLS).fill(0));
  const vLines = Array.from({ length: DAB_BOX_ROWS }, () => Array(DAB_DOT_COLS).fill(0));
  const boxes = Array.from({ length: DAB_BOX_ROWS }, () => Array(DAB_BOX_COLS).fill(0));
  return {
    hLines,
    vLines,
    boxes,
    scores: [0, 0],
    turn: 1,
    gameOver: false,
    winner: 0,
    totalBoxes: DAB_BOX_ROWS * DAB_BOX_COLS
  };
}

function isValidDabLine(type, r, c) {
  if (type === 'h') return Number.isInteger(r) && Number.isInteger(c) && r >= 0 && r < DAB_DOT_ROWS && c >= 0 && c < DAB_BOX_COLS;
  if (type === 'v') return Number.isInteger(r) && Number.isInteger(c) && r >= 0 && r < DAB_BOX_ROWS && c >= 0 && c < DAB_DOT_COLS;
  return false;
}

function getDabLineOwner(state, type, r, c) {
  return type === 'h' ? state.hLines[r][c] : state.vLines[r][c];
}

function setDabLineOwner(state, type, r, c, owner) {
  if (type === 'h') state.hLines[r][c] = owner;
  else state.vLines[r][c] = owner;
}

function tryClaimDabBox(state, boxR, boxC, owner) {
  if (boxR < 0 || boxR >= DAB_BOX_ROWS || boxC < 0 || boxC >= DAB_BOX_COLS) return false;
  if (state.boxes[boxR][boxC]) return false;
  const closed = state.hLines[boxR][boxC] && state.hLines[boxR + 1][boxC] && state.vLines[boxR][boxC] && state.vLines[boxR][boxC + 1];
  if (!closed) return false;
  state.boxes[boxR][boxC] = owner;
  state.scores[owner - 1] += 1;
  return true;
}

function applyDabMove(state, movePayload, playerIndex) {
  const player = playerIndex + 1;
  if (state.gameOver) return { ok: false, status: 409, error: 'game already over' };
  if (state.turn !== player) return { ok: false, status: 409, error: 'dab current player mismatch' };
  const payload = movePayload && typeof movePayload === 'object' && !Array.isArray(movePayload)
    ? movePayload
    : Array.isArray(movePayload)
      ? { type: movePayload[0], r: movePayload[1], c: movePayload[2] }
      : null;

  if (!payload) return { ok: false, status: 400, error: 'invalid dab payload' };

  const type = payload.type;
  const r = Number(payload.r);
  const c = Number(payload.c);

  if (!isValidDabLine(type, r, c)) {
    return { ok: false, status: 400, error: 'invalid dab coordinates' };
  }
  if (getDabLineOwner(state, type, r, c)) {
    return { ok: false, status: 409, error: 'line already taken' };
  }

  setDabLineOwner(state, type, r, c, player);

  const completedBoxes = [];
  if (type === 'h') {
    if (tryClaimDabBox(state, r - 1, c, player)) completedBoxes.push({ r: r - 1, c });
    if (tryClaimDabBox(state, r, c, player)) completedBoxes.push({ r, c });
  } else {
    if (tryClaimDabBox(state, r, c - 1, player)) completedBoxes.push({ r, c: c - 1 });
    if (tryClaimDabBox(state, r, c, player)) completedBoxes.push({ r, c });
  }

  const keepTurn = completedBoxes.length > 0;
  const gameOver = (state.scores[0] + state.scores[1]) >= state.totalBoxes;
  state.turn = keepTurn ? player : (player === 1 ? 2 : 1);
  state.gameOver = gameOver;
  state.winner = gameOver ? (state.scores[0] > state.scores[1] ? 1 : (state.scores[1] > state.scores[0] ? 2 : 0)) : 0;

  return {
    ok: true,
    authoritativeMove: {
      kind: 'dab',
      payload: {
        type,
        r,
        c,
        player,
        keepTurn,
        gameOver,
        completedBoxes,
        scores: [...state.scores]
      }
    },
    keepTurn,
    gameOver
  };
}

function uuid() {
  return crypto.randomUUID();
}

function now() {
  return Date.now();
}

function clearPlayerDisconnectTimer(player) {
  if (player && player.disconnectTimer) {
    clearTimeout(player.disconnectTimer);
    player.disconnectTimer = null;
  }
}

function clearPlayerHeartbeatTimer(player) {
  if (player && player.heartbeatTimer) {
    clearInterval(player.heartbeatTimer);
    player.heartbeatTimer = null;
  }
}

function isPlayerInAirHockeyRoom(player) {
  if (!player || !player.roomId) return false;
  const room = rooms[player.roomId];
  return !!(room && room.gameType === 'airhockey');
}

function hasActiveAirSocket(player) {
  return !!(player && player.airSocket && !player.airSocket.destroyed);
}

function scheduleDisconnectCleanup(playerId, reason, delayMs) {
  const player = players[playerId];
  if (!player) return;
  clearPlayerDisconnectTimer(player);
  player.disconnectTimer = setTimeout(() => {
    const current = players[playerId];
    if (!current) return;
    current.disconnectTimer = null;
    // 에어하키는 실제 플레이 연결이 WebSocket이다.
    // SSE가 잠깐 끊겨도 WebSocket이 살아 있으면 방을 종료하면 안 된다.
    if (isPlayerInAirHockeyRoom(current) && hasActiveAirSocket(current)) return;
    cleanupPlayer(playerId, reason || 'opponent_disconnected');
  }, Math.max(0, Number(delayMs) || RECONNECT_GRACE_MS));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let received = 0;
    let settled = false;
    req.on('data', chunk => {
      if (settled) return;
      received += chunk.length;
      if (received > MAX_BODY_BYTES) {
        settled = true;
        const err = new Error('payload too large');
        err.status = 413;
        req.removeAllListeners('data');
        req.removeAllListeners('end');
        req.resume();
        reject(err);
        return;
      }
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        const data = Buffer.concat(chunks).toString('utf8');
        resolve(JSON.parse(data || '{}'));
      } catch (err) {
        if (!err.status) err.status = 400;
        reject(err);
      }
    });
    req.on('error', err => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

function sendJson(res, status, payload, extraHeaders) {
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  }, extraHeaders || {}));
  res.end(JSON.stringify(payload));
}

function sendEvent(player, eventName, data) {
  const res = player && player.res;
  if (!res || res.writableEnded || res.destroyed) return false;
  try {
    res.write(`event: ${eventName}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    return true;
  } catch (err) {
    try { res.end(); } catch (_) {}
    if (player && player.res === res) {
      player.res = null;
      clearPlayerHeartbeatTimer(player);
      if (player.playerId) scheduleDisconnectCleanup(player.playerId, 'opponent_disconnected', RECONNECT_GRACE_MS);
    }
    return false;
  }
}

function broadcast(roomId, eventName, data) {
  const room = rooms[roomId];
  if (!room) return;
  room.players.forEach((playerId) => {
    const player = players[playerId];
    if (player) sendEvent(player, eventName, data);
  });
}


function closeAirSocket(player, code) {
  if (!player || !player.airSocket) return;
  const socket = player.airSocket;
  const roomId = player.roomId;
  player.airSocket = null;
  player.airBuffer = Buffer.alloc(0);
  try { wsSendClose(socket, code || 1000); } catch (_) {}
  try { socket.destroy(); } catch (_) {}
  if (roomId && rooms[roomId] && rooms[roomId].gameType === 'airhockey') {
    airMaybeStartRealtime(rooms[roomId]);
  }
}

function wsCreateFrame(opcode, payloadBuffer) {
  const payload = Buffer.isBuffer(payloadBuffer) ? payloadBuffer : Buffer.from(payloadBuffer || '');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x80 | opcode;
  return Buffer.concat([header, payload]);
}

function wsSendJson(socket, payload) {
  if (!socket || socket.destroyed) return false;
  try {
    socket.write(wsCreateFrame(0x1, Buffer.from(JSON.stringify(payload))));
    return true;
  } catch (_) {
    return false;
  }
}

function wsSendClose(socket, code) {
  if (!socket || socket.destroyed) return false;
  const buf = Buffer.alloc(2);
  buf.writeUInt16BE(code || 1000, 0);
  try { socket.write(wsCreateFrame(0x8, buf)); return true; } catch (_) { return false; }
}

function wsSendPong(socket, payload) {
  if (!socket || socket.destroyed) return false;
  try { socket.write(wsCreateFrame(0xA, payload || Buffer.alloc(0))); return true; } catch (_) { return false; }
}

function wsSendPing(socket) {
  if (!socket || socket.destroyed) return false;
  try { socket.write(wsCreateFrame(0x9, Buffer.from(String(now())))); return true; } catch (_) { return false; }
}

function wsParseFrames(player) {
  let buffer = player.airBuffer || Buffer.alloc(0);
  const socket = player.airSocket;
  if (!socket || socket.destroyed) return;
  while (buffer.length >= 2) {
    const first = buffer[0];
    const second = buffer[1];
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let len = second & 0x7f;
    let offset = 2;
    if (len === 126) {
      if (buffer.length < offset + 2) break;
      len = buffer.readUInt16BE(offset);
      offset += 2;
    } else if (len === 127) {
      if (buffer.length < offset + 8) break;
      const bigLen = buffer.readBigUInt64BE(offset);
      if (bigLen > BigInt(1024 * 1024)) {
        closeAirSocket(player, 1009);
        return;
      }
      len = Number(bigLen);
      offset += 8;
    }
    const maskOffset = offset;
    if (masked) offset += 4;
    if (buffer.length < offset + len) break;
    let payload = buffer.slice(offset, offset + len);
    if (masked) {
      const mask = buffer.slice(maskOffset, maskOffset + 4);
      const unmasked = Buffer.alloc(len);
      for (let i = 0; i < len; i += 1) unmasked[i] = payload[i] ^ mask[i % 4];
      payload = unmasked;
    }
    buffer = buffer.slice(offset + len);

    player.airLastFrameAt = now();
    if (opcode === 0x8) {
      closeAirSocket(player, 1000);
      player.airBuffer = buffer;
      return;
    }
    if (opcode === 0x9) {
      wsSendPong(socket, payload);
      continue;
    }
    if (opcode === 0xA) {
      player.airLastPongAt = now();
      continue;
    }
    if (!masked) {
      // 브라우저가 보내는 클라이언트 프레임은 반드시 masked여야 한다. 깨진 프레임이면 즉시 닫아 서버 상태 오염을 막는다.
      closeAirSocket(player, 1002);
      return;
    }
    if (opcode !== 0x1) continue;
    try {
      const msg = JSON.parse(payload.toString('utf8'));
      if (msg && msg.type === 'input') airHandleInput(player, msg);
      if (msg && msg.type === 'ping') wsSendJson(socket, { type: 'pong', t: now() });
    } catch (_) {}
  }
  player.airBuffer = buffer;
}

function handleAirHockeyUpgrade(req, socket, head) {
  const url = new URL(req.url || '/', 'http://localhost');
  const playerId = url.searchParams.get('playerId');
  const player = players[playerId];
  const key = req.headers['sec-websocket-key'];
  const room = player && player.roomId ? rooms[player.roomId] : null;
  if (!key || !player || !room || room.gameType !== 'airhockey' || player.status !== 'matched') {
    try { socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); } catch (_) {}
    socket.destroy();
    return;
  }

  const accept = crypto.createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
  socket.write([
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    'Sec-WebSocket-Accept: ' + accept,
    '\r\n'
  ].join('\r\n'));
  socket.setNoDelay(true);

  if (player.airSocket && !player.airSocket.destroyed) closeAirSocket(player, 1000);
  player.airSocket = socket;
  player.airBuffer = Buffer.from(head || Buffer.alloc(0));
  clearPlayerDisconnectTimer(player);
  player.airLastFrameAt = now();
  player.airLastPongAt = now();
  player.airLastInputSeq = Number.isFinite(player.airLastInputSeq) ? player.airLastInputSeq : 0;
  room.airLastTickAt = now();
  room.airLastBroadcastAt = 0;

  wsSendJson(socket, {
    type: 'hello',
    playerId: player.playerId,
    roomId: room.roomId,
    playerIndex: player.playerIndex,
    playerName: player.playerName,
    players: getRoomPlayerNames(room)
  });
  airBroadcastState(room);
  airMaybeStartRealtime(room);
  if (player.airBuffer.length) wsParseFrames(player);

  socket.on('data', (chunk) => {
    if (player.airSocket !== socket) return;
    player.airLastFrameAt = now();
    player.airBuffer = Buffer.concat([player.airBuffer || Buffer.alloc(0), chunk]);
    wsParseFrames(player);
  });
  socket.on('close', () => {
    if (player.airSocket !== socket) return;
    player.airSocket = null;
    player.airBuffer = Buffer.alloc(0);
    player.airLastInputSeq = 0;
    airMaybeStartRealtime(room);
    if (!player.res) scheduleDisconnectCleanup(player.playerId, 'opponent_disconnected', RECONNECT_GRACE_MS);
  });
  socket.on('error', () => {
    if (player.airSocket === socket) {
      player.airSocket = null;
      player.airBuffer = Buffer.alloc(0);
      player.airLastInputSeq = 0;
      airMaybeStartRealtime(room);
      if (!player.res) scheduleDisconnectCleanup(player.playerId, 'opponent_disconnected', RECONNECT_GRACE_MS);
    }
  });
}

function removeFromQueue(gameType, playerId) {
  if (!gameType || !queues[gameType]) return;
  queues[gameType] = queues[gameType].filter(entry => entry.playerId !== playerId);
}

function deletePlayer(playerId) {
  const player = players[playerId];
  if (!player) return;
  closeAirSocket(player, 1000);
  clearPlayerDisconnectTimer(player);
  clearPlayerHeartbeatTimer(player);
  if (player.res && !player.res.writableEnded) {
    try { player.res.end(); } catch (_) {}
  }
  removeFromQueue(player.gameType, playerId);
  delete players[playerId];
}

function endRoom(roomId, reason, message) {
  const room = rooms[roomId];
  if (!room) return;
  const finalSnapshot = getRoomSnapshot(room);
  room.players.forEach((pid) => {
    const player = players[pid];
    if (!player) return;
    const resolvedReason = typeof reason === 'function' ? reason(pid, player, room) : reason;
    const resolvedMessage = typeof message === 'function' ? message(pid, player, room) : message;
    player.roomId = null;
    player.playerIndex = null;
    player.status = 'ended';
    player.endedAt = now();
    closeAirSocket(player, 1000);
    clearPlayerDisconnectTimer(player);
    clearPlayerHeartbeatTimer(player);
    if (player.res && !player.res.writableEnded) {
      sendEvent(player, 'end', {
        roomId,
        reason: resolvedReason || 'room_closed',
        message: resolvedMessage || '게임이 종료되었어.',
        snapshot: finalSnapshot
      });
      try { player.res.end(); } catch (_) {}
      player.res = null;
    }
  });
  delete rooms[roomId];
}

function cleanupPlayer(playerId, reason) {
  const player = players[playerId];
  if (!player) return;

  if (player.status === 'queued') {
    deletePlayer(playerId);
    return;
  }

  if (player.roomId && rooms[player.roomId]) {
    const roomId = player.roomId;
    const leavingPlayerId = playerId;
    const finalReason = reason || 'opponent_disconnected';
    if (finalReason === 'player_left') {
      endRoom(
        roomId,
        (pid) => (pid === leavingPlayerId ? 'self_left' : 'player_left'),
        (pid) => (pid === leavingPlayerId ? '네가 방을 나가서 게임을 종료했어.' : '상대가 방을 나가서 게임이 종료되었어.')
      );
    } else {
      const finalMessage = finalReason === 'match_timeout'
        ? '상대 연결이 완료되지 않아 방이 종료되었어.'
        : '상대가 연결을 종료했어.';
      endRoom(roomId, finalReason, finalMessage);
    }
    deletePlayer(playerId);
    return;
  }

  deletePlayer(playerId);
}

function pruneStaleState() {
  const t = now();

  Object.keys(queues).forEach((gameType) => {
    queues[gameType] = queues[gameType].filter((entry) => {
      const player = players[entry.playerId];
      if (!player) return false;
      const stale = player.status === 'queued' && (t - player.joinedAt > QUEUE_TTL_MS);
      if (stale) {
        if (player.res && !player.res.writableEnded) {
          sendEvent(player, 'end', {
            reason: 'queue_timeout',
            message: '매칭 대기 시간이 지나서 대기열에서 제거되었어. 다시 온라인 플레이를 눌러줘.'
          });
        }
        if (player.roomId && rooms[player.roomId]) {
          // 비정상적으로 queued 상태 플레이어가 방에 남아있는 엣지 케이스도
          // 일반 종료 경로(endRoom)를 태워 SSE/WS/타이머를 모두 정리한다.
          endRoom(player.roomId, 'queue_timeout', (pid) => (
            pid === entry.playerId
              ? '매칭 대기 시간이 지나서 대기열에서 제거되었어. 다시 온라인 플레이를 눌러줘.'
              : '상대가 연결에서 빠져서 방이 종료되었어.'
          ));
        }
        deletePlayer(entry.playerId);
        return false;
      }
      return true;
    });
  });

  Object.keys(players).forEach((playerId) => {
    const player = players[playerId];
    if (!player) return;

    if (player.status === 'matched' && !player.res && t - (player.matchedAt || t) > MATCHED_NO_SSE_TTL_MS) {
      // 에어하키는 플레이 중 핵심 연결이 WebSocket이므로, SSE만 끊긴 상태로 방을 종료하지 않는다.
      if (isPlayerInAirHockeyRoom(player) && hasActiveAirSocket(player)) return;
      if (player.roomId && rooms[player.roomId]) {
        endRoom(player.roomId, 'match_timeout', '매칭 후 연결이 완료되지 않아 방이 종료되었어.');
      }
      deletePlayer(playerId);
      return;
    }

    if (player.status === 'ended' && t - (player.endedAt || t) > ENDED_PLAYER_TTL_MS) {
      deletePlayer(playerId);
    }
  });
}

setInterval(pruneStaleState, 5 * 1000).unref();

const RECONNECT_GRACE_MS = 8000;
const SSE_HEARTBEAT_MS = 20000;

function maybeStartRoom(roomId) {
  const room = rooms[roomId];
  if (!room || room.startedAt) return;
  const everyoneConnected = room.players.every(pid => {
    const p = players[pid];
    return p && p.status === 'matched' && p.res && !p.res.writableEnded;
  });
  if (!everyoneConnected) return;

  room.startedAt = now();
  room.players.forEach((pid) => {
    const player = players[pid];
    if (!player) return;
    sendEvent(player, 'start', {
      roomId,
      playerId: player.playerId,
      playerName: player.playerName,
      playerIndex: player.playerIndex,
      players: getRoomPlayerNames(room),
      gameType: room.gameType,
      snapshot: getRoomSnapshot(room)
    });
  });
}

async function handleJoin(req, res) {
  try {
    pruneStaleState();
    const body = await readJsonBody(req);
    const gameType = body.gameType;
    if (!gameType || !queues[gameType]) {
      return sendJson(res, 400, { error: 'invalid game type' });
    }

    const playerId = uuid();
    const playerName = normalizePlayerName(body.playerName);
    const player = {
      playerId,
      playerName,
      gameType,
      roomId: null,
      playerIndex: null,
      res: null,
      status: 'queued',
      joinedAt: now(),
      airSocket: null,
      airBuffer: Buffer.alloc(0)
    };
    players[playerId] = player;

    const queue = queues[gameType];
    let matched = false;
    let roomId = null;
    let playerIndex = null;

    while (queue.length > 0) {
      const otherEntry = queue.shift();
      const otherPlayer = players[otherEntry.playerId];
      if (!otherPlayer || otherPlayer.status !== 'queued') continue;

      roomId = uuid();
      const firstPlayerId = Math.random() < 0.5 ? otherPlayer.playerId : playerId;
      const secondPlayerId = firstPlayerId === otherPlayer.playerId ? playerId : otherPlayer.playerId;
      rooms[roomId] = {
        roomId,
        gameType,
        players: [firstPlayerId, secondPlayerId],
        createdAt: now(),
        startedAt: 0,
        turnIndex: 0,
        revision: 0,
        state: gameType === 'dab' ? { dab: createDabState() } : gameType === 'axis4' ? { axis4: createAxis4State() } : gameType === 'gomoku' ? { gomoku: createGomokuState() } : gameType === 'quoridor' ? { quoridor: createQuoridorState() } : gameType === 'blokus' ? { blokus: createBlokusState() } : gameType === 'orbito' ? { orbito: createOrbitoState() } : gameType === 'halma' ? { halma: createHalmaState() } : gameType === 'airhockey' ? { airhockey: createAirHockeyState() } : {}
      };

      otherPlayer.roomId = roomId;
      otherPlayer.playerIndex = firstPlayerId === otherPlayer.playerId ? 0 : 1;
      otherPlayer.status = 'matched';
      otherPlayer.matchedAt = now();

      player.roomId = roomId;
      player.playerIndex = firstPlayerId === playerId ? 0 : 1;
      player.status = 'matched';
      player.matchedAt = now();

      matched = true;
      playerIndex = player.playerIndex;
      break;
    }

    if (!matched) {
      queue.push({ playerId });
    }

    return sendJson(res, 200, {
      playerId,
      playerName,
      matched,
      roomId: matched ? roomId : null,
      playerIndex: matched ? playerIndex : null
    });
  } catch (err) {
    console.error(err);
    return sendJson(res, err && err.status ? err.status : 500, { error: err && err.message ? err.message : 'internal error' });
  }
}

function handleEvents(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const playerId = url.searchParams.get('playerId');
  const player = players[playerId];
  if (!playerId || !player) {
    res.writeHead(404);
    res.end();
    return;
  }

  const previousRes = player.res;
  if (previousRes && previousRes !== res && !previousRes.writableEnded) {
    try { previousRes.end(); } catch (_) {}
  }
  clearPlayerHeartbeatTimer(player);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'X-Accel-Buffering': 'no'
  });
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
  res.write('\n');

  player.res = res;
  clearPlayerDisconnectTimer(player);
  player.heartbeatTimer = setInterval(() => {
    const current = players[playerId];
    if (!current || current.res !== res || res.writableEnded) {
      clearPlayerHeartbeatTimer(player);
      return;
    }
    try {
      res.write(': ping\n\n');
    } catch (_) {}
  }, SSE_HEARTBEAT_MS);

  sendEvent(player, 'hello', {
    playerId,
    roomId: player.roomId || null
  });

  if (player.roomId && rooms[player.roomId]) {
    const room = rooms[player.roomId];
    if (room.startedAt) {
      sendEvent(player, 'state_sync', {
        roomId: room.roomId,
        players: getRoomPlayerNames(room),
        snapshot: getRoomSnapshot(room)
      });
    } else {
      maybeStartRoom(player.roomId);
    }
  }

  req.on('close', () => {
    const current = players[playerId];
    if (!current || current.res !== res) return;
    current.res = null;
    clearPlayerHeartbeatTimer(current);
    scheduleDisconnectCleanup(playerId, 'opponent_disconnected', RECONNECT_GRACE_MS);
  });
}

function normalizeIncomingMove(move) {
  if (!move) return null;
  if (move.kind && Object.prototype.hasOwnProperty.call(move, 'payload')) return move;
  if (Object.prototype.hasOwnProperty.call(move, 'data')) {
    const payload = move.data;
    if (payload && typeof payload === 'object' && !Array.isArray(payload) && payload.kind && Object.prototype.hasOwnProperty.call(payload, 'payload')) {
      return payload;
    }
    return { kind: 'legacy', payload };
  }
  return { kind: 'legacy', payload: move };
}

async function handleMove(req, res) {
  try {
    const body = await readJsonBody(req);
    const { playerId, move } = body;
    const player = players[playerId];
    if (!player) return sendJson(res, 400, { error: 'invalid player' });

    const roomId = player.roomId;
    const room = roomId ? rooms[roomId] : null;
    if (!room) return sendJson(res, 400, { error: 'invalid room' });
    if (!room.startedAt || player.status !== 'matched') return sendJson(res, 409, { error: 'room not ready' });
    if (room.players[player.playerIndex] !== playerId) return sendJson(res, 403, { error: 'player not in room slot' });
    if (room.gameType === 'airhockey') {
      return sendJson(res, 400, { error: 'airhockey uses websocket input' });
    }
    if (room.turnIndex !== player.playerIndex) {
      return sendJson(res, 409, { error: 'not your turn', expectedTurn: room.turnIndex, actualTurn: player.playerIndex });
    }

    const normalized = normalizeIncomingMove(move);
    if (!normalized || !normalized.kind) return sendJson(res, 400, { error: 'invalid move' });

    let authoritativeMove = normalized;
    let gameOver = false;
    let keepTurn = false;

    const expectedKindByGame = { dab: 'dab', axis4: 'axis4', gomoku: 'gomoku', quoridor: 'quoridor', blokus: 'blokus', orbito: 'orbito', halma: 'halma' };
    if (expectedKindByGame[room.gameType] && normalized.kind !== expectedKindByGame[room.gameType]) {
      return sendJson(res, 400, { error: 'move kind does not match room game type', expectedKind: expectedKindByGame[room.gameType], actualKind: normalized.kind });
    }

    if (room.gameType === 'dab') {
      const dabState = room.state && room.state.dab;
      if (!dabState) return sendJson(res, 500, { error: 'dab state missing' });
      const dabResult = applyDabMove(dabState, normalized.payload, player.playerIndex);
      if (!dabResult.ok) return sendJson(res, dabResult.status || 400, { error: dabResult.error || 'invalid dab move' });
      authoritativeMove = dabResult.authoritativeMove;
      gameOver = dabResult.gameOver;
      keepTurn = dabResult.keepTurn;
    } else if (room.gameType === 'axis4') {
      const axisState = room.state && room.state.axis4;
      if (!axisState) return sendJson(res, 500, { error: 'axis4 state missing' });
      const axisResult = applyAxis4Move(axisState, normalized.payload, player.playerIndex);
      if (!axisResult.ok) return sendJson(res, axisResult.status || 400, { error: axisResult.error || 'invalid axis4 move' });
      authoritativeMove = axisResult.authoritativeMove;
      gameOver = axisResult.gameOver;
      keepTurn = axisResult.keepTurn;
    } else if (room.gameType === 'gomoku') {
      const gomokuState = room.state && room.state.gomoku;
      if (!gomokuState) return sendJson(res, 500, { error: 'gomoku state missing' });
      const gomokuResult = applyGomokuMove(gomokuState, normalized.payload, player.playerIndex);
      if (!gomokuResult.ok) return sendJson(res, gomokuResult.status || 400, { error: gomokuResult.error || 'invalid gomoku move' });
      authoritativeMove = gomokuResult.authoritativeMove;
      gameOver = gomokuResult.gameOver;
      keepTurn = false;
    } else if (room.gameType === 'quoridor') {
      const quoridorState = room.state && room.state.quoridor;
      if (!quoridorState) return sendJson(res, 500, { error: 'quoridor state missing' });
      const quoridorResult = applyQuoridorMove(quoridorState, normalized.payload, player.playerIndex);
      if (!quoridorResult.ok) return sendJson(res, quoridorResult.status || 400, { error: quoridorResult.error || 'invalid quoridor move' });
      authoritativeMove = quoridorResult.authoritativeMove;
      gameOver = quoridorResult.gameOver;
      keepTurn = false;
    } else if (room.gameType === 'blokus') {
      const blokusState = room.state && room.state.blokus;
      if (!blokusState) return sendJson(res, 500, { error: 'blokus state missing' });
      const blokusResult = applyBlokusMove(blokusState, normalized.payload, player.playerIndex);
      if (!blokusResult.ok) return sendJson(res, blokusResult.status || 400, { error: blokusResult.error || 'invalid blokus move' });
      authoritativeMove = blokusResult.authoritativeMove;
      gameOver = blokusResult.gameOver;
      keepTurn = false;
      if (!gameOver || typeof blokusResult.nextTurnIndex === 'number') {
        room.turnIndex = typeof blokusResult.nextTurnIndex === 'number' ? blokusResult.nextTurnIndex : blokusState.current;
      }
    } else if (room.gameType === 'orbito') {
      const orbitoState = room.state && room.state.orbito;
      if (!orbitoState) return sendJson(res, 500, { error: 'orbito state missing' });
      const orbitoResult = applyOrbitoMove(orbitoState, normalized.payload, player.playerIndex);
      if (!orbitoResult.ok) return sendJson(res, orbitoResult.status || 400, { error: orbitoResult.error || 'invalid orbito move' });
      authoritativeMove = orbitoResult.authoritativeMove;
      gameOver = orbitoResult.gameOver;
      keepTurn = orbitoResult.keepTurn;
    } else if (room.gameType === 'halma') {
      const halmaState = room.state && room.state.halma;
      if (!halmaState) return sendJson(res, 500, { error: 'halma state missing' });
      const halmaResult = applyHalmaMove(halmaState, normalized.payload, player.playerIndex);
      if (!halmaResult.ok) return sendJson(res, halmaResult.status || 400, { error: halmaResult.error || 'invalid halma move' });
      authoritativeMove = halmaResult.authoritativeMove;
      gameOver = halmaResult.gameOver;
      keepTurn = halmaResult.keepTurn;
      if (!gameOver || typeof halmaResult.nextTurnIndex === 'number') {
        room.turnIndex = typeof halmaResult.nextTurnIndex === 'number' ? halmaResult.nextTurnIndex : halmaState.current;
      }
    }

    if (room.gameType !== 'halma' && room.gameType !== 'blokus' && !gameOver && !keepTurn) {
      room.turnIndex = player.playerIndex === 0 ? 1 : 0;
    }
    room.revision = (typeof room.revision === 'number' ? room.revision : 0) + 1;

    const snapshot = getRoomSnapshot(room);
    const payload = {
      move: authoritativeMove,
      playerId,
      playerIndex: player.playerIndex,
      roomId,
      gameType: room.gameType,
      turnIndex: room.turnIndex,
      gameOver,
      keepTurn,
      timestamp: now(),
      snapshot
    };
    broadcast(roomId, 'move', payload);
    if (gameOver) {
      endRoom(roomId, 'game_over', '게임이 종료되었어. 결과를 확인해줘.');
    }
    return sendJson(res, 200, { ok: true, nextTurn: room.turnIndex, keepTurn, gameOver, move: authoritativeMove, snapshot });
  } catch (err) {
    console.error(err);
    return sendJson(res, err && err.status ? err.status : 500, { error: err && err.message ? err.message : 'internal error' });
  }
}


function handleState(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const playerId = url.searchParams.get('playerId');
  const player = players[playerId];
  if (!player) return sendJson(res, 400, { error: 'invalid player' });
  const room = player.roomId ? rooms[player.roomId] : null;
  if (!room) return sendJson(res, 400, { error: 'invalid room' });
  return sendJson(res, 200, { ok: true, roomId: room.roomId, snapshot: getRoomSnapshot(room), playerIndex: player.playerIndex });
}

async function handleChat(req, res) {
  try {
    const body = await readJsonBody(req);
    const { playerId, message } = body;
    const player = players[playerId];
    if (!player) return sendJson(res, 400, { error: 'invalid player' });

    const roomId = player.roomId;
    const room = roomId ? rooms[roomId] : null;
    if (!room) return sendJson(res, 400, { error: 'invalid room' });
    if (!room.startedAt || player.status !== 'matched') return sendJson(res, 409, { error: 'room not ready' });

    const cleanMessage = String(message || '').slice(0, 300).trim();
    if (!cleanMessage) return sendJson(res, 400, { error: 'empty message' });

    broadcast(roomId, 'chat', {
      roomId,
      message: cleanMessage,
      playerIndex: player.playerIndex,
      playerName: player.playerName,
      timestamp: now()
    });
    return sendJson(res, 200, { ok: true });
  } catch (err) {
    console.error(err);
    return sendJson(res, err && err.status ? err.status : 500, { error: err && err.message ? err.message : 'internal error' });
  }
}

function getQueueCounts(excludePlayerId) {
  const counts = {};
  Object.keys(queues).forEach((gameType) => {
    counts[gameType] = queues[gameType].reduce((acc, entry) => {
      if (!entry || !entry.playerId) return acc;
      if (excludePlayerId && entry.playerId === excludePlayerId) return acc;
      const player = players[entry.playerId];
      if (!player || player.status !== 'queued' || player.gameType !== gameType) return acc;
      return acc + 1;
    }, 0);
  });
  return counts;
}

function handleQueueStatus(req, res) {
  pruneStaleState();
  const url = new URL(req.url, 'http://localhost');
  const playerId = url.searchParams.get('playerId') || null;
  return sendJson(res, 200, { ok: true, counts: getQueueCounts(playerId) });
}

async function handleLeave(req, res) {
  try {
    const body = await readJsonBody(req);
    const { playerId } = body;
    if (playerId && players[playerId]) cleanupPlayer(playerId, 'player_left');
    return sendJson(res, 200, { ok: true });
  } catch (err) {
    console.error(err);
    return sendJson(res, err && err.status ? err.status : 500, { error: err && err.message ? err.message : 'internal error' });
  }
}

function sendNotFound(req, res) {
  const wantsJson = req && req.headers && typeof req.headers.accept === 'string' && req.headers.accept.indexOf('application/json') !== -1;
  if (wantsJson || (req && req.method && req.method !== 'GET' && req.method !== 'HEAD')) {
    return sendJson(res, 404, { ok: false, error: 'not found' });
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

function looksLikeApiPath(urlPath) {
  const parts = String(urlPath || '/').split('/').filter(Boolean);
  if (!parts.length) return false;
  const last = parts[parts.length - 1];
  const penultimate = parts.length > 1 ? parts[parts.length - 2] : '';
  return API_ENDPOINTS.includes(last) || (penultimate === 'api' && API_ENDPOINTS.includes(last));
}

function serveStatic(req, res) {
  const rawUrl = typeof req.url === 'string' ? req.url : '/';
  const rawPath = rawUrl.split('?')[0].split('#')[0] || '/';
  let urlPath;
  try {
    urlPath = decodeURIComponent(rawPath);
  } catch (err) {
    res.writeHead(400);
    res.end('Bad Request');
    return;
  }

  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

  const publicRoot = path.resolve(__dirname, 'public');
  const requestedRelPath = urlPath.replace(/^\/+/, '');
  const requestedPath = path.resolve(publicRoot, requestedRelPath);
  const requestedRelative = path.relative(publicRoot, requestedPath);

  if (requestedRelative.startsWith('..') || path.isAbsolute(requestedRelative)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
  };

  const sendFile = (targetPath) => {
    const ext = path.extname(targetPath).toLowerCase();
    fs.readFile(targetPath, (readErr, data) => {
      if (readErr) {
        console.error('Failed to read static file:', targetPath, readErr);
        res.writeHead(500);
        res.end('Internal error');
        return;
      }
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      res.end(data);
    });
  };

  fs.stat(requestedPath, (err, stat) => {
    if (!err && stat.isFile()) {
      sendFile(requestedPath);
      return;
    }

    const hasExtension = path.extname(urlPath) !== '';
    if (!hasExtension) {
      if (looksLikeApiPath(urlPath)) {
        sendNotFound(req, res);
        return;
      }
      const fallback = path.join(publicRoot, 'index.html');
      fs.stat(fallback, (fallbackErr, fallbackStat) => {
        if (fallbackErr || !fallbackStat.isFile()) {
          sendNotFound(req, res);
          return;
        }
        sendFile(fallback);
      });
      return;
    }

    sendNotFound(req, res);
  });
}

const PORT = process.env.PORT || 3000;
function normalizeRoutePath(pathname) {
  if (!pathname) return '/';
  if (pathname.length > 1) return pathname.replace(/\/+$/, '');
  return pathname;
}

function routeMatches(pathname, endpoint) {
  const normalizedPath = normalizeRoutePath(pathname);
  const normalizedEndpoint = normalizeRoutePath(endpoint);
  if (normalizedPath === normalizedEndpoint || normalizedPath === normalizeRoutePath('/api' + normalizedEndpoint)) return true;
  const suffixes = [normalizedEndpoint, normalizeRoutePath('/api' + normalizedEndpoint)];
  return suffixes.some((suffix) => normalizedPath.length > suffix.length && normalizedPath.endsWith(suffix));
}

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }
  if (req.method === 'POST' && routeMatches(pathname, '/join')) return void handleJoin(req, res);
  if (req.method === 'GET' && routeMatches(pathname, '/events')) return void handleEvents(req, res);
  if (req.method === 'GET' && routeMatches(pathname, '/state')) return void handleState(req, res);
  if (req.method === 'GET' && routeMatches(pathname, '/queue-status')) return void handleQueueStatus(req, res);
  if (req.method === 'POST' && routeMatches(pathname, '/move')) return void handleMove(req, res);
  if (req.method === 'POST' && routeMatches(pathname, '/chat')) return void handleChat(req, res);
  if (req.method === 'POST' && routeMatches(pathname, '/leave')) return void handleLeave(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendNotFound(req, res);
  return serveStatic(req, res);
});

server.on('upgrade', (req, socket, head) => {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  if (routeMatches(pathname, '/airhockey-ws')) return handleAirHockeyUpgrade(req, socket, head);
  try { socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'); } catch (_) {}
  socket.destroy();
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
