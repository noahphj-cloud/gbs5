const BASE = process.env.TEST_BASE || 'http://127.0.0.1:3000';

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT: ' + msg);
}

let seq = 0;
const RUN_MARK = (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).slice(-6);
function nextName(prefix) {
  seq += 1;
  const safePrefix = String(prefix || 'N').normalize('NFC').replace(/\s+/g, '').slice(0, 2) || 'N';
  return (safePrefix + RUN_MARK.slice(0, 2) + seq.toString(36).padStart(4, '0')).slice(0, 8);
}
function nextClientId(prefix) {
  seq += 1;
  const safePrefix = String(prefix || 'cid').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 8);
  return (safePrefix + '_' + RUN_MARK + '_' + seq.toString(36)).padEnd(18, 'x').slice(0, 24);
}

async function jpost(path, body, options = {}) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text || '{}'); } catch (e) { throw new Error(`Bad JSON from ${path}: ${text}`); }
  if (!res.ok && !options.allowError) throw new Error(`${path} ${res.status}: ${JSON.stringify(data)}`);
  return { status: res.status, data };
}
async function jget(path) {
  const res = await fetch(BASE + path);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text || '{}'); } catch (e) { throw new Error(`Bad JSON from ${path}: ${text}`); }
  if (!res.ok) throw new Error(`${path} ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

class SSEClient {
  constructor(url) {
    this.url = url;
    this.events = [];
    this.listeners = new Map();
    this.abort = new AbortController();
    this.done = this._connect();
  }
  on(name, fn) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(fn);
  }
  emit(name, data) {
    this.events.push({ name, data, at: Date.now() });
    const ls = this.listeners.get(name) || [];
    for (const fn of ls) fn(data);
  }
  waitFor(name, predicate, timeout = 5000) {
    predicate = predicate || (() => true);
    for (const ev of this.events) {
      if (ev.name === name && predicate(ev.data)) return Promise.resolve(ev.data);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout waiting for event ${name}`));
      }, timeout);
      const handler = (data) => {
        if (!predicate(data)) return;
        cleanup();
        resolve(data);
      };
      const cleanup = () => {
        clearTimeout(timer);
        const arr = this.listeners.get(name) || [];
        const idx = arr.indexOf(handler);
        if (idx >= 0) arr.splice(idx, 1);
      };
      this.on(name, handler);
    });
  }
  async _connect() {
    try {
      const res = await fetch(this.url, { signal: this.abort.signal, headers: { Accept: 'text/event-stream' } });
      if (!res.ok) throw new Error(`SSE ${res.status}`);
      const decoder = new TextDecoder();
      let buf = '';
      for await (const chunk of res.body) {
        buf += decoder.decode(chunk, { stream: true });
        while (buf.includes('\n\n')) {
          const idx = buf.indexOf('\n\n');
          const raw = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          this._parseEvent(raw);
        }
      }
    } catch (err) {
      if (!err || err.name !== 'AbortError') throw err;
    }
  }
  _parseEvent(raw) {
    if (!raw.trim()) return;
    let name = 'message';
    const dataLines = [];
    for (const line of raw.split(/\n/)) {
      if (!line || line.startsWith(':')) continue;
      if (line.startsWith('event:')) name = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    let data = dataLines.join('\n');
    try { data = JSON.parse(data); } catch (_) {}
    this.emit(name, data);
  }
  close() { this.abort.abort(); this.done && this.done.catch(() => {}); }
}

async function cleanupPlayers(ids) {
  for (const id of ids) {
    if (!id) continue;
    try { await jpost('/leave', { playerId: id }); } catch (_) {}
  }
}

async function createMatch(gameType, nameA, nameB, clientA, clientB, streakA = 0, streakB = 0) {
  const p1 = (await jpost('/join', { gameType, clientId: clientA, playerName: nameA, playerStreak: streakA })).data;
  const p2 = (await jpost('/join', { gameType, clientId: clientB, playerName: nameB, playerStreak: streakB })).data;
  assert(!p1.matched && p2.matched, 'matching flow for ' + gameType);
  const s1 = new SSEClient(`${BASE}/events?playerId=${encodeURIComponent(p1.playerId)}`);
  const s2 = new SSEClient(`${BASE}/events?playerId=${encodeURIComponent(p2.playerId)}`);
  const start1 = await s1.waitFor('start', d => d && d.roomId, 4000);
  const start2 = await s2.waitFor('start', d => d && d.roomId, 4000);
  assert(start1.roomId === start2.roomId, 'same room for ' + gameType);
  const playerIdByIndex = [];
  playerIdByIndex[start1.playerIndex] = p1.playerId;
  playerIdByIndex[start2.playerIndex] = p2.playerId;
  return {
    p1, p2, s1, s2, start1, start2,
    playerIdByIndex,
    playerIndexById: {
      [p1.playerId]: start1.playerIndex,
      [p2.playerId]: start2.playerIndex
    }
  };
}

