// 온라인 플레이 기능을 제공하는 클라이언트 스크립트
// 모드 선택, 매칭 대기, SSE 이벤트 수신, 채팅, 턴 제어를 담당한다.

(function() {
  const SUPPORTED_GAMES = ['axis4', 'gomoku', 'quoridor', 'dab', 'orbito'];

  const gameConfigs = {
    axis4: { pageId: 'pageAxis4', init: 'axis4Init', apply: 'axis4ApplyMove', onMoveCallbackName: 'axis4OnMove' },
    gomoku: { pageId: 'pageGomoku', init: 'gomokuInit', apply: 'gomokuApplyMove', onMoveCallbackName: 'gomokuOnMove' },
    quoridor: { pageId: 'pageQuoridor', init: 'quoridorInit', apply: 'quoridorApplyMove', onMoveCallbackName: 'quoridorOnMove' },
    dab: { pageId: 'pageDAB', init: 'dabInit', apply: 'dabApplyMove', onMoveCallbackName: 'dabOnMove' },
    orbito: { pageId: 'pageOrbito', init: 'orbitoInit', apply: 'orbitoApplyMove', onMoveCallbackName: 'orbitoOnMove' },
    airhockey: { pageId: 'pageAirHockey', init: 'airInit' }
  };

  let currentGame = null;
  let gameMode = null;
  let playerId = null;
  let roomId = null;
  let playerIndex = null;
  let eventSource = null;
  let myTurnFlag = false;
  let onlineGameStarted = false;
  let onlineUiLocked = false;
  let moveInFlight = false;
  let lastSnapshotRevision = -1;
  let onlineSessionToken = 0;
  let connectionBroken = false;
  let reconnectNoticeShown = false;
  let pendingChatMessages = [];
  let onlineEndHandled = false;

  const appBaseUrl = (function() {
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    const lastSegment = url.pathname.split('/').pop() || '';
    if (lastSegment && lastSegment.indexOf('.') !== -1) {
      url.pathname = url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1);
    } else if (!url.pathname.endsWith('/')) {
      url.pathname += '/';
    }
    return url;
  })();

  // 현재 페이지 기준(base path)으로 API/정적 리소스 URL을 만든다.
  // 서브패스 배포(/game/, /game 등)에서도 루트(/)로 새지 않게 하기 위한 헬퍼다.
  function appUrl(path) {
    return new URL(path, appBaseUrl).toString();
  }



  function getRoleInfo(game, idx) {
    const maps = {
      axis4: ['흑', '백'],
      gomoku: ['흑', '백'],
      dab: ['빨강', '파랑'],
      quoridor: ['빨강', '파랑'],
      orbito: ['빨강', '파랑']
    };
    const colors = {
      '흑': '#111827',
      '백': '#f8fafc',
      '빨강': '#f87171',
      '파랑': '#60a5fa'
    };
    const roles = maps[game] || ['1P', '2P'];
    const name = roles[idx === 1 ? 1 : 0];
    return { name, color: colors[name] || '#fbbf24' };
  }

  function removeRoleBadge() {
    const badge = document.getElementById('onlineRoleBadge');
    if (badge) badge.remove();
  }

  function setupRoleBadge() {
    removeRoleBadge();
    const cfg = gameConfigs[currentGame];
    if (!cfg) return;
    const pageEl = document.getElementById(cfg.pageId);
    if (!pageEl) return;
    const role = getRoleInfo(currentGame, playerIndex);
    const badge = document.createElement('div');
    badge.id = 'onlineRoleBadge';
    badge.style.cssText = 'display:inline-flex;align-items:center;gap:8px;margin:12px auto 8px;padding:8px 12px;border-radius:999px;background:#111827;border:1px solid #374151;color:#f8fafc;font-weight:700;position:relative;left:50%;transform:translateX(-50%);';
    const swatch = document.createElement('span');
    swatch.style.cssText = 'display:inline-block;width:12px;height:12px;border-radius:999px;border:1px solid rgba(255,255,255,.45);';
    swatch.style.background = role.color;
    const label = document.createElement('span');
    label.textContent = '온라인 · 내 색: ' + role.name;
    badge.appendChild(swatch);
    badge.appendChild(label);
    pageEl.insertBefore(badge, pageEl.firstChild);
  }

  function openModeSelect(game) {
    currentGame = game;
    const overlay = document.getElementById('modeSelect');
    overlay.classList.add('show');
    const onlineBtn = document.getElementById('onlinePlayButton');
    if (SUPPORTED_GAMES.includes(game)) {
      onlineBtn.disabled = false;
      onlineBtn.textContent = '온라인 플레이';
    } else {
      onlineBtn.disabled = true;
      onlineBtn.textContent = '온라인 미지원';
    }
  }
  window.openModeSelect = openModeSelect;

  function closeModeSelect() {
    const overlay = document.getElementById('modeSelect');
    if (overlay) overlay.classList.remove('show');
  }

  const originalShowPage = window.showPage;
  if (typeof originalShowPage === 'function') {
    window.showPage = function(id) {
      if (id === 'pageMenu' && gameMode === 'online') {
        teardownOnlineSession(true);
      }
      return originalShowPage(id);
    };
  }

  function setButtonsDisabled(selectorList, disabled) {
    selectorList.forEach((selector) => {
      document.querySelectorAll(selector).forEach((el) => {
        el.disabled = !!disabled;
      });
    });
  }

  function getOnlineUnsafeSelectors() {
    const map = {
      axis4: ['#pageAxis4 .restart-btn', '#pageAxis4 button[onclick="axis4Undo()"]', '#pageAxis4 button[onclick="axis4Restart()"]'],
      gomoku: ['#pageGomoku .restart-btn', '#pageGomoku button[onclick="gomokuUndo()"]', '#pageGomoku button[onclick="gomokuRestart()"]'],
      quoridor: ['#pageQuoridor .restart-btn', '#pageQuoridor button[onclick="quoridorInit()"]'],
      dab: ['#pageDAB .restart-btn', '#pageDAB button[onclick="dabInit()"]'],
      orbito: ['#pageOrbito .restart-btn', '#pageOrbito button[onclick="orbitoRestart()"]']
    };
    return map[currentGame] || [];
  }

  function lockOnlineUnsafeButtons() {
    onlineUiLocked = true;
    setButtonsDisabled(getOnlineUnsafeSelectors(), true);
  }

  function unlockOnlineUnsafeButtons() {
    onlineUiLocked = false;
    setButtonsDisabled(getOnlineUnsafeSelectors(), false);
  }

  function bestEffortLeave() {
    if (!playerId) return;
    const body = JSON.stringify({ playerId });
    try {
      if (navigator.sendBeacon) {
        const blob = new Blob([body], { type: 'application/json' });
        navigator.sendBeacon(appUrl('leave'), blob);
      } else {
        fetch(appUrl('leave'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: true
        }).catch(() => {});
      }
    } catch (_) {}
  }

  function teardownOnlineSession(notifyServer) {
    onlineSessionToken += 1;
    connectionBroken = false;
    reconnectNoticeShown = false;
    if (notifyServer === true) bestEffortLeave();
    onlineGameStarted = false;
    myTurnFlag = false;
    moveInFlight = false;
    gameMode = null;
    roomId = null;
    playerIndex = null;
    playerId = null;
    lastSnapshotRevision = -1;
    if (eventSource) {
      try { eventSource.close(); } catch (_) {}
      eventSource = null;
    }
    if (currentGame && gameConfigs[currentGame] && gameConfigs[currentGame].onMoveCallbackName) {
      window[gameConfigs[currentGame].onMoveCallbackName] = null;
    }
    unlockOnlineUnsafeButtons();
    hideWaiting();
    removeChatUI();
    pendingChatMessages = [];
    onlineEndHandled = false;
    removeRoleBadge();
  }

  function startOffline() {
    const wasOnline = gameMode === 'online';
    gameMode = 'offline';
    closeModeSelect();
    teardownOnlineSession(wasOnline);
    const cfg = gameConfigs[currentGame];
    if (!cfg) return;
    showPage(cfg.pageId);
    if (typeof window[cfg.init] === 'function') window[cfg.init]();
    hideWaiting();
    removeChatUI();
    removeRoleBadge();
  }
  window.startOffline = startOffline;

  function startOnline() {
    gameMode = 'online';
    closeModeSelect();
    joinOnlineGame(currentGame);
  }
  window.startOnline = startOnline;

  function joinOnlineGame(gameType) {
    teardownOnlineSession(true);
    gameMode = 'online';
    showWaiting();
    removeChatUI();

    connectionBroken = false;
    const sessionToken = onlineSessionToken;
    fetch(appUrl('join'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameType })
    })
      .then(res => res.json())
      .then(data => {
        if (!isCurrentOnlineSession(sessionToken)) return;
        if (!data || !data.playerId) throw new Error(data && data.error ? data.error : 'join failed');
        currentGame = gameType;
        playerId = data.playerId;
        roomId = data.roomId || null;
        playerIndex = data.playerIndex == null ? null : data.playerIndex;
        setupEventSource();
      })
      .catch(err => {
        if (!isCurrentOnlineSession(sessionToken)) return;
        console.error(err);
        hideWaiting();
        teardownOnlineSession(false);
        gameMode = null;
        alert('매칭 중 오류가 발생했습니다.');
      });
  }

  function isCurrentOnlineSession(sessionToken) {
    return sessionToken === onlineSessionToken && gameMode === 'online';
  }

  function isExpectedPlayerEvent(data) {
    if (!data || !data.playerId || !playerId) return true;
    return data.playerId === playerId;
  }

  function isMatchingRoomEvent(data, allowUnsetCurrentRoom) {
    if (!data) return false;
    const incomingRoomId = data.roomId || (data.snapshot && data.snapshot.roomId) || null;
    if (!incomingRoomId) return false;
    if (!roomId) return !!allowUnsetCurrentRoom;
    return incomingRoomId === roomId;
  }

  function isMatchingEndEvent(data) {
    if (!data) return false;
    if ((data.reason === 'queue_timeout' || data.reason === 'match_cancelled') && !roomId) return true;
    return isMatchingRoomEvent(data, false);
  }

  function getSnapshotEndMessage(snapshot) {
    const state = snapshot && snapshot.state ? snapshot.state : null;
    if (!state) return '게임이 종료되었어. 결과를 확인해줘.';
    const gameState = currentGame && state[currentGame] ? state[currentGame] : null;
    if (!gameState) return '게임이 종료되었어. 결과를 확인해줘.';
    if (gameState.draw) return '게임이 무승부로 종료되었어.';
    if (currentGame === 'quoridor' && typeof gameState.winner === 'number') {
      return gameState.winner === 0 ? '빨강 승리로 게임이 종료되었어.' : '파랑 승리로 게임이 종료되었어.';
    }
    if ((currentGame === 'axis4' || currentGame === 'gomoku' || currentGame === 'dab' || currentGame === 'orbito') && typeof gameState.winner === 'number') {
      if (gameState.winner === 0) return '게임이 종료되었어. 결과를 확인해줘.';
      return '게임이 종료되었어. 결과를 확인해줘.';
    }
    return '게임이 종료되었어. 결과를 확인해줘.';
  }

  function finalizeOnlineGame(payload) {
    if (onlineEndHandled) return;
    onlineEndHandled = true;
    const finalPayload = payload || { message: '게임이 종료되었어.' };
    if (finalPayload && finalPayload.snapshot) applySnapshot(finalPayload.snapshot, { force: true, suppressEndHandling: true });
    const endMessage = finalPayload.message || '게임이 종료되었어.';
    onlineSessionToken += 1;
    connectionBroken = false;
    reconnectNoticeShown = false;
    myTurnFlag = false;
    moveInFlight = false;
    updateTurnControl();
    onlineGameStarted = false;
    unlockOnlineUnsafeButtons();
    roomId = null;
    playerIndex = null;
    playerId = null;
    gameMode = null;
    lastSnapshotRevision = -1;
    if (eventSource) {
      try { eventSource.close(); } catch (_) {}
      eventSource = null;
    }
    removeChatUI();
    pendingChatMessages = [];
    removeRoleBadge();
    hideWaiting();
    currentGame = null;
    alert(endMessage);
    if (typeof showPage === 'function') showPage('pageMenu');
  }

  function setupEventSource() {
    if (eventSource) eventSource.close();
    const sessionToken = onlineSessionToken;
    eventSource = new EventSource(appUrl('events') + '?playerId=' + encodeURIComponent(playerId));

    eventSource.addEventListener('hello', function(event) {
      try {
        const data = event && event.data ? JSON.parse(event.data) : null;
        if (!isCurrentOnlineSession(sessionToken) || !isExpectedPlayerEvent(data)) return;
        if (data && roomId && data.roomId && data.roomId !== roomId) return;
        markConnectionRestored();
      } catch (e) {
        console.error(e);
      }
    });

    eventSource.addEventListener('start', function(event) {
      try {
        const data = JSON.parse(event.data);
        if (!isCurrentOnlineSession(sessionToken) || !isExpectedPlayerEvent(data)) return;
        if (!isMatchingRoomEvent(data, true)) return;
        markConnectionRestored();
        if (roomId !== data.roomId) lastSnapshotRevision = -1;
        roomId = data.roomId;
        playerIndex = data.playerIndex;
        currentGame = data.gameType || currentGame;
        beginGame(data);
      } catch (e) {
        console.error(e);
      }
    });

    eventSource.addEventListener('move', function(event) {
      try {
        const data = JSON.parse(event.data);
        if (!isCurrentOnlineSession(sessionToken) || !isMatchingRoomEvent(data, false)) return;
        handleRemoteMove(data);
      } catch (e) {
        console.error(e);
      }
    });

    eventSource.addEventListener('state_sync', function(event) {
      try {
        const data = JSON.parse(event.data);
        if (!isCurrentOnlineSession(sessionToken) || !isMatchingRoomEvent(data, false)) return;
        if (data && data.snapshot) {
          markConnectionRestored();
          applySnapshot(data.snapshot);
        }
      } catch (e) {
        console.error(e);
      }
    });

    eventSource.addEventListener('chat', function(event) {
      try {
        const data = JSON.parse(event.data);
        if (!isCurrentOnlineSession(sessionToken) || !isMatchingRoomEvent(data, false)) return;
        appendChatMessage(data);
      } catch (e) {
        console.error(e);
      }
    });

    eventSource.addEventListener('end', function(event) {
      let payload = { message: '상대가 연결을 종료했어.' };
      try { payload = JSON.parse(event.data); } catch (_) {}
      if (!isCurrentOnlineSession(sessionToken) || !isMatchingEndEvent(payload)) return;
      finalizeOnlineGame(payload);
    });

    eventSource.onerror = function(err) {
      if (!isCurrentOnlineSession(sessionToken)) return;
      console.error('SSE error', err);
      const waitingOverlay = document.getElementById('waitingOverlay');
      const waitingVisible = !!(waitingOverlay && waitingOverlay.classList.contains('show'));
      if (gameMode === 'online' && onlineGameStarted && !waitingVisible) {
        connectionBroken = true;
        moveInFlight = false;
        if (!reconnectNoticeShown) {
          reconnectNoticeShown = true;
          lockDisconnectedMatch('온라인 연결이 잠깐 끊겨서 재연결을 시도 중이야.');
        } else {
          myTurnFlag = false;
          updateTurnControl();
        }
        return;
      }
      const shouldResetUi = gameMode === 'online' && (!onlineGameStarted || waitingVisible);
      if (!shouldResetUi) return;
      hideWaiting();
      teardownOnlineSession(false);
      gameMode = null;
      alert('온라인 연결이 끊어졌거나 매칭 대기가 만료되었어. 다시 온라인 플레이를 눌러줘.');
    };
  }

  function normalizeOutgoingMove(args) {
    if (args.length === 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])) {
      return args[0];
    }
    return args;
  }


  function fetchStateSync() {
    if (!playerId) return Promise.reject(new Error('missing playerId'));
    return fetch(appUrl('state') + '?playerId=' + encodeURIComponent(playerId))
      .then(async (res) => {
        let data = null;
        try { data = await res.json(); } catch (_) {}
        if (!res.ok || !data || data.ok === false) throw new Error((data && data.error) || 'state sync failed');
        return data;
      });
  }

  function applySnapshot(snapshot, options) {
    if (!snapshot || !snapshot.state) return false;
    const opts = options || {};
    if (snapshot.roomId && roomId && snapshot.roomId !== roomId) return false;
    const revision = typeof snapshot.revision === 'number' ? snapshot.revision : null;
    if (!opts.force && revision !== null && revision <= lastSnapshotRevision) return false;
    if (revision !== null && revision > lastSnapshotRevision) lastSnapshotRevision = revision;
    if (snapshot.roomId && !roomId) roomId = snapshot.roomId;
    if (snapshot.gameType && !currentGame) currentGame = snapshot.gameType;
    if (snapshot.gameOver === true) myTurnFlag = false;
    else if (typeof snapshot.turnIndex === 'number') myTurnFlag = snapshot.turnIndex === playerIndex;
    if (currentGame === 'axis4' && typeof window.axis4SetState === 'function' && snapshot.state.axis4) window.axis4SetState(snapshot.state.axis4);
    if (currentGame === 'gomoku' && typeof window.gomokuSetState === 'function' && snapshot.state.gomoku) window.gomokuSetState(snapshot.state.gomoku);
    if (currentGame === 'dab' && typeof window.dabSetState === 'function' && snapshot.state.dab) window.dabSetState(snapshot.state.dab);
    if (currentGame === 'quoridor' && typeof window.quoridorSetState === 'function' && snapshot.state.quoridor) window.quoridorSetState(snapshot.state.quoridor);
    if (currentGame === 'orbito' && typeof window.orbitoSetState === 'function' && snapshot.state.orbito) window.orbitoSetState(snapshot.state.orbito);
    updateTurnControl();
    if (!opts.suppressEndHandling && snapshot.gameOver === true && gameMode === 'online' && onlineGameStarted && !onlineEndHandled) {
      finalizeOnlineGame({ message: getSnapshotEndMessage(snapshot), snapshot });
    }
    return true;
  }

  function lockDisconnectedMatch(reasonText) {
    myTurnFlag = false;
    updateTurnControl();
    if (gameMode === 'online' && onlineGameStarted) {
      appendSystemMessage(reasonText || '온라인 연결이 끊겨서 입력을 잠깐 잠글게.');
    }
  }

  function markConnectionRestored() {
    if (!connectionBroken) return;
    connectionBroken = false;
    reconnectNoticeShown = false;
    appendSystemMessage('온라인 연결이 복구됐어.');
    updateTurnControl();
    const sessionToken = onlineSessionToken;
    const trySync = function(retryCount) {
      fetchStateSync()
        .then((data) => {
          if (!isCurrentOnlineSession(sessionToken) || gameMode !== 'online') return;
          if (data && data.snapshot) applySnapshot(data.snapshot);
        })
        .catch(() => {
          if (!isCurrentOnlineSession(sessionToken) || gameMode !== 'online') return;
          if (retryCount > 0) {
            setTimeout(function() {
              if (!isCurrentOnlineSession(sessionToken) || gameMode !== 'online') return;
              trySync(retryCount - 1);
            }, 800);
            return;
          }
          appendSystemMessage('온라인 상태 동기화에 실패해서 입력을 잠깐 잠글게.');
          connectionBroken = true;
          lockDisconnectedMatch('온라인 상태 동기화에 실패해서 입력을 잠깐 잠글게.');
        });
    };
    trySync(1);
  }

  function beginGame(startPayload) {
    onlineGameStarted = true;
    onlineEndHandled = false;
    connectionBroken = false;
    hideWaiting();

    const cfg = gameConfigs[currentGame];
    if (!cfg) return;
    showPage(cfg.pageId);
    if (typeof window[cfg.init] === 'function') window[cfg.init]();
    lockOnlineUnsafeButtons();

    if (cfg.onMoveCallbackName) {
      window[cfg.onMoveCallbackName] = function() {
        if (!myTurnFlag || moveInFlight) return false;
        const sessionToken = onlineSessionToken;
        const previousMyTurn = myTurnFlag;
        moveInFlight = true;
        updateTurnControl();
        const payload = normalizeOutgoingMove(Array.from(arguments));

        sendMove(currentGame, payload)
          .then((data) => {
            if (sessionToken !== onlineSessionToken || gameMode !== 'online' || connectionBroken) return;
            moveInFlight = false;
            if (data && data.snapshot) {
              applySnapshot(data.snapshot);
            } else if (data && data.gameOver === true) {
              myTurnFlag = false;
            } else if (currentGame === 'dab' && data && data.keepTurn === true) {
              myTurnFlag = true;
            } else {
              myTurnFlag = false;
            }
            updateTurnControl();
          })
          .catch(() => {
            if (sessionToken !== onlineSessionToken) return;
            moveInFlight = false;
            fetchStateSync()
              .then((data) => {
                if (sessionToken !== onlineSessionToken || gameMode !== 'online' || connectionBroken) return;
                if (data && data.snapshot) applySnapshot(data.snapshot);
                else {
                  myTurnFlag = previousMyTurn;
                  updateTurnControl();
                }
              })
              .catch(() => {
                if (sessionToken !== onlineSessionToken || gameMode !== 'online' || connectionBroken) return;
                myTurnFlag = previousMyTurn;
                updateTurnControl();
                appendSystemMessage('이동 전송이 실패해서 입력 상태를 원래대로 되돌렸어. 다시 시도해줘.');
              });
          });
        return true;
      };
    }

    myTurnFlag = playerIndex === 0;
    if (startPayload && startPayload.snapshot) applySnapshot(startPayload.snapshot);
    else updateTurnControl();
    setupRoleBadge();
    setupChatUI();
    appendSystemMessage(playerIndex === 0 ? '매칭 완료! 네가 선공이야.' : '매칭 완료! 상대가 먼저 둬.');
  }

  function sendMove(kind, movePayload) {
    return fetch(appUrl('move'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId, move: { kind, payload: movePayload } })
    })
      .then(async (res) => {
        let data = null;
        try { data = await res.json(); } catch (_) {}
        if (!res.ok || (data && data.ok === false)) {
          const error = new Error(data && data.error ? data.error : 'move failed');
          error.payload = data;
          throw error;
        }
        return data || { ok: true };
      })
      .catch(err => {
        console.error(err);
        if (err && err.payload && err.payload.error === 'not your turn') {
          myTurnFlag = false;
          updateTurnControl();
          alert('아직 네 턴이 아니야. 보드 상태를 다시 확인해줘.');
        }
        throw err;
      });
  }

  function detectGameOverUi() {
    const overlayMap = {
      axis4: 'axis4Overlay',
      gomoku: 'gOverlay',
      quoridor: 'quorOverlay',
      dab: 'dabOverlay',
      orbito: 'orbitoOverlay'
    };
    const id = overlayMap[currentGame];
    if (!id) return false;
    const el = document.getElementById(id);
    return !!(el && el.classList.contains('show'));
  }

  function handleRemoteMove(eventData) {
    if (!eventData || !eventData.move) return;

    const cfg = gameConfigs[currentGame];
    if (!cfg) return;

    if (eventData.playerIndex === playerIndex) {
      if (eventData.snapshot) applySnapshot(eventData.snapshot);
      return;
    }

    const move = eventData.move;
    const kind = move.kind || currentGame;
    const payload = Object.prototype.hasOwnProperty.call(move, 'payload') ? move.payload : move.data;
    const hasSnapshot = !!eventData.snapshot;
    let appliedMeta = { applied: false, gameOver: false, keepTurn: false };

    try {
      if ((kind === 'axis4' || currentGame === 'axis4') && Array.isArray(payload)) {
        const [r, c, player] = payload;
        if (typeof window[cfg.apply] === 'function') appliedMeta = window[cfg.apply](r, c, player) || appliedMeta;
      } else if ((kind === 'gomoku' || currentGame === 'gomoku') && Array.isArray(payload)) {
        const [r, c, player] = payload;
        if (typeof window[cfg.apply] === 'function') appliedMeta = window[cfg.apply](r, c, player) || appliedMeta;
      } else if ((kind === 'dab' || currentGame === 'dab')) {
        if (Array.isArray(payload)) {
          const [type, r, c, player] = payload;
          if (typeof window[cfg.apply] === 'function') appliedMeta = window[cfg.apply](type, r, c, player) || appliedMeta;
        } else if (payload && typeof payload === 'object') {
          if (typeof window[cfg.apply] === 'function') appliedMeta = window[cfg.apply](payload.type, payload.r, payload.c, payload.player) || appliedMeta;
        }
      } else if ((kind === 'quoridor' || currentGame === 'quoridor') && payload && typeof payload === 'object') {
        if (typeof window[cfg.apply] === 'function') appliedMeta = window[cfg.apply](payload) || { applied: true, gameOver: false, keepTurn: false };
      } else if ((kind === 'orbito' || currentGame === 'orbito') && payload && typeof payload === 'object') {
        if (typeof window[cfg.apply] === 'function') appliedMeta = window[cfg.apply](payload) || { applied: true, gameOver: false, keepTurn: false };
      }
    } catch (e) {
      console.error(e);
      appliedMeta = { applied: false, gameOver: false, keepTurn: false };
    }

    if (!appliedMeta || appliedMeta.applied === false) {
      if (hasSnapshot) {
        applySnapshot(eventData.snapshot);
      } else {
        const sessionToken = onlineSessionToken;
        fetchStateSync()
          .then((data) => {
            if (!isCurrentOnlineSession(sessionToken) || connectionBroken) return;
            if (data && data.snapshot) applySnapshot(data.snapshot);
          })
          .catch(() => {});
      }
      return;
    }

    if (hasSnapshot) {
      applySnapshot(eventData.snapshot);
      return;
    }

    if (eventData.gameOver === true || appliedMeta.gameOver === true) {
      myTurnFlag = false;
    } else if (currentGame === 'dab') {
      myTurnFlag = !appliedMeta.keepTurn;
    } else if (typeof eventData.turnIndex === 'number' && typeof playerIndex === 'number') {
      myTurnFlag = eventData.turnIndex === playerIndex;
    } else {
      myTurnFlag = false;
      const sessionToken = onlineSessionToken;
      fetchStateSync()
        .then((data) => {
          if (!isCurrentOnlineSession(sessionToken) || connectionBroken) return;
          if (data && data.snapshot) applySnapshot(data.snapshot);
        })
        .catch(() => {});
    }
    updateTurnControl();
  }

  function setCanvasInteractivity(canvasId, enabled) {
    const canvas = document.getElementById(canvasId);
    if (canvas) canvas.style.pointerEvents = enabled ? 'auto' : 'none';
  }

  function updateTurnControl() {
    if (gameMode !== 'online') return;
    if (currentGame === 'axis4') {
      const btn = document.getElementById('axis4CommitBtn');
      if (btn) btn.disabled = !myTurnFlag || moveInFlight;
      setCanvasInteractivity('axis4Canvas', myTurnFlag && !moveInFlight);
    }
    if (currentGame === 'gomoku') {
      const btn = document.getElementById('gomokuCommitBtn');
      if (btn) btn.disabled = !myTurnFlag || moveInFlight;
      setCanvasInteractivity('gomokuCanvas', myTurnFlag && !moveInFlight);
    }
    if (currentGame === 'quoridor') {
      ['quorMoveBtn', 'quorWallBtn', 'quorInstallBtn', 'quorClearBtn'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.disabled = !myTurnFlag || moveInFlight;
      });
      setCanvasInteractivity('quoridorCanvas', myTurnFlag && !moveInFlight);
      if (myTurnFlag && !moveInFlight && typeof window.quoridorSetMode === 'function') {
        try {
          // let in-page logic recompute button states
          window.quoridorSetMode(document.getElementById('quorWallBtn') && document.getElementById('quorWallBtn').classList.contains('active-mode') ? 'wall' : 'move');
        } catch (_) {}
      }
    }
    if (currentGame === 'dab') {
      setCanvasInteractivity('dabCanvas', myTurnFlag && !moveInFlight);
    }
    if (currentGame === 'orbito') {
      setCanvasInteractivity('orbitoCanvas', myTurnFlag && !moveInFlight);
      ['orbitoSkipBtn', 'orbitoRotateBtn'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.disabled = !myTurnFlag || moveInFlight;
      });
      if (typeof window.orbitoSetOnlineTurnState === 'function') {
        window.orbitoSetOnlineTurnState(myTurnFlag && !moveInFlight, moveInFlight, gameMode === 'online');
      }
    }
  }

  function showWaiting() {
    let overlay = document.getElementById('waitingOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'waitingOverlay';
      overlay.className = 'overlay';
      overlay.innerHTML = '<div class="overlay-box"><h2>매칭 대기 중...</h2><p>다른 플레이어를 기다리는 중입니다.</p></div>';
      document.body.appendChild(overlay);
    }
    overlay.classList.add('show');
  }

  function hideWaiting() {
    const overlay = document.getElementById('waitingOverlay');
    if (overlay) overlay.classList.remove('show');
  }

  function setupChatUI() {
    const cfg = gameConfigs[currentGame];
    if (!cfg) return;
    const pageEl = document.getElementById(cfg.pageId);
    if (!pageEl) return;

    removeChatUI();

    const chat = document.createElement('div');
    chat.id = 'chatContainer';
    chat.className = 'chat-container';
    chat.innerHTML =
      '<div class="chat-title">온라인 채팅</div>' +
      '<div id="chatMessages" class="chat-messages"></div>' +
      '<div class="chat-input">' +
      '<input id="chatInput" type="text" placeholder="메시지 입력..." />' +
      '<button id="chatSendBtn">보내기</button>' +
      '</div>';
    var anchorMap = {
      axis4: '#pageAxis4 .status-bar',
      gomoku: '#pageGomoku .status-bar',
      quoridor: '#pageQuoridor .status-bar',
      dab: '#pageDAB .dab-score-bar',
      orbito: '#pageOrbito .status-bar'
    };
    var anchor = pageEl.querySelector(anchorMap[currentGame] || '');
    if (anchor && anchor.parentNode === pageEl) {
      if (anchor.nextSibling) pageEl.insertBefore(chat, anchor.nextSibling);
      else pageEl.appendChild(chat);
    } else {
      pageEl.appendChild(chat);
    }

    const sendBtn = chat.querySelector('#chatSendBtn');
    const input = chat.querySelector('#chatInput');

    function sendChatMessage() {
      const text = input.value.trim();
      if (!text) return;
      if (!playerId || gameMode !== 'online') {
        alert('온라인 세션이 연결되지 않아서 채팅을 보낼 수 없어. 다시 접속해줘.');
        return;
      }
      sendBtn.disabled = true;
      fetch(appUrl('chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, message: text })
      })
        .then(async (res) => {
          let data = null;
          try { data = await res.json(); } catch (_) {}
          if (!res.ok || (data && data.ok === false)) {
            throw new Error(data && data.error ? data.error : 'chat failed');
          }
          input.value = '';
        })
        .catch((err) => {
          console.error(err);
          alert('채팅 전송에 실패했어. 네트워크 상태나 온라인 연결을 다시 확인해줘.');
        })
        .finally(() => {
          const currentBtn = document.getElementById('chatSendBtn');
          if (currentBtn) currentBtn.disabled = false;
        });
    }

    sendBtn.addEventListener('click', function() {
      sendChatMessage();
    });
    input.addEventListener('keydown', function(e) {
      if (e.isComposing) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        sendChatMessage();
      }
    });

    if (pendingChatMessages.length) {
      var queued = pendingChatMessages.slice();
      pendingChatMessages = [];
      queued.forEach(function(item) {
        if (item && item.type === 'system') appendSystemMessage(item.text);
        else if (item && item.type === 'chat') appendChatMessage(item.msg);
      });
    }
  }

  function appendChatMessage(msg) {
    const list = document.getElementById('chatMessages');
    if (!list) { pendingChatMessages.push({ type: 'chat', msg: msg }); return; }
    const p = document.createElement('p');
    const prefix = msg.playerIndex === playerIndex ? '나: ' : '상대: ';
    p.textContent = prefix + msg.message;
    list.appendChild(p);
    list.scrollTop = list.scrollHeight;
  }

  function appendSystemMessage(text) {
    const list = document.getElementById('chatMessages');
    if (!list) { pendingChatMessages.push({ type: 'system', text: text }); return; }
    const p = document.createElement('p');
    p.style.opacity = '0.7';
    p.textContent = `[시스템] ${text}`;
    list.appendChild(p);
    list.scrollTop = list.scrollHeight;
  }

  function removeChatUI() {
    const chat = document.getElementById('chatContainer');
    if (chat) chat.remove();
  }

})();
