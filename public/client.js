// 온라인 플레이 기능을 제공하는 클라이언트 스크립트
// 모드 선택, 매칭 대기, SSE 이벤트 수신, 채팅, 턴 제어를 담당한다.

(function() {
  const SUPPORTED_GAMES = ['axis4', 'gomoku', 'quoridor', 'dab'];

  const gameConfigs = {
    axis4: { pageId: 'pageAxis4', init: 'axis4Init', apply: 'axis4ApplyMove', onMoveCallbackName: 'axis4OnMove' },
    gomoku: { pageId: 'pageGomoku', init: 'gomokuInit', apply: 'gomokuApplyMove', onMoveCallbackName: 'gomokuOnMove' },
    quoridor: { pageId: 'pageQuoridor', init: 'quoridorInit', apply: 'quoridorApplyMove', onMoveCallbackName: 'quoridorOnMove' },
    dab: { pageId: 'pageDAB', init: 'dabInit', apply: 'dabApplyMove', onMoveCallbackName: 'dabOnMove' },
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
      dab: ['#pageDAB .restart-btn', '#pageDAB button[onclick="dabInit()"]']
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
    if (notifyServer === true) bestEffortLeave();
    onlineGameStarted = false;
    myTurnFlag = false;
    moveInFlight = false;
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
    showWaiting();
    removeChatUI();

    connectionBroken = false;
    fetch(appUrl('join'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameType })
    })
      .then(res => res.json())
      .then(data => {
        if (!data || !data.playerId) throw new Error(data && data.error ? data.error : 'join failed');
        currentGame = gameType;
        playerId = data.playerId;
        roomId = data.roomId || null;
        playerIndex = data.playerIndex == null ? null : data.playerIndex;
        setupEventSource();
      })
      .catch(err => {
        console.error(err);
        hideWaiting();
        alert('매칭 중 오류가 발생했습니다.');
      });
  }

  function setupEventSource() {
    if (eventSource) eventSource.close();
    eventSource = new EventSource(appUrl('events') + '?playerId=' + encodeURIComponent(playerId));

    eventSource.addEventListener('start', function(event) {
      try {
        const data = JSON.parse(event.data);
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
        handleRemoteMove(data);
      } catch (e) {
        console.error(e);
      }
    });

    eventSource.addEventListener('state_sync', function(event) {
      try {
        const data = JSON.parse(event.data);
        if (data && data.snapshot) applySnapshot(data.snapshot);
      } catch (e) {
        console.error(e);
      }
    });

    eventSource.addEventListener('chat', function(event) {
      try {
        const data = JSON.parse(event.data);
        appendChatMessage(data);
      } catch (e) {
        console.error(e);
      }
    });

    eventSource.addEventListener('end', function(event) {
      let payload = { message: '상대가 연결을 종료했어.' };
      try { payload = JSON.parse(event.data); } catch (_) {}
      const endMessage = payload.message || '게임이 종료되었어.';
      onlineSessionToken += 1;
      connectionBroken = false;
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
      alert(endMessage);
    });

    eventSource.onerror = function(err) {
      console.error('SSE error', err);
      const waitingOverlay = document.getElementById('waitingOverlay');
      const waitingVisible = !!(waitingOverlay && waitingOverlay.classList.contains('show'));
      if (gameMode === 'online' && onlineGameStarted && !waitingVisible) {
        if (eventSource) {
          try { eventSource.close(); } catch (_) {}
          eventSource = null;
        }
        connectionBroken = true;
        moveInFlight = false;
        lockDisconnectedMatch('온라인 연결이 끊겼어. 다시 온라인 플레이를 눌러 재시작해줘.');
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
    const revision = typeof snapshot.revision === 'number' ? snapshot.revision : null;
    if (!opts.force && revision !== null && revision <= lastSnapshotRevision) return false;
    if (revision !== null && revision > lastSnapshotRevision) lastSnapshotRevision = revision;
    if (snapshot.gameOver === true) myTurnFlag = false;
    else if (typeof snapshot.turnIndex === 'number') myTurnFlag = snapshot.turnIndex === playerIndex;
    if (currentGame === 'axis4' && typeof window.axis4SetState === 'function' && snapshot.state.axis4) window.axis4SetState(snapshot.state.axis4);
    if (currentGame === 'gomoku' && typeof window.gomokuSetState === 'function' && snapshot.state.gomoku) window.gomokuSetState(snapshot.state.gomoku);
    if (currentGame === 'dab' && typeof window.dabSetState === 'function' && snapshot.state.dab) window.dabSetState(snapshot.state.dab);
    if (currentGame === 'quoridor' && typeof window.quoridorSetState === 'function' && snapshot.state.quoridor) window.quoridorSetState(snapshot.state.quoridor);
    updateTurnControl();
    return true;
  }

  function lockDisconnectedMatch(reasonText) {
    myTurnFlag = false;
    updateTurnControl();
    if (gameMode === 'online' && onlineGameStarted) {
      appendSystemMessage(reasonText || '온라인 연결이 끊겨서 입력을 잠깐 잠글게.');
    }
  }

  function beginGame(startPayload) {
    onlineGameStarted = true;
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
                if (data && data.snapshot) applySnapshot(data.snapshot, { force: true });
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
      dab: 'dabOverlay'
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

    if (eventData.snapshot && applySnapshot(eventData.snapshot)) {
      return;
    }

    if (eventData.playerIndex === playerIndex) return;

    const move = eventData.move;
    const kind = move.kind || currentGame;
    const payload = Object.prototype.hasOwnProperty.call(move, 'payload') ? move.payload : move.data;
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
      }
    } catch (e) {
      console.error(e);
      appliedMeta = { applied: false, gameOver: false, keepTurn: false };
    }

    if (!appliedMeta || appliedMeta.applied === false) {
      return;
    }
    if (eventData.gameOver === true || appliedMeta.gameOver === true) {
      myTurnFlag = false;
    } else if (currentGame === 'dab') {
      myTurnFlag = !appliedMeta.keepTurn;
    } else {
      myTurnFlag = true;
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
      '<div id="chatMessages" class="chat-messages"></div>' +
      '<div class="chat-input">' +
      '<input id="chatInput" type="text" placeholder="메시지 입력..." />' +
      '<button id="chatSendBtn">보내기</button>' +
      '</div>';
    pageEl.appendChild(chat);

    const sendBtn = chat.querySelector('#chatSendBtn');
    const input = chat.querySelector('#chatInput');
    sendBtn.addEventListener('click', function() {
      const text = input.value.trim();
      if (!text) return;
      fetch(appUrl('chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, message: text })
      }).catch(console.error);
      input.value = '';
    });
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') sendBtn.click();
    });
  }

  function appendChatMessage(msg) {
    const list = document.getElementById('chatMessages');
    if (!list) return;
    const p = document.createElement('p');
    const prefix = msg.playerIndex === playerIndex ? '나: ' : '상대: ';
    p.textContent = prefix + msg.message;
    list.appendChild(p);
    list.scrollTop = list.scrollHeight;
  }

  function appendSystemMessage(text) {
    const list = document.getElementById('chatMessages');
    if (!list) return;
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

  window.addEventListener('beforeunload', function() {
    bestEffortLeave();
  });
})();
