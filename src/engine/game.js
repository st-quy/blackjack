import { createShoe } from './deck.js';
import {
    classifyHand, getBestScore, canHit, compareHands,
    getPayoutMultiplier, getHandTypeName
} from './hand.js';
import {
    GAME_STATE, PLAYER_TYPE, MAX_SEATS, STARTING_BALANCE,
    MIN_BET, MAX_BET, BET_OPTIONS, HAND_TYPE, ANIM, AI_NAMES,
    MIN_VALID_SCORE, BLACKJACK_SCORE
} from './constants.js';
import { aiDecideHit, aiHostDecideHit, aiChooseBet, getRandomPersonality } from '../ai/player.js';

/**
 * Create a new player object
 */
function createPlayer(name, type, seatIndex) {
    return {
        name,
        type,
        seatIndex,
        cards: [],
        bet: MIN_BET,
        balance: STARTING_BALANCE,
        isHost: false,
        hasStayed: false,
        isChecked: false,
        result: null, // 'win', 'lose', 'tie'
        payout: 0,
        personality: type === PLAYER_TYPE.AI ? getRandomPersonality() : null,
    };
}

/**
 * Create the main game
 */
export function createGame() {
    let state = GAME_STATE.LOBBY;
    let seats = new Array(MAX_SEATS).fill(null);
    let shoe = createShoe();
    let hostSeatIndex = -1;
    let currentPlayerIndex = -1;
    let roundNumber = 0;
    let listeners = [];
    let hostCheckIndex = -1;

    // Event system
    function emit(event, data) {
        listeners.forEach(fn => fn(event, data));
    }

    function on(fn) {
        listeners.push(fn);
        return () => { listeners = listeners.filter(l => l !== fn); };
    }

    // Get all active players (non-null seats)
    function getActivePlayers() {
        return seats.filter(s => s !== null);
    }

    function getActiveNonHostPlayers() {
        return seats.filter(s => s !== null && !s.isHost);
    }

    // Get the host player
    function getHost() {
        return seats.find(s => s !== null && s.isHost);
    }

    // Sit a player at a seat
    function sit(seatIndex, name, type = PLAYER_TYPE.HUMAN) {
        if (seatIndex < 0 || seatIndex >= MAX_SEATS) return false;
        if (seats[seatIndex] !== null) return false;
        if (state !== GAME_STATE.LOBBY && state !== GAME_STATE.RESULTS) return false;

        seats[seatIndex] = createPlayer(name, type, seatIndex);
        emit('playerSat', { seatIndex, player: seats[seatIndex] });
        return true;
    }

    // Leave a seat
    function leave(seatIndex) {
        if (seats[seatIndex] === null) return false;
        const player = seats[seatIndex];
        seats[seatIndex] = null;
        emit('playerLeft', { seatIndex, player });
        return true;
    }

    // Set bet for a player
    function setBet(seatIndex, amount) {
        const player = seats[seatIndex];
        if (!player) return false;
        if (amount < MIN_BET || amount > MAX_BET) return false;
        if (amount > player.balance) return false;
        player.bet = amount;
        emit('betChanged', { seatIndex, amount });
        return true;
    }

    // Assign host for the round
    function assignHost() {
        const players = getActivePlayers();
        if (players.length < 2) return false;

        // Reset all host flags
        players.forEach(p => p.isHost = false);

        // Rotate host
        roundNumber++;
        const hostPlayer = players[roundNumber % players.length];
        hostPlayer.isHost = true;
        hostSeatIndex = hostPlayer.seatIndex;
        emit('hostAssigned', { seatIndex: hostSeatIndex, player: hostPlayer });
        return true;
    }

    // Start dealing
    function deal() {
        const players = getActivePlayers();
        if (players.length < 2) {
            emit('error', { message: 'Cần ít nhất 2 người chơi' });
            return false;
        }

        if (state !== GAME_STATE.LOBBY && state !== GAME_STATE.RESULTS) {
            return false;
        }

        // Assign host
        assignHost();

        // Reset all players for new round
        players.forEach(p => {
            p.cards = [];
            p.hasStayed = false;
            p.isChecked = false;
            p.result = null;
            p.payout = 0;
        });

        // AI set bets
        players.forEach(p => {
            if (p.type === PLAYER_TYPE.AI && !p.isHost) {
                p.bet = aiChooseBet(p.balance, MIN_BET, MAX_BET);
            }
        });

        state = GAME_STATE.DEALING;
        emit('stateChanged', { state });

        // Deal 2 cards to each player
        // First card to everyone, then second card
        const dealOrder = [];
        for (let round = 0; round < 2; round++) {
            for (const player of players) {
                const card = shoe.deal();
                player.cards.push(card);
                dealOrder.push({ seatIndex: player.seatIndex, card, cardIndex: round });
            }
        }

        emit('cardsDealt', { dealOrder });

        // Check for natural hands (Xì Bàng, Xì Dách)
        players.forEach(p => {
            const hand = classifyHand(p.cards);
            if (hand.type === HAND_TYPE.XI_BANG || hand.type === HAND_TYPE.XI_DACH) {
                p.hasStayed = true;
            }
        });

        // Move to player turns
        state = GAME_STATE.PLAYER_TURNS;
        emit('stateChanged', { state });

        // Find first non-host player who can act
        startPlayerTurns();

        return true;
    }

    function startPlayerTurns() {
        const nonHostPlayers = getActiveNonHostPlayers();

        // Check if all non-host players must stay (e.g., all have naturals)
        const allStayed = nonHostPlayers.every(p => p.hasStayed);
        if (allStayed) {
            moveToHostTurn();
            return;
        }

        // Signal player turns started
        emit('playerTurnsStarted', {
            players: nonHostPlayers.map(p => ({
                seatIndex: p.seatIndex,
                name: p.name,
                canAct: !p.hasStayed
            }))
        });
    }

    // Player hits
    function hit(seatIndex) {
        const player = seats[seatIndex];
        if (!player || player.hasStayed) return false;

        if (state === GAME_STATE.PLAYER_TURNS && player.isHost) return false;
        if (state === GAME_STATE.HOST_TURN && !player.isHost) return false;

        if (!canHit(player.cards)) return false;

        const card = shoe.deal();
        player.cards.push(card);

        emit('cardDealt', { seatIndex, card, cardIndex: player.cards.length - 1 });

        // Check if busted or must stay
        const hand = classifyHand(player.cards);
        if (hand.type === HAND_TYPE.BUSTED || !canHit(player.cards)) {
            player.hasStayed = true;
            emit('playerAutoStayed', { seatIndex, reason: hand.type === HAND_TYPE.BUSTED ? 'busted' : 'maxCards' });

            if (state === GAME_STATE.HOST_TURN && player.isHost) {
                // Host busted - force check all remaining
                resolveAllUnchecked();
            }
        }

        return true;
    }

    // Player stays
    function stay(seatIndex) {
        const player = seats[seatIndex];
        if (!player || player.hasStayed) return false;

        if (state === GAME_STATE.PLAYER_TURNS && player.isHost) return false;

        const hand = classifyHand(player.cards);
        if (hand.type === HAND_TYPE.INVALID && hand.score < MIN_VALID_SCORE && player.cards.length < 5) {
            // Can't stay with less than 16 unless it's 5 cards
            emit('error', { message: 'Bạn cần ít nhất 16 điểm để dừng' });
            return false;
        }

        player.hasStayed = true;
        emit('playerStayed', { seatIndex });

        if (state === GAME_STATE.PLAYER_TURNS) {
            // Check if all non-host players have stayed
            const nonHostPlayers = getActiveNonHostPlayers();
            const allStayed = nonHostPlayers.every(p => p.hasStayed);
            if (allStayed) {
                moveToHostTurn();
            }
        }

        return true;
    }

    function moveToHostTurn() {
        state = GAME_STATE.HOST_TURN;
        emit('stateChanged', { state });
        emit('hostTurnStarted', { seatIndex: hostSeatIndex });
    }

    // Host checks a specific player
    function hostCheck(playerSeatIndex) {
        if (state !== GAME_STATE.HOST_TURN) return false;
        const host = getHost();
        if (!host) return false;

        const hostScore = getBestScore(host.cards);
        if (hostScore < MIN_VALID_SCORE && host.cards.length < 5) {
            emit('error', { message: 'Nhà cái cần ít nhất 16 điểm để xét bài' });
            return false;
        }

        const player = seats[playerSeatIndex];
        if (!player || player.isHost || player.isChecked) return false;

        // Determine result
        const multiplier = getPayoutMultiplier(player.cards, host.cards);
        player.isChecked = true;

        if (multiplier > 0) {
            player.result = 'win';
            player.payout = player.bet * multiplier;
            player.balance += player.payout;
            host.balance -= player.payout;
        } else if (multiplier < 0) {
            player.result = 'lose';
            player.payout = player.bet * multiplier;
            player.balance += player.payout; // negative
            host.balance -= player.payout; // host gains
        } else {
            player.result = 'tie';
            player.payout = 0;
        }

        emit('playerChecked', {
            playerSeat: playerSeatIndex,
            result: player.result,
            payout: player.payout,
            playerHand: classifyHand(player.cards),
            hostHand: classifyHand(host.cards),
        });

        // Check if all players checked
        const unchecked = getActiveNonHostPlayers().filter(p => !p.isChecked);
        if (unchecked.length === 0) {
            finishRound();
        }

        return true;
    }

    function resolveAllUnchecked() {
        const unchecked = getActiveNonHostPlayers().filter(p => !p.isChecked);
        unchecked.forEach(p => {
            hostCheck(p.seatIndex);
        });
    }

    function finishRound() {
        const host = getHost();
        host.result = 'host';

        state = GAME_STATE.RESULTS;
        emit('stateChanged', { state });
        emit('roundFinished', {
            players: getActivePlayers().map(p => ({
                seatIndex: p.seatIndex,
                name: p.name,
                cards: [...p.cards],
                hand: classifyHand(p.cards),
                result: p.result,
                payout: p.payout,
                balance: p.balance,
                isHost: p.isHost,
            }))
        });

        // Remove bankrupt players
        getActivePlayers().forEach(p => {
            if (p.balance <= 0) {
                emit('playerBankrupt', { seatIndex: p.seatIndex, name: p.name });
                seats[p.seatIndex] = null;
            }
        });
    }

    // Run AI turns for non-host AI players
    async function runAIPlayerTurns(onAction) {
        const aiPlayers = getActiveNonHostPlayers().filter(p => p.type === PLAYER_TYPE.AI && !p.hasStayed);

        for (const ai of aiPlayers) {
            while (!ai.hasStayed && canHit(ai.cards)) {
                await delay(ANIM.AI_THINK);
                const shouldHit = aiDecideHit(ai.cards, ai.personality);
                if (shouldHit) {
                    hit(ai.seatIndex);
                    if (onAction) onAction('hit', ai.seatIndex);
                } else {
                    const score = getBestScore(ai.cards);
                    if (score >= MIN_VALID_SCORE || ai.cards.length >= 5) {
                        stay(ai.seatIndex);
                        if (onAction) onAction('stay', ai.seatIndex);
                        break;
                    } else {
                        // Must hit, score is too low
                        hit(ai.seatIndex);
                        if (onAction) onAction('hit', ai.seatIndex);
                    }
                }
            }
            // If AI hasn't stayed yet but can't hit, auto-stay
            if (!ai.hasStayed) {
                stay(ai.seatIndex);
                if (onAction) onAction('stay', ai.seatIndex);
            }
        }
    }

    // Run AI host turn
    async function runAIHostTurn(onAction) {
        const host = getHost();
        if (!host || host.type !== PLAYER_TYPE.AI) return;

        // Host hits until satisfied
        while (canHit(host.cards)) {
            await delay(ANIM.AI_THINK);
            const shouldHit = aiHostDecideHit(host.cards);
            if (shouldHit) {
                hit(hostSeatIndex);
                if (onAction) onAction('hit', hostSeatIndex);
            } else {
                break;
            }
        }

        host.hasStayed = true;

        // Host checks all players
        const unchecked = getActiveNonHostPlayers().filter(p => !p.isChecked);
        for (const player of unchecked) {
            await delay(ANIM.BETWEEN_ACTIONS);
            hostCheck(player.seatIndex);
            if (onAction) onAction('check', player.seatIndex);
        }
    }

    // Expose game API
    return {
        on,
        get state() { return state; },
        get seats() { return [...seats]; },
        get hostSeatIndex() { return hostSeatIndex; },
        get roundNumber() { return roundNumber; },
        getActivePlayers,
        getActiveNonHostPlayers,
        getHost,
        sit,
        leave,
        setBet,
        deal,
        hit,
        stay,
        hostCheck,
        runAIPlayerTurns,
        runAIHostTurn,
        resolveAllUnchecked,

        // Utilities
        getPlayerHand(seatIndex) {
            const p = seats[seatIndex];
            return p ? classifyHand(p.cards) : null;
        },
        getPlayerScore(seatIndex) {
            const p = seats[seatIndex];
            return p ? getBestScore(p.cards) : 0;
        },
        canPlayerHit(seatIndex) {
            const p = seats[seatIndex];
            return p ? canHit(p.cards) : false;
        },
        canPlayerStay(seatIndex) {
            const p = seats[seatIndex];
            if (!p || p.hasStayed) return false;
            const score = getBestScore(p.cards);
            return score >= MIN_VALID_SCORE || p.cards.length >= 5;
        },
        canHostCheck() {
            const host = getHost();
            if (!host) return false;
            const score = getBestScore(host.cards);
            return score >= MIN_VALID_SCORE || host.cards.length >= 5;
        }
    };
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
