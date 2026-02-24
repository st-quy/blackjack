import './styles/index.css';
import './styles/cards.css';
import './styles/table.css';
import './styles/components.css';
import './styles/lobby.css';

import { io } from 'socket.io-client';
import { createCardElement, renderHand } from './ui/cards.js';
import { getBestScore } from './engine/hand.js';
import {
  GAME_STATE, MAX_SEATS, HAND_TYPE,
  BET_OPTIONS, MIN_BET, STARTING_BALANCE,
} from './engine/constants.js';

// ============================================================
//  GLOBALS
// ============================================================
let socket = null;
let playerName = '';
let currentRoomId = null;
let gameState = null; // server-sent game state
let roomList = [];
let selectedBet = MIN_BET;
let statusTimeout = null;
let screen = 'lobby'; // 'lobby' | 'game'

// Turn timer
const TURN_TIME = 15;
let turnTimeLeft = TURN_TIME;

// ============================================================
//  INIT
// ============================================================
function init() {
  renderApp();
  showNameModal();
}

function connectToServer() {
  // In production, client is served by the same server, so connect to same origin
  // In dev, Vite runs on 5173 and server on 3001
  const serverUrl = import.meta.env.DEV
    ? 'http://localhost:3001'
    : undefined; // undefined = same origin

  socket = io(serverUrl);

  socket.on('connect', () => {
    console.log('[Socket] Connected:', socket.id);
    showToast('Đã kết nối server', 'success');
  });

  socket.on('disconnect', () => {
    console.log('[Socket] Disconnected');
    showToast('Mất kết nối!', 'error');
  });

  socket.on('room-list', (rooms) => {
    roomList = rooms;
    if (screen === 'lobby') renderLobby();
  });

  socket.on('joined-room', (data) => {
    currentRoomId = data.roomId;
    screen = 'game';
    renderApp();
    render();
    showStatus(`Đã vào ${data.roomName}`);
  });

  socket.on('game-state', (state) => {
    gameState = state;
    render();
  });

  socket.on('timer-tick', (timeLeft) => {
    turnTimeLeft = timeLeft;
    updateTimerDisplay();
  });

  socket.on('error-msg', (data) => {
    showToast(data.message, 'error');
  });

  socket.on('room-created', (data) => {
    showToast(`Tạo phòng "${data.name}" thành công!`, 'success');
  });
}