async function closeMatch(ctx) {
  if (!ctx) return;
  try { if (ctx.s1) ctx.s1.close(); } catch (_) {}
  try { if (ctx.s2) ctx.s2.close(); } catch (_) {}
  await cleanupPlayers([ctx.p1 && ctx.p1.playerId, ctx.p2 && ctx.p2.playerId]);
}

const HALMA_ROWS = [1,2,3,4,13,12,11,10,9,10,11,12,13,4,3,2,1];
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

function getFirstHalmaMove(snapshot, playerIndex) {
  const state = snapshot.state.halma;
  const occupancy = state.occupancy;
  const player = playerIndex + 1;
  for (let i = 0; i < occupancy.length; i += 1) {
    if (occupancy[i] !== player) continue;
    const cell = halmaCells[i];
    for (const nid of cell.neighbors) {
      if (occupancy[nid] === 0) return { action: 'move', from: i, to: nid };
    }
    for (const [dx, dy] of HALMA_DIRS) {
      const mid = halmaCellMap.get(`${cell.gx + dx},${cell.gy + dy}`);
      const to = halmaCellMap.get(`${cell.gx + dx * 2},${cell.gy + dy * 2}`);
      if (mid == null || to == null) continue;
      if (occupancy[mid] !== 0 && occupancy[to] === 0) return { action: 'move', from: i, to };
    }
  }
  throw new Error('No halma move found');
}

async function testMatchChatEnd() {
  const nameA = nextName('Al');
  const nameB = nextName('Be');
  const ctx = await createMatch('gomoku', nameA, nameB, nextClientId('a'), nextClientId('b'), 2, 5);
  const { p1, p2, s1, s2, start1, start2 } = ctx;
  try {
    const names = start1.players.map((item) => item.playerName).sort();
    assert(names[0] === [nameA, nameB].sort()[0] && names[1] === [nameA, nameB].sort()[1], 'player list should include both names');
    assert(start2.playerName === nameB, 'own name delivered');
    await jpost('/chat', { playerId: p1.playerId, message: 'hello', playerStreak: 2 });
    const c1 = await s1.waitFor('chat', d => d && d.message === 'hello', 3000);
    const c2 = await s2.waitFor('chat', d => d && d.message === 'hello', 3000);
    assert(c1.playerName === nameA && c2.playerName === nameA, 'chat carries sender name');
    assert(c1.playerStreak === 2, 'chat carries streak');

    const firstTurn = start1.snapshot.turnIndex;
    const pids = ctx.playerIdByIndex;
    const moveMap = {
      0: [[0,0], [0,1], [0,2], [0,3], [0,4]],
      1: [[10,10], [10,11], [10,12], [10,13], [10,14]]
    };
    const fillerMoves = [[18,18], [18,17], [18,16], [18,15]];
    const winnerMoves = moveMap[firstTurn].slice();
    const loserMoves = fillerMoves.slice();
    const order = [];
    for (let i = 0; i < 9; i += 1) {
      const idx = i % 2 === 0 ? firstTurn : (firstTurn === 0 ? 1 : 0);
      const payload = i % 2 === 0 ? winnerMoves.shift() : loserMoves.shift();
      order.push({ pid: pids[idx], move: payload });
    }
    for (const item of order) {
      const out = (await jpost('/move', { playerId: item.pid, move: { kind: 'gomoku', payload: item.move } })).data;
      assert(out.ok === true, 'move ok');
    }
    const end1 = await s1.waitFor('end', d => d && d.reason === 'game_over', 3000);
    const end2 = await s2.waitFor('end', d => d && d.reason === 'game_over', 3000);
    assert(end1.snapshot.state.gomoku.winner === firstTurn + 1, 'winner should be starter color');
    assert(end2.snapshot.state.gomoku.gameOver === true, 'snapshot gameover');
  } finally {
    await closeMatch(ctx);
  }
}

