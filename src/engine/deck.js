import { SUITS, RANKS } from './constants.js';

/**
 * Create a standard 52-card deck
 */
export function createDeck() {
    const deck = [];
    for (const suit of SUITS) {
        for (const rank of RANKS) {
            deck.push({ suit, rank, id: `${rank}${suit}` });
        }
    }
    return deck;
}

/**
 * Fisher-Yates shuffle
 */
export function shuffle(deck) {
    const arr = [...deck];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

/**
 * Deck manager: creates and manages a shuffled deck
 */
export function createShoe() {
    let cards = shuffle(createDeck());
    let index = 0;

    return {
        deal() {
            if (index >= cards.length) {
                // Reshuffle if out of cards
                cards = shuffle(createDeck());
                index = 0;
            }
            return cards[index++];
        },
        remaining() {
            return cards.length - index;
        },
        reset() {
            cards = shuffle(createDeck());
            index = 0;
        }
    };
}