// ============================================================
//  NAME MODAL
// ============================================================
function showNameModal() {
  const existing = document.querySelector('.name-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.className = 'name-modal';
  modal.innerHTML = `
    <div class="name-modal-content">
      <h2>🃏 Xì Dách Online</h2>
      <p style="color: var(--text-secondary); margin-bottom: 16px;">Nhập tên của bạn để bắt đầu</p>
      <input class="name-input" type="text" placeholder="Tên của bạn..." maxlength="12" value="" autofocus />
      <div class="name-modal-actions">
        <button class="btn btn-deal" id="start-btn" style="width: 100%; margin-top: 8px;">VÀO CHƠI</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const input = modal.querySelector('.name-input');
  const startBtn = modal.querySelector('#start-btn');

  function start() {
    const name = input.value.trim() || 'Người chơi';
    playerName = name;
    modal.remove();
    connectToServer();
    screen = 'lobby';
    renderApp();
  }

  startBtn.addEventListener('click', start);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') start();
  });
  setTimeout(() => input.focus(), 100);
}

// ============================================================
//  RENDER APP SHELL
// ============================================================
function renderApp() {
  const app = document.getElementById('app');
  if (screen === 'lobby') {
    app.innerHTML = `
      <div class="header-bar">
        <div class="header-brand">
          <span class="header-brand-icon">🃏</span>
          <span class="header-brand-name">Xì Dách Online</span>
        </div>
        <div class="header-player-info">
          <span style="color: var(--accent-green); font-size: 10px;">●</span>
          <span style="color: var(--text-secondary); font-size: 13px;">${playerName}</span>
        </div>
      </div>
      <div id="lobby-container" class="lobby-container"></div>
      <div class="toast-container" id="toast-container"></div>
    `;
    renderLobby();
  } else {
    app.innerHTML = `
      <div class="header-bar">
        <div class="header-brand">
          <span class="header-brand-icon" style="cursor:pointer" id="back-btn">◀</span>
          <span class="header-brand-name">Xì Dách</span>
        </div>
        <div class="header-player-info">
          <div class="header-balance">
            <span class="header-balance-icon">💰</span>
            <span class="header-balance-amount" id="balance-display">${formatMoney(STARTING_BALANCE)}</span>
          </div>
        </div>
      </div>
      <div class="game-table-wrapper">
        <div class="game-table" id="game-table">
          <div class="table-center">
            <div class="table-logo">XÌ DÁCH</div>
            <div class="table-info" id="table-info">Đang chờ...</div>
          </div>
        </div>
        <div id="game-status-container"></div>
      </div>
      <div class="actions-bar" id="actions-bar"></div>
      <div class="toast-container" id="toast-container"></div>
    `;
    const backBtn = document.getElementById('back-btn');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        socket.emit('leave-room');
        currentRoomId = null;
        gameState = null;
        screen = 'lobby';
        renderApp();
      });
    }
  }
}

// ============================================================
//  LOBBY RENDER
// ============================================================
function renderLobby() {
  const container = document.getElementById('lobby-container');
  if (!container) return;

  container.innerHTML = `
    <div class="lobby-header">
      <h2>🏠 Sảnh chơi</h2>
      <button class="btn btn-deal btn-sm" id="create-room-btn">+ TẠO PHÒNG</button>
    </div>
    <div class="room-grid" id="room-grid">
      ${roomList.length === 0 ? '<p style="color:var(--text-muted); text-align:center; grid-column:1/-1;">Đang tải phòng...</p>' : ''}
      ${roomList.map(room => `
        <div class="room-card" data-room-id="${room.id}">
          <div class="room-card-header">
            <span class="room-card-name">${room.name}</span>
            <span class="room-card-status ${room.state === 'LOBBY' || room.state === 'RESULTS' ? 'open' : 'playing'}">${room.state === 'LOBBY' || room.state === 'RESULTS' ? 'Chờ' : 'Đang chơi'}</span>
          </div>
          <div class="room-card-info">
            <span>👥 ${room.playerCount}/${room.maxSeats}</span>
            ${room.observerCount > 0 ? `<span>👁 ${room.observerCount}</span>` : ''}
          </div>
          <button class="btn btn-hit btn-sm room-join-btn" data-room-id="${room.id}">VÀO PHÒNG</button>
        </div>
      `).join('')}
    </div>
  `;

  // Create room
  document.getElementById('create-room-btn')?.addEventListener('click', () => {
    socket.emit('create-room', { name: `Bàn của ${playerName}` });
  });

  // Join room
  container.querySelectorAll('.room-join-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const roomId = btn.dataset.roomId;
      socket.emit('join-room', { roomId, playerName });
    });
  });
}

// ============================================================
//  MAIN RENDER (GAME SCREEN)
// ============================================================
function render() {
  if (screen !== 'game' || !gameState) return;
  renderSeats();
  renderActions();
  updateHeader();
  updateTableInfo();
}

// ============================================================
//  RENDER SEATS
// ============================================================
function renderSeats() {
  const table = document.getElementById('game-table');
  if (!table) return;

  table.querySelectorAll('.seat').forEach(el => el.remove());

  for (let i = 0; i < MAX_SEATS; i++) {
    const player = gameState.seats[i];
    const seat = document.createElement('div');
    seat.className = 'seat';
    seat.dataset.seat = i;

    if (player) {
      const isActive = !player.isHost && gameState.state === GAME_STATE.PLAYER_TURNS && !player.hasStayed;
      const isMe = player.isMe;

      // Cards
      const cardsDiv = document.createElement('div');
      cardsDiv.className = 'seat-cards';

      if (player.cards && player.cards.length > 0) {
        const realCards = player.cards.map(c => c.hidden ? { suit: '?', rank: '?', id: 'hidden' } : c);
        const showFace = !player.cards[0]?.hidden;
        const handEl = renderHand(realCards, showFace, true, false);
        cardsDiv.appendChild(handEl);
      }

      // Player info
      const info = document.createElement('div');
      info.className = `seat-info${isActive && isMe ? ' active' : ''}${player.isHost ? ' is-host' : ''}${isMe ? ' is-me' : ''}`;

      if (!player.connected) {
        info.style.opacity = '0.4';
      }

      // Score badge
      if (player.score !== null && player.score !== undefined) {
        const scoreBadge = document.createElement('div');
        let scoreClass = '';
        let scoreText = `${player.score}`;

        if (player.hand) {
          if (player.hand.type === HAND_TYPE.XI_BANG) { scoreText = 'Xì Bàng!'; scoreClass = 'natural'; }
          else if (player.hand.type === HAND_TYPE.XI_DACH) { scoreText = 'Xì Dách!'; scoreClass = 'natural'; }
          else if (player.hand.type === HAND_TYPE.NGU_LINH) { scoreText = `Ngũ Linh (${player.score})`; scoreClass = 'blackjack'; }
          else if (player.hand.type === HAND_TYPE.BUSTED) { scoreText = `Quắc! (${player.score})`; scoreClass = 'busted'; }
        }
        scoreBadge.className = `seat-score ${scoreClass}`;
        scoreBadge.textContent = scoreText;
        info.appendChild(scoreBadge);
      }

      // Name
      const nameEl = document.createElement('div');
      nameEl.className = 'seat-name';
      nameEl.textContent = player.name + (isMe ? ' (Bạn)' : '');
      info.appendChild(nameEl);

      if (player.isHost) {
        const badge = document.createElement('span');
        badge.className = 'seat-badge';
        badge.textContent = 'CÁI';
        info.appendChild(badge);
      }

      const balanceEl = document.createElement('div');
      balanceEl.className = 'seat-balance';
      balanceEl.textContent = `💰 ${formatMoney(player.balance)}`;
      info.appendChild(balanceEl);

      if (!player.isHost && player.bet > 0 && gameState.state !== GAME_STATE.LOBBY) {
        const betEl = document.createElement('div');
        betEl.className = 'seat-bet';
        betEl.textContent = `Cược: ${formatMoney(player.bet)}`;
        info.appendChild(betEl);
      }

      // Result overlay
      if (gameState.state === GAME_STATE.RESULTS && player.result) {
        const resultEl = document.createElement('div');
        if (player.isHost) {
          resultEl.className = 'seat-result host-label';
          resultEl.textContent = 'Nhà cái';
        } else if (player.result === 'win') {
          resultEl.className = 'seat-result win';
          resultEl.textContent = `+${formatMoney(player.payout)}`;
        } else if (player.result === 'lose') {
          resultEl.className = 'seat-result lose';
          resultEl.textContent = `${formatMoney(player.payout)}`;
        } else {
          resultEl.className = 'seat-result tie';
          resultEl.textContent = 'Hòa';
        }
        cardsDiv.style.position = 'relative';
        cardsDiv.appendChild(resultEl);
      }

      seat.appendChild(cardsDiv);
      seat.appendChild(info);
    } else {
      // Empty seat
      const empty = document.createElement('div');
      empty.className = 'seat-empty';
      empty.textContent = 'Ngồi';
      empty.addEventListener('click', () => {
        socket.emit('sit', { seatIndex: i });
      });
      seat.appendChild(empty);
    }

    table.appendChild(seat);
  }
}

// ============================================================
//  RENDER ACTIONS
// ============================================================
function renderActions() {
  const bar = document.getElementById('actions-bar');
  if (!bar || !gameState) return;
  bar.innerHTML = '';

  const mySeat = gameState.seats.find(s => s && s.isMe);
  const state = gameState.state;

  // Not seated - show sit prompt
  if (!mySeat) {
    const msg = document.createElement('div');
    msg.style.cssText = 'color: var(--text-secondary); font-size: 14px;';
    msg.textContent = '👆 Nhấn vào ghế trống để ngồi';
    bar.appendChild(msg);
    return;
  }

  // LOBBY / RESULTS: Bet + Deal
  if (state === GAME_STATE.LOBBY || state === GAME_STATE.RESULTS) {
    if (!mySeat.isHost) {
      const betControls = document.createElement('div');
      betControls.className = 'bet-controls';
      const label = document.createElement('label');
      label.textContent = 'Cược:';
      betControls.appendChild(label);

      const selector = document.createElement('div');
      selector.className = 'bet-selector';
      BET_OPTIONS.forEach(amount => {
        if (amount > mySeat.balance) return;
        const chip = document.createElement('button');
        chip.className = `bet-chip-btn${amount === selectedBet ? ' selected' : ''}`;
        chip.textContent = formatShortMoney(amount);
        chip.addEventListener('click', () => {
          selectedBet = amount;
          socket.emit('set-bet', { amount });
          render();
        });
        selector.appendChild(chip);
      });
      betControls.appendChild(selector);
      bar.appendChild(betControls);
    }

    const dealBtn = createButton('CHIA BÀI', 'btn-deal', () => {
      socket.emit('set-bet', { amount: selectedBet });
      socket.emit('deal');
    });
    bar.appendChild(dealBtn);

    // Transfer host button (only show if current player is host)
    if (mySeat.isHost) {
      const otherPlayers = gameState.seats.filter(s => s && !s.isMe);
      if (otherPlayers.length > 0) {
        const transferBtn = createButton('NHƯỜNG CÁI', 'btn-secondary', () => {
          showTransferHostModal(otherPlayers);
        });
        bar.appendChild(transferBtn);
      }
    }
    return;
  }

  // PLAYER TURNS: Hit/Stay
  if (state === GAME_STATE.PLAYER_TURNS && !mySeat.isHost && !mySeat.hasStayed) {
    // Timer
    bar.appendChild(createTimerElement());

    // Score hint
    const scoreHint = document.createElement('div');
    scoreHint.style.cssText = 'font-size: 13px; margin-right: 12px; text-align: center;';
    const score = mySeat.score || 0;
    if (score < 16) {
      scoreHint.style.color = 'var(--accent-gold)';
      scoreHint.innerHTML = `Điểm: <b>${score}</b> — Cần ≥ 16 để dừng`;
    } else {
      scoreHint.style.color = 'var(--accent-green)';
      scoreHint.innerHTML = `Điểm: <b>${score}</b>`;
    }
    bar.appendChild(scoreHint);

    const hitBtn = createButton('BỐC BÀI', 'btn-hit', () => socket.emit('hit'));
    hitBtn.disabled = !mySeat.canHit;
    bar.appendChild(hitBtn);

    const stayBtn = createButton('DỪNG', 'btn-stay', () => socket.emit('stay'));
    stayBtn.disabled = !mySeat.canStay;
    bar.appendChild(stayBtn);
    return;
  }

  // HOST TURN: Hit/Stay/Check
  if (state === GAME_STATE.HOST_TURN && mySeat.isHost) {
    bar.appendChild(createTimerElement());

    if (!mySeat.hasStayed) {
      const hitBtn = createButton('BỐC BÀI', 'btn-hit', () => socket.emit('hit'));
      hitBtn.disabled = !mySeat.canHit;
      bar.appendChild(hitBtn);

      const stayBtn = createButton('DỪNG', 'btn-stay', () => socket.emit('stay'));
      const hostScore = mySeat.score || 0;
      stayBtn.disabled = hostScore < 16 && (mySeat.cards?.length || 0) < 5;
      bar.appendChild(stayBtn);
    }

    // Check buttons
    const canCheck = (mySeat.score || 0) >= 16 || (mySeat.cards?.length || 0) >= 5;
    if (canCheck) {
      gameState.seats.forEach((p, i) => {
        if (p && !p.isHost && !p.isChecked) {
          const checkBtn = createButton(`XÉT ${p.name.toUpperCase()}`, 'btn-check', () => {
            socket.emit('host-check', { targetSeatIndex: i });
          });
          bar.appendChild(checkBtn);
        }
      });
    }
    return;
  }

  // Waiting messages
  if (state === GAME_STATE.PLAYER_TURNS && mySeat.isHost) {
    bar.innerHTML = '<div style="color:var(--text-secondary);font-size:14px;">⏳ Đang chờ các tụ con ra bài...</div>';
    return;
  }
  if (state === GAME_STATE.PLAYER_TURNS && mySeat.hasStayed) {
    bar.innerHTML = '<div style="color:var(--text-secondary);font-size:14px;">⏳ Đang chờ người khác...</div>';
    return;
  }
  if (state === GAME_STATE.HOST_TURN && !mySeat.isHost) {
    bar.innerHTML = '<div style="color:var(--text-secondary);font-size:14px;">⏳ Nhà cái đang xét bài...</div>';
    return;
  }
}

// ============================================================
//  UPDATE HEADER + TABLE INFO
// ============================================================
function updateHeader() {
  const balanceEl = document.getElementById('balance-display');
  if (!balanceEl || !gameState) return;
  const mySeat = gameState.seats.find(s => s && s.isMe);
  if (mySeat) {
    balanceEl.textContent = formatMoney(mySeat.balance);
  }
}

function updateTableInfo() {
  const infoEl = document.getElementById('table-info');
  if (!infoEl || !gameState) return;
  const msgs = {
    [GAME_STATE.LOBBY]: `${gameState.seats.filter(Boolean).length} người chơi — Chờ chia bài`,
    [GAME_STATE.DEALING]: 'Đang chia bài...',
    [GAME_STATE.PLAYER_TURNS]: 'Tụ con đang ra bài',
    [GAME_STATE.HOST_TURN]: 'Nhà cái đang xét bài',
    [GAME_STATE.RESULTS]: `Ván ${gameState.roundNumber} hoàn tất`,
  };
  infoEl.textContent = msgs[gameState.state] || '';
}

// ============================================================
//  TIMER
// ============================================================
function createTimerElement() {
  const wrapper = document.createElement('div');
  wrapper.className = `turn-timer${turnTimeLeft <= 5 ? ' urgent' : ''}`;
  wrapper.id = 'turn-timer';

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '48');
  svg.setAttribute('height', '48');
  svg.setAttribute('viewBox', '0 0 48 48');

  const bgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  bgCircle.setAttribute('cx', '24'); bgCircle.setAttribute('cy', '24');
  bgCircle.setAttribute('r', '20'); bgCircle.setAttribute('fill', 'none');
  bgCircle.setAttribute('stroke', 'rgba(255,255,255,0.1)'); bgCircle.setAttribute('stroke-width', '3');

  const progressCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  progressCircle.setAttribute('cx', '24'); progressCircle.setAttribute('cy', '24');
  progressCircle.setAttribute('r', '20'); progressCircle.setAttribute('fill', 'none');
  progressCircle.setAttribute('stroke-width', '3'); progressCircle.setAttribute('stroke-linecap', 'round');
  progressCircle.setAttribute('transform', 'rotate(-90 24 24)');
  progressCircle.id = 'timer-progress';

  const circumference = 2 * Math.PI * 20;
  const fraction = Math.max(0, turnTimeLeft) / TURN_TIME;
  progressCircle.style.strokeDasharray = circumference;
  progressCircle.style.strokeDashoffset = circumference * (1 - fraction);
  progressCircle.style.transition = 'stroke-dashoffset 1s linear, stroke 0.3s ease';
  progressCircle.style.stroke = fraction > 0.5 ? 'var(--accent-green)' : fraction > 0.25 ? 'var(--accent-gold)' : 'var(--accent-red)';

  svg.appendChild(bgCircle);
  svg.appendChild(progressCircle);

  const text = document.createElement('span');
  text.className = 'turn-timer-text';
  text.id = 'timer-text';
  text.textContent = Math.max(0, turnTimeLeft);

  wrapper.appendChild(svg);
  wrapper.appendChild(text);
  return wrapper;
}

function updateTimerDisplay() {
  const textEl = document.getElementById('timer-text');
  const progressEl = document.getElementById('timer-progress');
  const wrapper = document.getElementById('turn-timer');

  if (textEl) textEl.textContent = Math.max(0, turnTimeLeft);

  if (wrapper) {
    if (turnTimeLeft <= 5) wrapper.classList.add('urgent');
    else wrapper.classList.remove('urgent');
  }

  if (progressEl) {
    const circumference = 2 * Math.PI * 20;
    const fraction = Math.max(0, turnTimeLeft) / TURN_TIME;
    progressEl.style.strokeDashoffset = circumference * (1 - fraction);
    progressEl.style.stroke = fraction > 0.5 ? 'var(--accent-green)' : fraction > 0.25 ? 'var(--accent-gold)' : 'var(--accent-red)';
  }
}

// ============================================================
//  UTILITIES
// ============================================================
function createButton(text, className, onClick) {
  const btn = document.createElement('button');
  btn.className = `btn ${className}`;
  btn.textContent = text;
  btn.addEventListener('click', onClick);
  return btn;
}

function formatMoney(amount) {
  return new Intl.NumberFormat('vi-VN').format(amount);
}

function formatShortMoney(amount) {
  if (amount >= 1000) return `${amount / 1000}K`;
  return `${amount}`;
}

function showTransferHostModal(players) {
  const existing = document.querySelector('.name-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.className = 'name-modal';
  modal.innerHTML = `
    <div class="name-modal-content">
      <h2 style="font-size: 20px;">🔄 Nhường cái</h2>
      <p style="color: var(--text-secondary); margin-bottom: 16px;">Chọn người nhận vai nhà cái</p>
      <div id="transfer-list" style="display:flex;flex-direction:column;gap:8px;">
        ${players.map(p => `
          <button class="btn btn-hit" style="width:100%" data-seat="${p.seatIndex}">
            ${p.name}
          </button>
        `).join('')}
      </div>
      <button class="btn btn-secondary" style="width:100%;margin-top:12px;" id="cancel-transfer">HỦY</button>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelectorAll('[data-seat]').forEach(btn => {
    btn.addEventListener('click', () => {
      socket.emit('transfer-host', { targetSeatIndex: parseInt(btn.dataset.seat) });
      modal.remove();
    });
  });

  modal.querySelector('#cancel-transfer').addEventListener('click', () => modal.remove());
}

function showStatus(message) {
  const container = document.getElementById('game-status-container');
  if (!container) return;
  if (statusTimeout) clearTimeout(statusTimeout);
  container.innerHTML = `<div class="game-status">${message}</div>`;
  statusTimeout = setTimeout(() => { container.innerHTML = ''; }, 3000);
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(30px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ============================================================
//  START
// ============================================================
document.addEventListener('DOMContentLoaded', init);