async function testQueueStatusAndLeave() {
  const q = (await jpost('/join', { gameType: 'axis4', clientId: nextClientId('qa'), playerName: nextName('Q'), playerStreak: 0 })).data;
  const q2 = (await jpost('/join', { gameType: 'axis4', clientId: nextClientId('qb'), playerName: nextName('R'), playerStreak: 0 })).data;
  try {
    const status1 = await jget('/queue-status?playerId=' + encodeURIComponent(q.playerId));
    assert(typeof status1.counts.axis4 === 'number', 'queue status returns count');
  } finally {
    await cleanupPlayers([q.playerId, q2.playerId]);
  }
}

async function testInvalidTurnRejected() {
  const ctx = await createMatch('gomoku', nextName('One'), nextName('Two'), nextClientId('ia'), nextClientId('ib'));
  try {
    const wrongPlayer = ctx.playerIdByIndex[ctx.start1.snapshot.turnIndex === 0 ? 1 : 0];
    const bad = await jpost('/move', { playerId: wrongPlayer, move: { kind: 'gomoku', payload: [5, 5] } }, { allowError: true });
    assert(bad.status === 409 && /not your turn/.test(String(bad.data.error || '')), 'wrong turn should fail');
  } finally {
    await closeMatch(ctx);
  }
}


async function testNameValidation() {
  const tooLongName = '가나다라마바사아자';
  const tooLongJoin = await jpost('/join', { gameType: 'gomoku', clientId: nextClientId('toolongj'), playerName: tooLongName, playerStreak: 0 }, { allowError: true });
  assert(tooLongJoin.status === 400, 'too-long join name should be rejected');
  assert(tooLongJoin.data.code === 'name_too_long', 'too-long join code should be name_too_long');

  const blankJoin = await jpost('/join', { gameType: 'gomoku', clientId: nextClientId('blankj'), playerName: '   ', playerStreak: 0 }, { allowError: true });
  assert(blankJoin.status === 400, 'blank join name should be rejected');
  assert(blankJoin.data.code === 'name_required', 'blank join code should be name_required');

  const tooLongProfile = await jpost('/profile', { clientId: nextClientId('toolongp'), playerName: tooLongName, playerStreak: 0 }, { allowError: true });
  assert(tooLongProfile.status === 400, 'too-long profile name should be rejected');
  assert(tooLongProfile.data.code === 'name_too_long', 'too-long profile code should be name_too_long');

  const blankProfile = await jpost('/profile', { clientId: nextClientId('blankp'), playerName: '   ', playerStreak: 0 }, { allowError: true });
  assert(blankProfile.status === 400, 'blank profile name should be rejected');
  assert(blankProfile.data.code === 'name_required', 'blank profile code should be name_required');
}

async function testDuplicateNamesAndProfileSync() {
  const cid1 = nextClientId('da');
  const cid2 = nextClientId('db');
  const name8 = ('가나다라' + RUN_MARK).slice(0, 8);
  const p1 = (await jpost('/join', { gameType: 'gomoku', clientId: cid1, playerName: name8, playerStreak: 0 })).data;
  assert(p1.playerName === name8, 'name should keep exact 8 graphemes');
  const dup = await jpost('/join', { gameType: 'axis4', clientId: cid2, playerName: '  ' + name8 + '  ', playerStreak: 0 }, { allowError: true });
  assert(dup.status === 409, 'duplicate name should be rejected');
  assert(dup.data.code === 'name_taken', 'duplicate code should be name_taken');

  const p2 = (await jpost('/join', { gameType: 'gomoku', clientId: nextClientId('dc'), playerName: nextName('Diff'), playerStreak: 3 })).data;
  const s1 = new SSEClient(`${BASE}/events?playerId=${encodeURIComponent(p1.playerId)}`);
  const s2 = new SSEClient(`${BASE}/events?playerId=${encodeURIComponent(p2.playerId)}`);
  try {
    await s1.waitFor('start', d => d && d.roomId, 4000);
    await s2.waitFor('start', d => d && d.roomId, 4000);
    const renameBlocked = await jpost('/profile', { playerId: p1.playerId, clientId: cid1, playerName: '새한글닉' }, { allowError: true });
    assert(renameBlocked.status === 409 && renameBlocked.data.code === 'name_change_only_in_menu', 'rename should be blocked during active match');
  } finally {
    s1.close();
    s2.close();
    await cleanupPlayers([p1.playerId, p2.playerId]);
  }

  const offlineCid = nextClientId('offline');
  const offlineName1 = nextName('닉A');
  const offlineName2 = nextName('닉B');
  const reserve1 = await jpost('/profile', { clientId: offlineCid, playerName: offlineName1, playerStreak: 7 });
  assert(reserve1.data.playerName === offlineName1, 'offline reserve should persist');
  const dupOffline = await jpost('/join', { gameType: 'axis4', clientId: nextClientId('other'), playerName: offlineName1, playerStreak: 0 }, { allowError: true });
  assert(dupOffline.status === 409 && dupOffline.data.code === 'name_taken', 'offline reserved name should block join');
  const reserve2 = await jpost('/profile', { clientId: offlineCid, playerName: offlineName2, playerStreak: 7 });
  assert(reserve2.data.playerName === offlineName2, 'offline rename should update claim');
  const freed = await jpost('/profile', { clientId: nextClientId('free'), playerName: offlineName1, playerStreak: 0 });
  assert(freed.data.playerName === offlineName1, 'old offline name should be reusable after rename');
}


