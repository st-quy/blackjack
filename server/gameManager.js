import {
    GAME_STATE, PLAYER_TYPE, MAX_SEATS, STARTING_BALANCE,
    MIN_BET, MAX_BET, HAND_TYPE, ANIM, MIN_VALID_SCORE, BLACKJACK_SCORE
} from '../src/engine/constants.js';
import { createShoe } from '../src/engine/deck.js';
import {
    classifyHand, getBestScore, canHit,
    getPayoutMultiplier, getHandTypeName
} from '../src/engine/hand.js';

const TURN_TIME = 15; // seconds

function createPlayer(id, name, seatIndex) {
    return {
        id,
        name,
        seatIndex,
        cards: [],
        bet: MIN_BET,
        balance: STARTING_BALANCE,
        isHost: false,
        hasStayed: false,
        isChecked: false,
        result: null,
        payout: 0,
        connected: true,
    };
}

export function createServerGame(roomId) {
    let state = GAME_STATE.LOBBY;
    let seats = new Array(MAX_SEATS).fill(null);
    let shoe = createShoe();
    let hostSeatIndex = -1;
    let roundNumber = 0;
    let turnTimer = null;
    let turnTimeLeft = TURN_TIME;
    let currentTurnSeatIndex = -1; // sequential turn tracking

    function getState() {
        return state;
    }

    function getActivePlayers() {
        return seats.filter(s => s !== null);
    }

    function getActiveNonHostPlayers() {
        return seats.filter(s => s !== null && !s.isHost);
    }

    function getHost() {
        return seats.find(s => s !== null && s.isHost);
    }

    function getSeatByPlayerId(playerId) {
        return seats.find(s => s !== null && s.id === playerId);
    }

    // --- Serialization for clients ---
    function serializeForPlayer(playerId) {
        return {
            roomId,
            state,
            roundNumber,
            hostSeatIndex,
            turnTimeLeft,
            currentTurnSeatIndex,
            seats: seats.map((player, i) => {
                if (!player) return null;
                const isMe = player.id === playerId;
                const showCards = shouldShowCards(player, playerId);
                const isMyTurn = (state === GAME_STATE.PLAYER_TURNS && i === currentTurnSeatIndex && isMe)
                    || (state === GAME_STATE.HOST_TURN && player.isHost && isMe);
                return {
                    seatIndex: i,
                    name: player.name,
                    balance: player.balance,
                    bet: player.bet,
                    isHost: player.isHost,
                    hasStayed: player.hasStayed,
                    isChecked: player.isChecked,
                    result: player.result,
                    payout: player.payout,
                    isMe,
                    isMyTurn,
                    connected: player.connected,
                    cards: showCards ? player.cards : player.cards.map(() => ({ hidden: true })),
                    hand: showCards && player.cards.length > 0 ? classifyHand(player.cards) : null,
                    score: showCards && player.cards.length > 0 ? getBestScore(player.cards) : null,
                    canHit: isMe && isMyTurn ? canHit(player.cards) : false,
                    canStay: isMe && isMyTurn ? (getBestScore(player.cards) >= MIN_VALID_SCORE || player.cards.length >= 5) && !player.hasStayed : false,
                };
            }),
        };
    }

    function shouldShowCards(player, viewerPlayerId) {
        // Always show own cards
        if (player.id === viewerPlayerId) return true;
        // During results, show all
        if (state === GAME_STATE.RESULTS) return true;
        // During host turn, show checked players to host
        if (state === GAME_STATE.HOST_TURN && player.isChecked) return true;
        // Host cards are ALWAYS hidden until results
        if (player.isHost && state !== GAME_STATE.RESULTS) return false;
        // During player turns, hide other players' cards
        if (state === GAME_STATE.PLAYER_TURNS) return false;
        return false;
    }

    // --- Actions ---
    function sit(playerId, name, seatIndex) {
        if (seatIndex < 0 || seatIndex >= MAX_SEATS) return { ok: false, error: 'Ghế không hợp lệ' };
        if (seats[seatIndex] !== null) return { ok: false, error: 'Ghế đã có người' };
        if (state !== GAME_STATE.LOBBY && state !== GAME_STATE.RESULTS) return { ok: false, error: 'Không thể ngồi lúc này' };
        const existing = getSeatByPlayerId(playerId);
        if (existing) return { ok: false, error: 'Bạn đã có ghế' };

        seats[seatIndex] = createPlayer(playerId, name, seatIndex);

        // First player to sit becomes host
        if (!getHost()) {
            seats[seatIndex].isHost = true;
            hostSeatIndex = seatIndex;
        }
        return { ok: true };
    }

    function leaveSeat(playerId) {
        const player = getSeatByPlayerId(playerId);
        if (!player) return { ok: false, error: 'Bạn chưa ngồi' };
        const wasHost = player.isHost;
        seats[player.seatIndex] = null;

        // If the host left, transfer to next player
        if (wasHost) {
            autoAssignHost();
        }
        return { ok: true };
    }

    function setBet(playerId, amount) {
        const player = getSeatByPlayerId(playerId);
        if (!player) return { ok: false };
        if (amount < MIN_BET || amount > MAX_BET) return { ok: false };
        if (amount > player.balance) return { ok: false };
        player.bet = amount;
        return { ok: true };
    }

    function deal(requesterId) {
        const players = getActivePlayers();
        if (players.length < 2) return { ok: false, error: 'Cần ít nhất 2 người chơi' };
        if (state !== GAME_STATE.LOBBY && state !== GAME_STATE.RESULTS) return { ok: false, error: 'Không thể chia bài lúc này' };

        // Keep existing host (persistent host)
        roundNumber++;

        // Reset
        players.forEach(p => {
            p.cards = [];
            p.hasStayed = false;
            p.isChecked = false;
            p.result = null;
            p.payout = 0;
        });

        state = GAME_STATE.DEALING;

        // Deal 2 cards
        for (let round = 0; round < 2; round++) {
            for (const player of players) {
                player.cards.push(shoe.deal());
            }
        }

        // Check naturals
        players.forEach(p => {
            const hand = classifyHand(p.cards);
            if (hand.type === HAND_TYPE.XI_BANG || hand.type === HAND_TYPE.XI_DACH) {
                p.hasStayed = true;
            }
        });

        state = GAME_STATE.PLAYER_TURNS;

        // Set first turn: rightmost non-host player (right-to-left order)
        const nonHost = getActiveNonHostPlayers();
        if (nonHost.every(p => p.hasStayed)) {
            currentTurnSeatIndex = -1;
            state = GAME_STATE.HOST_TURN;
        } else {
            currentTurnSeatIndex = getFirstTurnSeatIndex();
        }

        return { ok: true };
    }

    // Get first turn seat: rightmost non-host non-stayed player
    function getFirstTurnSeatIndex() {
        for (let i = MAX_SEATS - 1; i >= 0; i--) {
            if (seats[i] && !seats[i].isHost && !seats[i].hasStayed) {
                return i;
            }
        }
        return -1;
    }

    // Get next turn: right-to-left, skip host and stayed players
    function getNextTurnSeatIndex(currentSeat) {
        for (let i = currentSeat - 1; i >= 0; i--) {
            if (seats[i] && !seats[i].isHost && !seats[i].hasStayed) {
                return i;
            }
        }
        // Wrap around from the right
        for (let i = MAX_SEATS - 1; i > currentSeat; i--) {
            if (seats[i] && !seats[i].isHost && !seats[i].hasStayed) {
                return i;
            }
        }
        return -1; // No more players
    }

    function advanceTurn() {
        const next = getNextTurnSeatIndex(currentTurnSeatIndex);
        if (next === -1) {
            // All non-host players done
            currentTurnSeatIndex = -1;
            state = GAME_STATE.HOST_TURN;
        } else {
            currentTurnSeatIndex = next;
        }
    }

    function hit(playerId) {
        const player = getSeatByPlayerId(playerId);
        if (!player || player.hasStayed) return { ok: false };
        if (state === GAME_STATE.PLAYER_TURNS && player.isHost) return { ok: false };
        if (state === GAME_STATE.PLAYER_TURNS && player.seatIndex !== currentTurnSeatIndex) return { ok: false, error: 'Chưa đến lượt bạn' };
        if (state === GAME_STATE.HOST_TURN && !player.isHost) return { ok: false };
        if (!canHit(player.cards)) return { ok: false };

        player.cards.push(shoe.deal());

        const hand = classifyHand(player.cards);
        let autoStayed = false;
        if (hand.type === HAND_TYPE.BUSTED || !canHit(player.cards)) {
            player.hasStayed = true;
            autoStayed = true;
        }

        // Advance turn if player finished
        if (state === GAME_STATE.PLAYER_TURNS && autoStayed) {
            advanceTurn();
        }

        if (state === GAME_STATE.HOST_TURN && player.isHost && hand.type === HAND_TYPE.BUSTED) {
            resolveAllUnchecked();
        }

        return { ok: true, autoStayed };
    }

    function stay(playerId) {
        const player = getSeatByPlayerId(playerId);
        if (!player || player.hasStayed) return { ok: false };
        if (state === GAME_STATE.PLAYER_TURNS && player.isHost) return { ok: false };
        if (state === GAME_STATE.PLAYER_TURNS && player.seatIndex !== currentTurnSeatIndex) return { ok: false, error: 'Chưa đến lượt bạn' };

        const score = getBestScore(player.cards);
        if (score < MIN_VALID_SCORE && player.cards.length < 5) {
            return { ok: false, error: 'Cần ít nhất 16 điểm để dừng' };
        }

        player.hasStayed = true;

        // Advance to next player
        if (state === GAME_STATE.PLAYER_TURNS) {
            advanceTurn();
        }

        return { ok: true };
    }

    function hostCanCheck(host) {
        const hostScore = getBestScore(host.cards);
        // Host with 15+ and exactly 2 cards can check
        if (host.cards.length === 2 && hostScore >= 15) return true;
        // Otherwise need 16+
        if (hostScore >= MIN_VALID_SCORE) return true;
        // Or 5 cards (Ngũ Linh)
        if (host.cards.length >= 5) return true;
        return false;
    }

    function hostCheck(playerId, targetSeatIndex) {
        if (state !== GAME_STATE.HOST_TURN) return { ok: false };
        const host = getHost();
        if (!host || host.id !== playerId) return { ok: false, error: 'Bạn không phải nhà cái' };

        if (!hostCanCheck(host)) {
            return { ok: false, error: 'Nhà cái chưa đủ điểm để xét bài' };
        }

        const target = seats[targetSeatIndex];
        if (!target || target.isHost || target.isChecked) return { ok: false };

        const targetHand = classifyHand(target.cards);
        target.isChecked = true;

        // PENALTY: player under 16 without Ngũ Linh pays penalty
        if (targetHand.type === HAND_TYPE.INVALID) {
            // Pay each other player's bet to host
            const allBets = getActiveNonHostPlayers().reduce((sum, p) => sum + p.bet, 0);
            target.result = 'lose';
            target.payout = -allBets;
            target.balance -= allBets;
            host.balance += allBets;
        } else {
            // Normal payout
            const multiplier = getPayoutMultiplier(target.cards, host.cards);
            if (multiplier > 0) {
                target.result = 'win';
                target.payout = target.bet * multiplier;
                target.balance += target.payout;
                host.balance -= target.payout;
            } else if (multiplier < 0) {
                target.result = 'lose';
                target.payout = target.bet * multiplier;
                target.balance += target.payout;
                host.balance -= target.payout;
            } else {
                target.result = 'tie';
                target.payout = 0;
            }
        }

        const unchecked = getActiveNonHostPlayers().filter(p => !p.isChecked);
        let roundFinished = false;
        if (unchecked.length === 0) {
            finishRound();
            roundFinished = true;
        }

        return { ok: true, roundFinished };
    }

    function resolveAllUnchecked() {
        const host = getHost();
        if (!host) return;
        const allBets = getActiveNonHostPlayers().reduce((sum, p) => sum + p.bet, 0);
        const unchecked = getActiveNonHostPlayers().filter(p => !p.isChecked);
        unchecked.forEach(p => {
            const hand = classifyHand(p.cards);
            p.isChecked = true;

            // PENALTY: player under 16 without Ngũ Linh
            if (hand.type === HAND_TYPE.INVALID) {
                p.result = 'lose';
                p.payout = -allBets;
                p.balance -= allBets;
                host.balance += allBets;
            } else {
                const multiplier = getPayoutMultiplier(p.cards, host.cards);
                if (multiplier > 0) {
                    p.result = 'win';
                    p.payout = p.bet * multiplier;
                    p.balance += p.payout;
                    host.balance -= p.payout;
                } else if (multiplier < 0) {
                    p.result = 'lose';
                    p.payout = p.bet * multiplier;
                    p.balance += p.payout;
                    host.balance -= p.payout;
                } else {
                    p.result = 'tie';
                    p.payout = 0;
                }
            }
        });
        finishRound();
    }

    function finishRound() {
        const host = getHost();
        if (host) host.result = 'host';
        state = GAME_STATE.RESULTS;

        // Remove bankrupt
        getActivePlayers().forEach(p => {
            if (p.balance <= 0) seats[p.seatIndex] = null;
        });
    }

    // Disconnect handling
    function playerDisconnected(playerId) {
        const player = getSeatByPlayerId(playerId);
        if (player) {
            player.connected = false;
            // If in active game and it's their turn, auto-action after short delay
        }
    }

    function playerReconnected(playerId) {
        const player = getSeatByPlayerId(playerId);
        if (player) {
            player.connected = true;
        }
    }

    function removePlayer(playerId) {
        const player = getSeatByPlayerId(playerId);
        if (player) {
            const wasHost = player.isHost;
            seats[player.seatIndex] = null;
            if (wasHost) {
                autoAssignHost();
            }
        }
    }

    // Auto-assign host to first available player
    function autoAssignHost() {
        const remaining = getActivePlayers();
        if (remaining.length > 0) {
            remaining.forEach(p => p.isHost = false);
            remaining[0].isHost = true;
            hostSeatIndex = remaining[0].seatIndex;
        } else {
            hostSeatIndex = -1;
        }
    }

    // Transfer host to another player
    function transferHost(requesterId, targetSeatIndex) {
        if (state !== GAME_STATE.LOBBY && state !== GAME_STATE.RESULTS) {
            return { ok: false, error: 'Chỉ nhường cái khi chưa chơi' };
        }
        const requester = getSeatByPlayerId(requesterId);
        if (!requester || !requester.isHost) {
            return { ok: false, error: 'Bạn không phải nhà cái' };
        }
        const target = seats[targetSeatIndex];
        if (!target || target.id === requesterId) {
            return { ok: false, error: 'Người chơi không hợp lệ' };
        }
        requester.isHost = false;
        target.isHost = true;
        hostSeatIndex = target.seatIndex;
        return { ok: true };
    }

    // Timer
    function startTurnTimer(onExpire) {
        clearTurnTimer();
        turnTimeLeft = TURN_TIME;
        turnTimer = setInterval(() => {
            turnTimeLeft--;
            if (turnTimeLeft <= 0) {
                clearTurnTimer();
                if (onExpire) onExpire();
            }
        }, 1000);
    }

    function clearTurnTimer() {
        if (turnTimer) {
            clearInterval(turnTimer);
            turnTimer = null;
        }
    }

    function getTurnTimeLeft() {
        return turnTimeLeft;
    }

    return {
        get state() { return state; },
        get seats() { return seats; },
        get hostSeatIndex() { return hostSeatIndex; },
        get roundNumber() { return roundNumber; },
        getActivePlayers,
        getActiveNonHostPlayers,
        getHost,
        getSeatByPlayerId,
        serializeForPlayer,
        sit,
        leaveSeat,
        setBet,
        deal,
        hit,
        stay,
        hostCheck,
        checkAll(playerId) {
            if (state !== GAME_STATE.HOST_TURN) return { ok: false };
            const host = getHost();
            if (!host || host.id !== playerId) return { ok: false, error: 'Bạn không phải nhà cái' };
            if (!hostCanCheck(host)) {
                return { ok: false, error: 'Nhà cái chưa đủ điểm để xét bài' };
            }
            resolveAllUnchecked();
            return { ok: true };
        },
        resolveAllUnchecked,
        transferHost,
        playerDisconnected,
        playerReconnected,
        removePlayer,
        startTurnTimer,
        clearTurnTimer,
        getTurnTimeLeft,
    };
}
