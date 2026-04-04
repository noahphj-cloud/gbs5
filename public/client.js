// 온라인 플레이 기능을 제공하는 클라이언트 스크립트
// 모드 선택, 매칭 대기, SSE 이벤트 수신, 채팅, 턴 제어를 담당한다.

(function() {
  const SUPPORTED_GAMES = ['axis4', 'gomoku', 'quoridor', 'dab', 'blokus', 'orbito', 'halma'];

  const gameConfigs = {
    axis4: { pageId: 'pageAxis4', init: 'axis4Init', apply: 'axis4ApplyMove', onMoveCallbackName: 'axis4OnMove' },
    gomoku: { pageId: 'pageGomoku', init: 'gomokuInit', apply: 'gomokuApplyMove', onMoveCallbackName: 'gomokuOnMove' },
    quoridor: { pageId: 'pageQuoridor', init: 'quoridorInit', apply: 'quoridorApplyMove', onMoveCallbackName: 'quoridorOnMove' },
    dab: { pageId: 'pageDAB', init: 'dabInit', apply: 'dabApplyMove', onMoveCallbackName: 'dabOnMove' },
    blokus: { pageId: 'pageBlokus', init: 'blokusOpen', apply: 'blokusApplyMove', onMoveCallbackName: 'blokusOnMove' },
    orbito: { pageId: 'pageOrbito', init: 'orbitoInit', apply: 'orbitoApplyMove', onMoveCallbackName: 'orbitoOnMove' },
    halma: { pageId: 'pageHalma', init: 'halmaInit', apply: 'halmaApplyMove', onMoveCallbackName: 'halmaOnMove' },
    airhockey: { pageId: 'pageAirHockey', init: 'airInit' }
  };

  const queueGameNames = { axis4: '축고정 사목', gomoku: '오목', quoridor: '콰리도', dab: '점과 상자', blokus: '브로커스 스타일', orbito: '오비토', halma: '별모양 점프 게임' };
  const ruleContent = {
    gomoku: {
      kicker: '오목 · 금수 규칙 포함',
      title: '오목 하는 법',
      subtitle: '빈 칸에 돌을 놓아 같은 색 돌 5개를 가로, 세로, 대각선 중 하나로 먼저 이어 만들면 이겨. 흑은 삼삼·사사·장목 금수가 적용돼.',
      sections: [
        { title: '진행 방법', bullets: ['흑과 백이 번갈아 빈 칸에 돌을 하나씩 둬.', '이미 돌이 있는 칸에는 둘 수 없어.', '다시하기 전까지 돌은 움직이지 않아.'] },
        { title: '승리와 금수', bullets: ['정확히 5목을 먼저 만들면 승리야.', '백은 자유롭게 둘 수 있지만 흑은 삼삼, 사사, 장목 자리에 둘 수 없어.', '흑이 정확히 5목을 만드는 수는 금수가 아니야.'] }
      ],
      tip: '흑은 공격만 보지 말고 금수까지 같이 계산해야 안전해.'
    },
    dab: {
      kicker: '점과 상자 · 기본 규칙',
      title: '점과 상자 하는 법',
      subtitle: '번갈아 선을 하나씩 긋다가 네 변이 모두 닫힌 상자를 완성하면 그 상자를 가져가고 한 번 더 둘 수 있어.',
      sections: [
        { title: '진행 방법', bullets: ['차례마다 선 하나만 그을 수 있어.', '이미 그어진 선은 다시 그을 수 없어.', '상자를 완성하면 그 상자는 내 점수가 되고 연속으로 한 번 더 둘 수 있어.'] },
        { title: '종료와 승리', bullets: ['모든 선이 다 그어지면 게임이 끝나.', '더 많은 상자를 차지한 쪽이 승리야.'] }
      ],
      tip: '중반엔 세 번째 변을 남에게 넘기지 않게 조심해야 해.'
    },
    quoridor: {
      kicker: '콰리도 · 기본 규칙',
      title: '콰리도 하는 법',
      subtitle: '말을 움직이거나 벽을 세워 길을 막으면서 내 말을 반대편 끝줄까지 먼저 보내면 이겨.',
      sections: [
        { title: '차례마다 하는 일', bullets: ['말 한 칸 이동 또는 벽 하나 설치 중 하나를 선택해.', '벽은 길을 막을 수 있지만 상대의 길을 완전히 없애면 안 돼.'] },
        { title: '승리 조건', bullets: ['빨강은 아래쪽 끝줄, 파랑은 위쪽 끝줄에 먼저 도착하면 승리야.', '남은 벽 수를 잘 관리하는 게 중요해.'] }
      ],
      tip: '상대 길을 막더라도 내 말의 최단 경로가 끊기지 않는지 같이 봐야 해.'
    },
    orbito: {
      kicker: '오비토 · 기본 규칙',
      title: '오비토 하는 법',
      subtitle: '상대 돌을 움직이거나 건너뛰고, 내 돌을 하나 둔 뒤, 판의 궤도를 회전시켜 4개를 연결하면 이겨.',
      sections: [
        { title: '한 턴의 순서', bullets: ['상대 돌 하나를 인접한 빈칸으로 움직이거나, 원하면 바로 건너뛸 수 있어.', '그 다음 내 돌 하나를 빈칸에 둬.', '마지막으로 판을 회전시켜 돌 위치를 바꿔.'] },
        { title: '승리와 무승부', bullets: ['회전 후 내 돌 4개가 한 줄이면 승리야.', '둘 다 동시에 완성되면 무승부가 될 수 있어.'] }
      ],
      tip: '지금 줄뿐 아니라 회전 후 어디로 이동하는지도 같이 계산해야 강해져.'
    },
    axis4: {
      kicker: '축고정 사목 · 기본 규칙',
      title: '축고정 사목 하는 법',
      subtitle: '직전 수의 행이나 열 위에만 다음 수를 둘 수 있는 특별 규칙으로 4목을 먼저 만들면 이겨.',
      sections: [
        { title: '착수 규칙', bullets: ['첫 수 이후에는 직전 수와 같은 행 또는 같은 열에만 둘 수 있어.', '빈칸에만 착수할 수 있어.'] },
        { title: '승리 조건', bullets: ['내 돌 4개를 가로, 세로, 대각선으로 먼저 이으면 승리야.', '둘 곳이 거의 없게 만드는 압박도 중요한 전략이야.'] }
      ],
      tip: '상대가 두고 싶은 축을 일부러 열어주지 않는 식으로 운영하면 좋아.'
    },
    halma: {
      kicker: '별모양 점프 게임 · 기본 규칙',
      title: '별모양 점프 게임 하는 법',
      subtitle: '말을 한 칸 움직이거나 다른 말을 뛰어넘는 점프를 이어서 하며 내 말 10개를 반대 진영으로 먼저 보내면 이겨.',
      sections: [
        { title: '이동 방법', bullets: ['인접한 빈칸으로 한 칸 이동할 수 있어.', '바로 옆 말 하나를 넘어서 그 뒤 빈칸으로 점프할 수 있어.', '점프에 성공하면 이어서 연속 점프도 가능해.'] },
        { title: '승리 조건', bullets: ['내 말 10개를 모두 반대편 삼각 진영에 넣으면 승리야.', '연속 점프 중에는 같은 말로만 이어서 움직여야 해.'] }
      ],
      tip: '초반에는 한 말만 깊게 보내기보다 여러 말을 다리처럼 배치하면 점프 길이 잘 열려.'
    },
    blokus: {
      kicker: '브로커스 스타일 · 기본 규칙', title: '브로커스 스타일 하는 법', subtitle: '내 조각끼리는 꼭짓점으로만 이어 놓고, 시작점을 먼저 덮어야 해. 온라인은 2인전으로 진행돼.',
      sections: [{ title: '핵심 규칙', bullets: ['내 조각끼리는 변으로 닿으면 안 되고 꼭짓점으로만 닿아야 해.', '첫 조각은 내 시작점을 반드시 덮어야 해.', '더 둘 수 없는 플레이어는 자동으로 탈락하고 마지막까지 남은 사람이 이겨.'] }],
      tip: '큰 조각은 초반에, 좁은 틈을 메우는 작은 조각은 후반에 남기는 편이 좋아.'
    },
    airhockey: {
      kicker: '에어하키 · 기본 규칙', title: '에어하키 하는 법', subtitle: '패들로 퍽을 쳐서 상대 골대에 넣으면 점수를 얻고, 먼저 5점을 만들면 이겨.',
      sections: [{ title: '기본 흐름', bullets: ['패들은 내 진영 안에서 움직여 퍽을 쳐.', '퍽이 상대 골문에 들어가면 득점이야.', '지정 점수에 먼저 도달하면 승리해.'] }],
      tip: '정면 슛만 노리지 말고 벽 반사를 이용하면 더 날카롭게 들어가.'
    },
    game2048: {
      kicker: '2048 · 기본 규칙', title: '2048 하는 법', subtitle: '같은 숫자 타일을 합치며 2048을 만드는 1인용 퍼즐이야.',
      sections: [{ title: '핵심 규칙', bullets: ['상하좌우로 밀면 모든 타일이 그 방향으로 움직여.', '같은 숫자가 부딪히면 합쳐져 두 배가 돼.', '더 이상 움직일 수 없으면 게임 오버야.'] }],
      tip: '가장 큰 수를 한 모서리에 고정하는 운영이 안정적이야.'
    }
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
  let disconnectRecoveryTimer = null;
  let waitingRecoveryTimer = null;
  let queueStatusTimer = null;
  let lastQueueStatusFetchAt = 0;
  const cancelledJoinSessions = Object.create(null);
  let globalNoticeTimer = null;

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

  function isInteractiveElement(el) {
    return !!(el && (el.closest('button') || el.closest('a') || el.closest('input') || el.closest('textarea')));
  }

  function bindTapFriendlyAction(element, handler) {
    if (!element || typeof handler !== 'function' || element.__tapFriendlyBound) return;
    element.__tapFriendlyBound = true;
    let touchHandledAt = 0;
    element.style.touchAction = 'manipulation';
    element.addEventListener('touchend', function(ev) {
      touchHandledAt = Date.now();
      ev.preventDefault();
      handler(ev);
    }, { passive: false });
    element.addEventListener('click', function(ev) {
      if (Date.now() - touchHandledAt < 700) {
        ev.preventDefault();
        return;
      }
      handler(ev);
    });
  }

  function getRoleInfo(game, idx) {
    const maps = {
      axis4: ['흑', '백'],
      gomoku: ['흑', '백'],
      dab: ['빨강', '파랑'],
      quoridor: ['빨강', '파랑'],
      orbito: ['빨강', '파랑'],
      halma: ['빨강', '파랑'],
      blokus: ['빨강', '파랑']
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

  function showGlobalNotice(text, tone, durationMs) {
    const el = document.getElementById('globalNotice');
    if (!el) return;
    if (globalNoticeTimer) {
      clearTimeout(globalNoticeTimer);
      globalNoticeTimer = null;
    }
    el.textContent = text || '';
    el.classList.remove('warning', 'success', 'error', 'info', 'show');
    if (tone) el.classList.add(tone);
    if (text) el.classList.add('show');
    globalNoticeTimer = setTimeout(function() {
      el.classList.remove('show', 'warning', 'success', 'error', 'info');
      globalNoticeTimer = null;
    }, Math.max(1600, Number(durationMs) || 3200));
  }
  window.showGlobalNotice = showGlobalNotice;

  function openModeSelect(game) {
    currentGame = game;
    const overlay = document.getElementById('modeSelect');
    if (overlay) overlay.classList.add('show');
    const onlineBtn = document.getElementById('onlinePlayButton');
    if (onlineBtn) {
      if (SUPPORTED_GAMES.includes(game)) {
        onlineBtn.disabled = false;
        onlineBtn.textContent = '온라인 플레이';
      } else {
        onlineBtn.disabled = true;
        onlineBtn.textContent = '온라인 미지원';
      }
    }
    fetchQueueStatus(true);
  }
  window.openModeSelect = openModeSelect;


  function getQueueStatusText(count) {
    if (count > 0) return '현재 <strong>' + count + '명</strong> 대기 중';
    return '지금은 대기 중인 플레이어가 없어';
  }

  function updateQueueStatusUi(counts) {
    document.querySelectorAll('.game-card[data-game]').forEach(function(card) {
      var game = card.getAttribute('data-game');
      if (!game) return;
      var status = card.querySelector('.game-queue-status');
      if (!status) {
        status = document.createElement('div');
        status.className = 'game-queue-status is-idle';
        card.appendChild(status);
      }
      var count = counts && typeof counts[game] === 'number' ? counts[game] : 0;
      status.innerHTML = getQueueStatusText(count);
      status.classList.toggle('is-active', count > 0);
      status.classList.toggle('is-idle', count === 0);
      status.classList.remove('is-error');
    });
  }

  function markQueueStatusError() {
    document.querySelectorAll('.game-card[data-game] .game-queue-status').forEach(function(status) {
      status.textContent = '대기 인원 정보를 불러오지 못했어';
      status.classList.remove('is-active', 'is-idle');
      status.classList.add('is-error');
    });
  }

  function fetchQueueStatus(force) {
    var nowTs = Date.now();
    if (!force && nowTs - lastQueueStatusFetchAt < 2500) return Promise.resolve(null);
    lastQueueStatusFetchAt = nowTs;
    var qs = '';
    if (playerId) qs = '?playerId=' + encodeURIComponent(playerId);
    return fetch(appUrl('queue-status') + qs)
      .then(function(res) { return res.json().catch(function() { return null; }).then(function(data) { return { ok: res.ok, data: data }; }); })
      .then(function(result) {
        if (!result || !result.ok || !result.data || result.data.ok === false) throw new Error((result && result.data && result.data.error) || 'queue status failed');
        updateQueueStatusUi(result.data.counts || {});
        return result.data;
      })
      .catch(function(err) {
        console.error('queue status error', err);
        markQueueStatusError();
        return null;
      });
  }

  function ensureRuleModalBindings() {
    var modal = document.getElementById('ruleModal');
    if (!modal || modal.__bound) return;
    modal.__bound = true;
    var closeBtn = document.getElementById('ruleModalClose');
    bindTapFriendlyAction(closeBtn, function(ev) {
      if (ev) ev.stopPropagation();
      closeRuleModal();
    });
    modal.addEventListener('click', function(ev) {
      if (ev.target === modal) closeRuleModal();
    });
    document.addEventListener('keydown', function(ev) {
      if (ev.key === 'Escape') closeRuleModal();
    });
  }

  function closeRuleModal() {
    var modal = document.getElementById('ruleModal');
    if (!modal) return;
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
  }
  window.closeRuleModal = closeRuleModal;

  function openRuleModal(gameKey) {
    ensureRuleModalBindings();
    var data = ruleContent[gameKey];
    var modal = document.getElementById('ruleModal');
    if (!data || !modal) return;
    var kicker = document.getElementById('ruleModalKicker');
    var title = document.getElementById('ruleModalTitle');
    var sub = document.getElementById('ruleModalSub');
    var sections = document.getElementById('ruleModalSections');
    var tip = document.getElementById('ruleModalTip');
    if (kicker) kicker.textContent = data.kicker || '게임 가이드';
    if (title) title.textContent = data.title || '게임 규칙';
    if (sub) sub.textContent = data.subtitle || '';
    if (sections) {
      sections.innerHTML = '';
      (data.sections || []).forEach(function(section) {
        var box = document.createElement('div');
        box.className = 'rule-section';
        var bullets = (section.bullets || []).map(function(line) { return '<li>' + line + '</li>'; }).join('');
        box.innerHTML = '<h3>' + (section.title || '') + '</h3><ul>' + bullets + '</ul>';
        sections.appendChild(box);
      });
    }
    if (tip) tip.textContent = data.tip || '';
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
  }
  window.openRuleModal = openRuleModal;

  function installCardInfoButtons() {
    document.querySelectorAll('.game-card[data-rule]').forEach(function(card) {
      if (card.querySelector('.game-card-info-btn')) return;
      var ruleKey = card.getAttribute('data-rule');
      if (!ruleKey || !ruleContent[ruleKey]) return;
      var btn = document.createElement('button');
      btn.className = 'game-card-info-btn';
      btn.type = 'button';
      btn.setAttribute('aria-label', '게임 규칙 보기');
      btn.innerHTML = '<span>i</span>';
      bindTapFriendlyAction(btn, function(ev) {
        if (ev) {
          ev.preventDefault();
          ev.stopPropagation();
        }
        openRuleModal(ruleKey);
      });
      card.appendChild(btn);
    });
  }


  function stopQueueStatusPolling() {
    if (queueStatusTimer) {
      clearInterval(queueStatusTimer);
      queueStatusTimer = null;
    }
  }

  function installMenuQueueStatus() {
    document.querySelectorAll('.game-card[data-game]').forEach(function(card) {
      if (!card.querySelector('.game-queue-status')) {
        var status = document.createElement('div');
        status.className = 'game-queue-status is-idle';
        status.textContent = '대기 인원 확인 중...';
        card.appendChild(status);
      }
      card.style.touchAction = 'manipulation';
    });
    fetchQueueStatus(true);
    stopQueueStatusPolling();
    queueStatusTimer = setInterval(function() {
      fetchQueueStatus(false);
    }, 4000);
  }

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
      var result = originalShowPage(id);
      if (id === 'pageMenu') installMenuQueueStatus();
      else stopQueueStatusPolling();
      return result;
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
      blokus: ['#pageBlokus .restart-btn', '#pageBlokus button[onclick="blokusOpen()"]', '#pageBlokus button[onclick="blokusSetMode(2)"]', '#pageBlokus button[onclick="blokusSetMode(4)"]'],
      orbito: ['#pageOrbito .restart-btn', '#pageOrbito button[onclick="orbitoRestart()"]'],
      halma: ['#pageHalma .restart-btn', '#pageHalma button[onclick="halmaRestart()"]']
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

  function teardownOnlineSession(notifyServer, options) {
    onlineSessionToken += 1;
    connectionBroken = false;
    reconnectNoticeShown = false;
    if (disconnectRecoveryTimer) {
      clearTimeout(disconnectRecoveryTimer);
      disconnectRecoveryTimer = null;
    }
    clearWaitingRecovery(false);
    if (notifyServer === true) {
      try { bestEffortLeave(); } catch (err) { console.warn('bestEffortLeave failed during teardown', err); }
    }
    onlineGameStarted = false;
    myTurnFlag = false;
    moveInFlight = false;
    gameMode = options && Object.prototype.hasOwnProperty.call(options, 'nextGameMode') ? options.nextGameMode : null;
    roomId = null;
    playerIndex = null;
    playerId = null;
    lastSnapshotRevision = -1;
    if (eventSource) {
      try { eventSource.close(); } catch (_) {}
      eventSource = null;
    }
    try {
      if (currentGame && gameConfigs[currentGame] && gameConfigs[currentGame].onMoveCallbackName) {
        window[gameConfigs[currentGame].onMoveCallbackName] = null;
      }
    } catch (err) {
      console.warn('online move callback cleanup failed', err);
    }
    try {
      if (typeof window.blokusSetOnlineContext === 'function') window.blokusSetOnlineContext(false, null);
    } catch (err) {
      console.warn('blokus online context reset failed', err);
    }
    try { unlockOnlineUnsafeButtons(); } catch (err) { console.warn('unlockOnlineUnsafeButtons failed', err); }
    try { hideWaiting(); } catch (err) { console.warn('hideWaiting failed', err); }
    try { removeChatUI(); } catch (err) { console.warn('removeChatUI failed', err); }
    pendingChatMessages = [];
    onlineEndHandled = false;
    try { removeRoleBadge(); } catch (err) { console.warn('removeRoleBadge failed', err); }
    if (!(options && options.preserveCurrentGame)) currentGame = null;
    if (!currentGame || currentGame !== 'menu') stopQueueStatusPolling();
  }

  function startOffline() {
    try {
      const wasOnline = gameMode === 'online';
      gameMode = 'offline';
      closeModeSelect();
      teardownOnlineSession(wasOnline, { preserveCurrentGame: true, nextGameMode: 'offline' });
      const cfg = gameConfigs[currentGame];
      if (!cfg) {
        alert('게임 정보를 찾지 못했어. 다시 선택해줘.');
        return;
      }
      if (currentGame === 'blokus' && typeof window.blokusSetOnlineContext === 'function') window.blokusSetOnlineContext(false, null);
      showPage(cfg.pageId);
      if (typeof window[cfg.init] === 'function') window[cfg.init]();
      hideWaiting();
      removeChatUI();
      removeRoleBadge();
    } catch (err) {
      console.error('startOffline failed', err);
      alert('오프라인 시작 중 오류가 발생했어. 콘솔을 확인해줘.');
    }
  }
  window.startOffline = startOffline;

  function startOnline() {
    try {
      if (!currentGame) {
        alert('먼저 게임을 선택해줘.');
        return;
      }
      if (!SUPPORTED_GAMES.includes(currentGame)) {
        alert('이 게임은 아직 온라인을 지원하지 않아.');
        return;
      }
      if (window.location.protocol === 'file:') {
        alert('온라인 플레이는 index.html을 파일로 여는 방식으로는 동작하지 않아. server.js를 실행한 뒤 브라우저로 접속해줘.');
        return;
      }
      if (typeof window.EventSource !== 'function') {
        alert('이 브라우저에서는 온라인 연결(EventSource)을 지원하지 않아.');
        return;
      }
      gameMode = 'online';
      closeModeSelect();
      joinOnlineGame(currentGame);
    } catch (err) {
      console.error('startOnline failed', err);
      alert('온라인 시작 중 오류가 발생했어. 콘솔을 확인해줘.');
    }
  }
  window.startOnline = startOnline;

  function installModeSelectBindings() {
    const onlineBtn = document.getElementById('onlinePlayButton');
    const offlineBtn = document.getElementById('offlinePlayButton');
    bindTapFriendlyAction(onlineBtn, function(ev) {
      if (ev) ev.stopPropagation();
      startOnline();
    });
    bindTapFriendlyAction(offlineBtn, function(ev) {
      if (ev) ev.stopPropagation();
      startOffline();
    });
    document.querySelectorAll('.game-card').forEach(function(card) {
      card.style.touchAction = 'manipulation';
    });
    installCardInfoButtons();
    installMenuQueueStatus();
    ensureRuleModalBindings();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installModeSelectBindings, { once: true });
  } else {
    installModeSelectBindings();
  }

  function joinOnlineGame(gameType) {
    teardownOnlineSession(true, { preserveCurrentGame: true, nextGameMode: null });
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
        if (!isCurrentOnlineSession(sessionToken)) {
          if (data && data.playerId && cancelledJoinSessions[sessionToken]) {
            fetch(appUrl('leave'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ playerId: data.playerId }),
              keepalive: true
            }).catch(() => {});
          }
          delete cancelledJoinSessions[sessionToken];
          return;
        }
        delete cancelledJoinSessions[sessionToken];
        if (!data || !data.playerId) throw new Error(data && data.error ? data.error : 'join failed');
        currentGame = gameType;
        playerId = data.playerId;
        roomId = data.roomId || null;
        playerIndex = data.playerIndex == null ? null : data.playerIndex;
        setupEventSource();
      })
      .catch(err => {
        if (!isCurrentOnlineSession(sessionToken)) { delete cancelledJoinSessions[sessionToken]; return; }
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

  function clearWaitingRecovery(resetWaitingMessage) {
    if (waitingRecoveryTimer) {
      clearTimeout(waitingRecoveryTimer);
      waitingRecoveryTimer = null;
    }
    if (resetWaitingMessage && gameMode === 'online' && !onlineGameStarted) {
      const overlay = document.getElementById('waitingOverlay');
      const messageEl = overlay ? overlay.querySelector('#waitingOverlayMessage') : null;
      if (overlay && overlay.classList.contains('show') && messageEl) {
        messageEl.textContent = '다른 플레이어를 기다리는 중입니다.';
      }
    }
  }

  function getWinnerNameForGame(game, winner) {
    if (game === 'axis4' || game === 'gomoku') return winner === 1 ? '흑' : (winner === 2 ? '백' : '');
    return winner === 1 ? '빨강' : (winner === 2 ? '파랑' : '');
  }

  function getSnapshotEndMessage(snapshot) {
    const state = snapshot && snapshot.state ? snapshot.state : null;
    if (!state) return '게임이 종료되었어. 결과를 확인해줘.';
    const gameState = currentGame && state[currentGame] ? state[currentGame] : null;
    if (!gameState) return '게임이 종료되었어. 결과를 확인해줘.';
    if (gameState.draw) return '게임이 무승부로 종료되었어.';
    if ((currentGame === 'axis4' || currentGame === 'gomoku' || currentGame === 'dab' || currentGame === 'blokus' || currentGame === 'quoridor' || currentGame === 'orbito' || currentGame === 'halma') && typeof gameState.winner === 'number') {
      const winnerName = getWinnerNameForGame(currentGame, gameState.winner);
      return winnerName ? (winnerName + ' 승리로 게임이 종료되었어.') : '게임이 종료되었어. 결과를 확인해줘.';
    }
    return '게임이 종료되었어. 결과를 확인해줘.';
  }

  function finalizeOnlineGame(payload) {
    if (onlineEndHandled) return;
    onlineEndHandled = true;
    clearWaitingRecovery(false);
    const finalPayload = payload || { message: '게임이 종료되었어.' };
    if (finalPayload && finalPayload.snapshot) applySnapshot(finalPayload.snapshot, { force: true, suppressEndHandling: true });
    const endMessage = finalPayload.message || '게임이 종료되었어.';
    const endReason = finalPayload.reason || '';
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
    if (typeof showPage === 'function') showPage('pageMenu');
    const warningReasons = ['opponent_disconnected', 'opponent_left', 'player_left', 'match_timeout', 'queue_timeout'];
    const infoReasons = ['room_closed', 'self_left'];
    const tone = warningReasons.includes(endReason) ? 'warning' : (infoReasons.includes(endReason) ? 'info' : 'success');
    showGlobalNotice(endMessage, tone, 4200);
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
        clearWaitingRecovery(true);
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
        clearWaitingRecovery(true);
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
        clearWaitingRecovery(false);
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
          clearWaitingRecovery(false);
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
        clearWaitingRecovery(false);
        appendChatMessage(data);
      } catch (e) {
        console.error(e);
      }
    });

    eventSource.addEventListener('end', function(event) {
      let payload = { message: '상대가 연결을 종료했어.' };
      try { payload = JSON.parse(event.data); } catch (_) {}
      if (!isCurrentOnlineSession(sessionToken) || !isMatchingEndEvent(payload)) return;
      clearWaitingRecovery(false);
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
      showWaiting('온라인 연결을 다시 확인하는 중이야...');
      if (!waitingRecoveryTimer) {
        waitingRecoveryTimer = setTimeout(function() {
          waitingRecoveryTimer = null;
          if (!isCurrentOnlineSession(sessionToken) || gameMode !== 'online' || onlineGameStarted) return;
          hideWaiting();
          teardownOnlineSession(false);
          gameMode = null;
          if (typeof showPage === 'function') showPage('pageMenu');
          showGlobalNotice('온라인 연결 복구가 오래 걸려서 매칭 대기를 종료했어. 다시 온라인 플레이를 눌러줘.', 'warning', 4200);
        }, 12000);
      }
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

  window.fetchStateSync = fetchStateSync;

  function applySnapshot(snapshot, options) {
    if (!snapshot || !snapshot.state) return false;
    const opts = options || {};
    if (snapshot.roomId && roomId && snapshot.roomId !== roomId) return false;
    const revision = typeof snapshot.revision === 'number' ? snapshot.revision : null;
    if (!opts.force && revision !== null && revision <= lastSnapshotRevision) return false;
    if (snapshot.roomId && !roomId) roomId = snapshot.roomId;
    if (snapshot.gameType && !currentGame) currentGame = snapshot.gameType;

    const gameState = currentGame && snapshot.state ? snapshot.state[currentGame] : null;
    try {
      if (snapshot.gameOver === true) myTurnFlag = false;
      else if (typeof snapshot.turnIndex === 'number') myTurnFlag = snapshot.turnIndex === playerIndex;
      if (currentGame === 'axis4' && typeof window.axis4SetState === 'function' && snapshot.state.axis4) window.axis4SetState(snapshot.state.axis4);
      if (currentGame === 'gomoku' && typeof window.gomokuSetState === 'function' && snapshot.state.gomoku) window.gomokuSetState(snapshot.state.gomoku);
      if (currentGame === 'dab' && typeof window.dabSetState === 'function' && snapshot.state.dab) window.dabSetState(snapshot.state.dab);
      if (currentGame === 'blokus' && typeof window.blokusSetState === 'function' && snapshot.state.blokus) window.blokusSetState(snapshot.state.blokus);
      if (currentGame === 'quoridor' && typeof window.quoridorSetState === 'function' && snapshot.state.quoridor) window.quoridorSetState(snapshot.state.quoridor);
      if (currentGame === 'orbito' && typeof window.orbitoSetState === 'function' && snapshot.state.orbito) window.orbitoSetState(snapshot.state.orbito);
      if (currentGame === 'halma' && typeof window.halmaSetState === 'function' && snapshot.state.halma) window.halmaSetState(snapshot.state.halma);
    } catch (err) {
      console.error('applySnapshot failed', err);
      return false;
    }

    if (revision !== null && revision > lastSnapshotRevision) lastSnapshotRevision = revision;
    updateTurnControl();
    if (!opts.suppressEndHandling && snapshot.gameOver === true && gameMode === 'online' && onlineGameStarted && !onlineEndHandled) {
      finalizeOnlineGame({ message: getSnapshotEndMessage(snapshot), snapshot });
    }
    return !!gameState;
  }

  function lockDisconnectedMatch(reasonText) {
    myTurnFlag = false;
    updateTurnControl();
    if (gameMode === 'online' && onlineGameStarted) {
      appendSystemMessage(reasonText || '온라인 연결이 끊겨서 입력을 잠깐 잠글게.');
      if (disconnectRecoveryTimer) clearTimeout(disconnectRecoveryTimer);
      const sessionToken = onlineSessionToken;
      disconnectRecoveryTimer = setTimeout(function() {
        if (!isCurrentOnlineSession(sessionToken) || gameMode !== 'online' || !onlineGameStarted || !connectionBroken) return;
        appendSystemMessage('재연결이 오래 걸려서 이번 대국을 종료할게. 다시 온라인 플레이를 눌러줘.');
        teardownOnlineSession(false);
        gameMode = null;
        if (typeof showPage === 'function') showPage('pageMenu');
        showGlobalNotice('온라인 연결 복구가 오래 걸려서 대국을 종료했어. 다시 온라인 플레이를 눌러줘.', 'warning', 4200);
      }, 12000);
    }
  }

  function markConnectionRestored() {
    if (!connectionBroken) return;
    connectionBroken = false;
    reconnectNoticeShown = false;
    if (disconnectRecoveryTimer) {
      clearTimeout(disconnectRecoveryTimer);
      disconnectRecoveryTimer = null;
    }
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
    if (currentGame === 'blokus' && typeof window.blokusSetOnlineContext === 'function') window.blokusSetOnlineContext(true, playerIndex);
    showPage(cfg.pageId);
    if (typeof window[cfg.init] === 'function') window[cfg.init]();
    lockOnlineUnsafeButtons();

    if (cfg.onMoveCallbackName) {
      window[cfg.onMoveCallbackName] = function() {
        if (!myTurnFlag || moveInFlight) return Promise.resolve(false);
        const sessionToken = onlineSessionToken;
        const previousMyTurn = myTurnFlag;
        moveInFlight = true;
        updateTurnControl();
        const payload = normalizeOutgoingMove(Array.from(arguments));

        return sendMove(currentGame, payload)
          .then((data) => {
            if (sessionToken !== onlineSessionToken || gameMode !== 'online' || connectionBroken) return false;
            moveInFlight = false;
            const isOwnOrbitoRotate = currentGame === 'orbito' && payload && payload.action === 'rotate';
            if (isOwnOrbitoRotate && data && data.snapshot && data.snapshot.state && data.snapshot.state.orbito && typeof window.orbitoAnimateToState === 'function') {
              const snapshot = data.snapshot;
              if (snapshot.roomId && roomId && snapshot.roomId !== roomId) return false;
              const revision = typeof snapshot.revision === 'number' ? snapshot.revision : null;
              if (revision !== null && revision <= lastSnapshotRevision) {
                if (snapshot.gameOver === true && onlineGameStarted && !onlineEndHandled) {
                  finalizeOnlineGame({ message: getSnapshotEndMessage(snapshot), snapshot });
                }
              } else {
                let animated = false;
                try {
                  if (snapshot.roomId && !roomId) roomId = snapshot.roomId;
                  if (snapshot.gameOver === true) myTurnFlag = false;
                  else if (typeof snapshot.turnIndex === 'number') myTurnFlag = snapshot.turnIndex === playerIndex;
                  window.orbitoAnimateToState(snapshot.state.orbito);
                  animated = true;
                } catch (err) {
                  console.error('orbito animate (own move) failed', err);
                  animated = applySnapshot(snapshot, { force: true, suppressEndHandling: true });
                }
                if (animated && revision !== null && revision > lastSnapshotRevision) lastSnapshotRevision = revision;
                updateTurnControl();
                if (snapshot.gameOver === true && onlineGameStarted && !onlineEndHandled) {
                  finalizeOnlineGame({ message: getSnapshotEndMessage(snapshot), snapshot });
                }
              }
            } else if (data && data.snapshot) {
              applySnapshot(data.snapshot);
            } else if (data && data.gameOver === true) {
              myTurnFlag = false;
            } else if (data && data.keepTurn === true) {
              myTurnFlag = true;
            } else {
              myTurnFlag = false;
            }
            updateTurnControl();
            return true;
          })
          .catch(() => {
            if (sessionToken !== onlineSessionToken) return false;
            moveInFlight = false;
            return fetchStateSync()
              .then((data) => {
                if (sessionToken !== onlineSessionToken || gameMode !== 'online' || connectionBroken) return false;
                if (data && data.snapshot) applySnapshot(data.snapshot);
                else {
                  myTurnFlag = previousMyTurn;
                  updateTurnControl();
                }
                return false;
              })
              .catch(() => {
                if (sessionToken !== onlineSessionToken || gameMode !== 'online' || connectionBroken) return false;
                myTurnFlag = previousMyTurn;
                updateTurnControl();
                appendSystemMessage('이동 전송이 실패해서 입력 상태를 원래대로 되돌렸어. 다시 시도해줘.');
                return false;
              });
          });
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
      blokus: 'blokusOverlay',
      orbito: 'orbitoWinBanner',
      halma: 'halmaOverlay'
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

    const move = eventData.move;
    const kind = move.kind || currentGame;
    const payload = Object.prototype.hasOwnProperty.call(move, 'payload') ? move.payload : move.data;
    const isOwnMoveEvent = eventData.playerIndex === playerIndex;
    if (isOwnMoveEvent && !eventData.snapshot) {
      return;
    }
    if (isOwnMoveEvent && eventData.snapshot) {
      const ownSnapshot = eventData.snapshot;
      const ownPayload = move && Object.prototype.hasOwnProperty.call(move, 'payload') ? move.payload : move.data;
      const ownRotate = (kind === 'orbito' || currentGame === 'orbito') && ownPayload && typeof ownPayload === 'object' && ownPayload.action === 'rotate';
      if (ownRotate && ownSnapshot && ownSnapshot.state && ownSnapshot.state.orbito && typeof window.orbitoAnimateToState === 'function') {
        const revision = typeof ownSnapshot.revision === 'number' ? ownSnapshot.revision : null;
        if (revision !== null && revision <= lastSnapshotRevision) return;
        let animated = false;
        try {
          if (ownSnapshot.gameOver === true) myTurnFlag = false;
          else if (typeof ownSnapshot.turnIndex === 'number' && typeof playerIndex === 'number') myTurnFlag = ownSnapshot.turnIndex === playerIndex;
          window.orbitoAnimateToState(ownSnapshot.state.orbito);
          animated = true;
        } catch (err) {
          console.error('orbito animate (own event) failed', err);
          animated = applySnapshot(ownSnapshot, { force: true, suppressEndHandling: true });
        }
        if (animated && revision !== null && revision > lastSnapshotRevision) lastSnapshotRevision = revision;
        updateTurnControl();
        if (ownSnapshot.gameOver === true && gameMode === 'online' && onlineGameStarted && !onlineEndHandled) {
          finalizeOnlineGame({ message: getSnapshotEndMessage(ownSnapshot), snapshot: ownSnapshot });
        }
      } else {
        applySnapshot(ownSnapshot);
      }
      return;
    }

    const hasSnapshot = !!eventData.snapshot;
    const isOrbitoRotateWithSnapshot = (kind === 'orbito' || currentGame === 'orbito') && hasSnapshot && payload && typeof payload === 'object' && payload.action === 'rotate';
    let appliedMeta = { applied: false, gameOver: false, keepTurn: false };

    if (isOrbitoRotateWithSnapshot && eventData.snapshot && eventData.snapshot.state && eventData.snapshot.state.orbito && typeof window.orbitoAnimateToState === 'function') {
      const snapshot = eventData.snapshot;
      const revision = typeof snapshot.revision === 'number' ? snapshot.revision : null;
      let animated = false;
      try {
        if (snapshot.gameOver === true) myTurnFlag = false;
        else if (typeof snapshot.turnIndex === 'number' && typeof playerIndex === 'number') myTurnFlag = snapshot.turnIndex === playerIndex;
        window.orbitoAnimateToState(snapshot.state.orbito);
        animated = true;
      } catch (err) {
        console.error('orbito animate (remote move) failed', err);
        animated = applySnapshot(snapshot, { force: true, suppressEndHandling: true });
      }
      if (animated && revision !== null && revision > lastSnapshotRevision) lastSnapshotRevision = revision;
      updateTurnControl();
      if (snapshot.gameOver === true && gameMode === 'online' && onlineGameStarted && !onlineEndHandled) {
        finalizeOnlineGame({ message: getSnapshotEndMessage(snapshot), snapshot });
      }
      return;
    }

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
      } else if ((kind === 'blokus' || currentGame === 'blokus') && payload && typeof payload === 'object') {
        if (typeof window[cfg.apply] === 'function') appliedMeta = window[cfg.apply](payload) || { applied: true, gameOver: false, keepTurn: false };
      } else if ((kind === 'orbito' || currentGame === 'orbito') && payload && typeof payload === 'object') {
        if (typeof window[cfg.apply] === 'function') appliedMeta = window[cfg.apply](payload) || { applied: true, gameOver: false, keepTurn: false };
      } else if ((kind === 'halma' || currentGame === 'halma') && payload && typeof payload === 'object') {
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
      const localCanCommit = typeof window.axis4CanCommit === 'function' ? !!window.axis4CanCommit() : true;
      if (btn) btn.disabled = !myTurnFlag || moveInFlight || !localCanCommit;
      setCanvasInteractivity('axis4Canvas', myTurnFlag && !moveInFlight);
    }
    if (currentGame === 'gomoku') {
      const btn = document.getElementById('gomokuCommitBtn');
      const localCanCommit = typeof window.gomokuCanCommit === 'function' ? !!window.gomokuCanCommit() : true;
      if (btn) btn.disabled = !myTurnFlag || moveInFlight || !localCanCommit;
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
    if (currentGame === 'blokus') {
      setCanvasInteractivity('blokusCanvas', myTurnFlag && !moveInFlight);
      if (typeof window.blokusSetOnlineTurnState === 'function') {
        window.blokusSetOnlineTurnState(myTurnFlag && !moveInFlight, moveInFlight, gameMode === 'online');
      }
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
    if (currentGame === 'halma') {
      setCanvasInteractivity('halmaCanvas', myTurnFlag && !moveInFlight);
      ['halmaMode2Btn', 'halmaMode3Btn', 'halmaEndTurnBtn'].forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (id === 'halmaEndTurnBtn') el.disabled = !myTurnFlag || moveInFlight || !(window.halmaCanEndTurn && window.halmaCanEndTurn());
        else el.disabled = true;
      });
      const clearBtn = document.getElementById('halmaClearBtn');
      if (clearBtn) clearBtn.disabled = !myTurnFlag || moveInFlight || !!(window.halmaCanEndTurn && window.halmaCanEndTurn());
    }
  }

  function cancelCurrentOnlineMatch() {
    if (gameMode !== 'online') return;
    if (!playerId) cancelledJoinSessions[onlineSessionToken] = true;
    hideWaiting();
    teardownOnlineSession(true);
    if (typeof showPage === 'function') showPage('pageMenu');
  }
  window.cancelCurrentOnlineMatch = cancelCurrentOnlineMatch;

  function ensureWaitingOverlay() {
    let overlay = document.getElementById('waitingOverlay');
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.id = 'waitingOverlay';
    overlay.className = 'overlay';
    overlay.innerHTML =
      '<div class="overlay-box waiting-box">' +
      '<h2>매칭 대기 중...</h2>' +
      '<p id="waitingOverlayMessage">다른 플레이어를 기다리는 중입니다.</p>' +
      '<div class="overlay-btns">' +
      '<button id="waitingCancelBtn" class="btn-secondary" type="button">취소하고 나가기</button>' +
      '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    const cancelBtn = overlay.querySelector('#waitingCancelBtn');
    if (cancelBtn) {
      bindTapFriendlyAction(cancelBtn, function(ev) {
        if (ev) ev.stopPropagation();
        cancelCurrentOnlineMatch();
      });
    }
    return overlay;
  }

  function showWaiting(messageText) {
    const overlay = ensureWaitingOverlay();
    const msg = overlay.querySelector('#waitingOverlayMessage');
    if (msg) msg.textContent = messageText || '다른 플레이어를 기다리는 중입니다.';
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
      orbito: '#pageOrbito .status-bar',
      halma: '#pageHalma .status-bar'
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
          if (sendBtn && sendBtn.isConnected) sendBtn.disabled = false;
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