async function testSingleClientMultiTabBlocked() {
  const sharedClientId = nextClientId('same');
  const join1 = (await jpost('/join', { gameType: 'gomoku', clientId: sharedClientId, playerName: nextName('탭A'), playerStreak: 1 })).data;
  const sse = new SSEClient(`${BASE}/events?playerId=${encodeURIComponent(join1.playerId)}`);
  try {
    await sse.waitFor('hello', d => d && d.playerId === join1.playerId, 3000);
    const blocked = await jpost('/join', { gameType: 'axis4', clientId: sharedClientId, playerName: join1.playerName, playerStreak: 1 }, { allowError: true });
    assert(blocked.status === 409, 'same client second online session should be blocked');
    assert(blocked.data.code === 'client_already_online', 'same client block code');

    const renameWhileActive = await jpost('/profile', { clientId: sharedClientId, playerName: nextName('바꿈') }, { allowError: true });
    assert(renameWhileActive.status === 409, 'offline rename while same client active should be blocked');
    assert(renameWhileActive.data.code === 'name_change_only_in_menu', 'rename blocked code while active');
  } finally {
    sse.close();
    await cleanupPlayers([join1.playerId]);
  }
}

async function testQueuedRenameBlocked() {
  const clientId = nextClientId('queue');
  const queued = (await jpost('/join', { gameType: 'gomoku', clientId, playerName: nextName('대기'), playerStreak: 0 })).data;
  try {
    const rename = await jpost('/profile', { playerId: queued.playerId, clientId, playerName: nextName('변경') }, { allowError: true });
    assert(rename.status === 409, 'queued player rename should be blocked');
    assert(rename.data.code === 'name_change_only_in_menu', 'queued rename block code');
  } finally {
    await cleanupPlayers([queued.playerId]);
  }
}


async function testFreshQueuedClientRejoinIsBlocked() {
  const clientId = nextClientId('rejoin');
  const first = await jpost('/join', { gameType: 'gomoku', clientId, playerName: nextName('Qa') });
  assert(first.data && first.data.playerId, 'first queued join should succeed');
  try {
    const second = await jpost('/join', { gameType: 'gomoku', clientId, playerName: nextName('Qb') }, { allowError: true });
    assert(second.status === 409, 'fresh queued rejoin should be blocked during SSE grace window');
    assert(second.data.code === 'client_already_online', 'fresh queued rejoin block code');
  } finally {
    await cleanupPlayers([first.data.playerId]);
  }
}

async function testQueuedClientRejoinReplacesStaleQueueEntry() {
  const clientId = nextClientId('rejoin');
  const first = await jpost('/join', { gameType: 'gomoku', clientId, playerName: nextName('Qa') });
  assert(first.data && first.data.playerId, 'first queued join should succeed');
  const oldPlayerId = first.data.playerId;

  await new Promise((resolve) => setTimeout(resolve, 3200));
  const second = await jpost('/join', { gameType: 'gomoku', clientId, playerName: nextName('Qb') });
  assert(second.data && second.data.playerId, 'second queued join should succeed after stale grace');
  assert(second.data.playerId !== oldPlayerId, 'second join should replace stale queued player');

  const queue = await jget('/queue-status?playerId=' + encodeURIComponent(second.data.playerId));
  assert(queue && queue.counts && queue.counts.gomoku === 0, 'queue should not count the caller itself after rejoin');

  await cleanupPlayers([oldPlayerId, second.data.playerId]);
}

async function testRandomStarterDistribution() {
  const seen = new Set();
  const firstJoinSeats = new Set();
  for (let i = 0; i < 10; i += 1) {
    const ctx = await createMatch('axis4', nextName('A'), nextName('B'), nextClientId('ra'), nextClientId('rb'));
    try {
      const idx = ctx.start1.snapshot.turnIndex;
      assert(idx === 0 || idx === 1, 'turnIndex should be 0 or 1');
      assert(ctx.start1.snapshot.state.axis4.turn === idx + 1, 'axis4 internal turn matches room turn');
      seen.add(idx);
      firstJoinSeats.add(ctx.start1.playerIndex);
    } finally {
      await closeMatch(ctx);
    }
  }
  assert(seen.has(0) && seen.has(1), 'starter should vary across repeated matches');
  assert(firstJoinSeats.has(0) && firstJoinSeats.has(1), 'seat assignment should vary across repeated matches');
}

async function testWinningSnapshotTurnIntegrity() {
  const gomoku = await createMatch('gomoku', nextName('G1'), nextName('G2'), nextClientId('tg1'), nextClientId('tg2'));
  try {
    const starter = gomoku.start1.snapshot.turnIndex;
    const winnerPid = gomoku.playerIdByIndex[starter];
    const loserPid = gomoku.playerIdByIndex[starter === 0 ? 1 : 0];
    const winnerMoves = starter === 0 ? [[0,0],[0,1],[0,2],[0,3],[0,4]] : [[10,10],[10,11],[10,12],[10,13],[10,14]];
    const loserMoves = [[18,18],[18,17],[18,16],[18,15]];
    for (let i = 0; i < 9; i += 1) {
      const pid = i % 2 === 0 ? winnerPid : loserPid;
      const payload = i % 2 === 0 ? winnerMoves.shift() : loserMoves.shift();
      var out = await jpost('/move', { playerId: pid, move: { kind: 'gomoku', payload } });
    }
    assert(out.data.snapshot.turnIndex === starter, 'gomoku final room turn should stay on winner seat');
    assert(out.data.snapshot.state.gomoku.turn === starter + 1, 'gomoku internal turn should stay on winner color');
  } finally {
    await closeMatch(gomoku);
  }

  const axis4 = await createMatch('axis4', nextName('X1'), nextName('X2'), nextClientId('tx1'), nextClientId('tx2'));
  try {
    const starter = axis4.start1.snapshot.turnIndex;
    const winnerPid = axis4.playerIdByIndex[starter];
    const loserPid = axis4.playerIdByIndex[starter === 0 ? 1 : 0];
    const winnerMoves = [[0,0],[1,0],[2,0],[3,0]];
    const loserMoves = [[4,0],[5,0],[6,0]];
    for (let i = 0; i < 7; i += 1) {
      const pid = i % 2 === 0 ? winnerPid : loserPid;
      const payload = i % 2 === 0 ? winnerMoves.shift() : loserMoves.shift();
      var out = await jpost('/move', { playerId: pid, move: { kind: 'axis4', payload } });
    }
    assert(out.data.snapshot.turnIndex === starter, 'axis4 final room turn should stay on winner seat');
    assert(out.data.snapshot.state.axis4.turn === starter + 1, 'axis4 internal turn should stay on winner color');
  } finally {
    await closeMatch(axis4);
  }
}


async function testSiteWideSingleBrowserLock() {
  const fingerprint = 'a'.repeat(64);
  const sessionA = 'session_alpha_12345';
  const sessionB = 'session_beta_67890';
  const claimA = await jpost('/site-lock-claim', { fingerprint, sessionId: sessionA });
  assert(claimA.data.ok === true, 'first site lock claim should succeed');

  const claimAgain = await jpost('/site-lock-claim', { fingerprint, sessionId: sessionA });
  assert(claimAgain.data.ok === true, 'same session should be able to refresh site lock');

  const blocked = await jpost('/site-lock-claim', { fingerprint, sessionId: sessionB }, { allowError: true });
  assert(blocked.status === 409 && blocked.data.code === 'site_locked_elsewhere', 'second browser on same fingerprint should be blocked');

  const heartbeat = await jpost('/site-lock-heartbeat', { fingerprint, sessionId: sessionA });
  assert(heartbeat.data.ok === true, 'owner heartbeat should succeed');

  const release = await jpost('/site-lock-release', { fingerprint, sessionId: sessionA });
  assert(release.data.ok === true, 'owner release should succeed');

  const claimB = await jpost('/site-lock-claim', { fingerprint, sessionId: sessionB });
  assert(claimB.data.ok === true, 'new browser should enter after release');
  await jpost('/site-lock-release', { fingerprint, sessionId: sessionB });
}

async function testAllGamesSmoke() {
  const games = ['axis4', 'gomoku', 'quoridor', 'dab', 'blokus', 'orbito', 'halma'];
  for (const game of games) {
    const ctx = await createMatch(game, nextName('P'), nextName('Q'), nextClientId('ga'), nextClientId('gb'));
    try {
      const starterIdx = ctx.start1.snapshot.turnIndex;
      const starterPlayerId = ctx.playerIdByIndex[starterIdx];
      let result;
      if (game === 'axis4') {
        result = await jpost('/move', { playerId: starterPlayerId, move: { kind: 'axis4', payload: [0, 0] } });
        assert(result.data.snapshot.state.axis4.lastMove.r === 0, 'axis4 move applied');
      } else if (game === 'gomoku') {
        result = await jpost('/move', { playerId: starterPlayerId, move: { kind: 'gomoku', payload: [0, 0] } });
        assert(result.data.snapshot.state.gomoku.board[0][0] === starterIdx + 1, 'gomoku move applied');
      } else if (game === 'quoridor') {
        const pawn = ctx.start1.snapshot.state.quoridor.pawns[starterIdx];
        const nextY = pawn.goal > pawn.y ? pawn.y + 1 : pawn.y - 1;
        result = await jpost('/move', { playerId: starterPlayerId, move: { kind: 'quoridor', payload: { type: 'move', x: pawn.x, y: nextY } } });
        const movedPawn = result.data.snapshot.state.quoridor.pawns[starterIdx];
        assert(movedPawn.y === nextY, 'quoridor move applied');
      } else if (game === 'dab') {
        result = await jpost('/move', { playerId: starterPlayerId, move: { kind: 'dab', payload: { type: 'h', r: 0, c: 0 } } });
        assert(result.data.snapshot.state.dab.hLines[0][0] === starterIdx + 1, 'dab move applied');
      } else if (game === 'blokus') {
        const startCell = ctx.start1.snapshot.state.blokus.players[starterIdx].start;
        result = await jpost('/move', { playerId: starterPlayerId, move: { kind: 'blokus', payload: { pieceIndex: 0, row: startCell[0], col: startCell[1], rotation: 0, flipped: false } } });
        assert(result.data.snapshot.state.blokus.board[startCell[0]][startCell[1]] === starterIdx + 1, 'blokus move applied');
      } else if (game === 'orbito') {
        await jpost('/move', { playerId: starterPlayerId, move: { kind: 'orbito', payload: { action: 'skip_enemy' } } });
        await jpost('/move', { playerId: starterPlayerId, move: { kind: 'orbito', payload: { action: 'place', place: { x: 1, y: 1 } } } });
        result = await jpost('/move', { playerId: starterPlayerId, move: { kind: 'orbito', payload: { action: 'rotate' } } });
        assert(result.data.snapshot.state.orbito.current === (starterIdx === 0 ? 2 : 1), 'orbito turn advanced');
      } else if (game === 'halma') {
        const payload = getFirstHalmaMove(ctx.start1.snapshot, starterIdx);
        result = await jpost('/move', { playerId: starterPlayerId, move: { kind: 'halma', payload } });
        assert(result.data.snapshot.state.halma.occupancy[payload.to] === starterIdx + 1, 'halma move applied');
      }
      assert(result && result.data && result.data.ok === true, game + ' move ok');
    } finally {
      await closeMatch(ctx);
    }
  }
}

(async () => {
  try {
    await testMatchChatEnd();
    await testQueueStatusAndLeave();
    await testInvalidTurnRejected();
    await testNameValidation();
    await testDuplicateNamesAndProfileSync();
    await testSingleClientMultiTabBlocked();
    await testQueuedRenameBlocked();
    await testFreshQueuedClientRejoinIsBlocked();
    await testQueuedClientRejoinReplacesStaleQueueEntry();
    await testSiteWideSingleBrowserLock();
    await testRandomStarterDistribution();
    await testWinningSnapshotTurnIntegrity();
    await testAllGamesSmoke();
    console.log('ALL TESTS PASSED');
  } catch (err) {
    console.error('TEST FAILED');
    console.error(err);
    process.exit(1);
  }
})();
