import {
    AI_PERSONALITY, MIN_VALID_SCORE, BLACKJACK_SCORE, ANIM
} from '../engine/constants.js';
import { getBestScore, classifyHand, canHit } from '../engine/hand.js';

/**
 * AI Player decision logic
 */

/**
 * Decide whether AI should hit or stay
 */
export function aiDecideHit(cards, personality = AI_PERSONALITY.BALANCED) {
    const score = getBestScore(cards);
    const hand = classifyHand(cards);

    // Natural hands - never hit
    if (hand.type === 'XI_BANG' || hand.type === 'XI_DACH') return false;

    // Already busted - can't hit
    if (score > BLACKJACK_SCORE) return false;

    // Can't hit with 5 cards
    if (cards.length >= 5) return false;

    // Must hit if under 16 (invalid hand)
    if (score < MIN_VALID_SCORE) return true;

    // Strategy based on personality
    const thresholds = {
        [AI_PERSONALITY.CONSERVATIVE]: 17,
        [AI_PERSONALITY.BALANCED]: 18,
        [AI_PERSONALITY.AGGRESSIVE]: 19,
    };

    const threshold = thresholds[personality] || 18;

    // Below threshold: hit with some randomness
    if (score < threshold) {
        // Higher chance to hit the further from threshold
        const diff = threshold - score;
        const hitChance = Math.min(0.9, 0.3 + diff * 0.2);
        return Math.random() < hitChance;
    }

    // At or above threshold: small chance to hit for aggressive
    if (personality === AI_PERSONALITY.AGGRESSIVE && score <= 19) {
        return Math.random() < 0.15;
    }

    return false;
}

/**
 * AI host decides whether to hit
 */
export function aiHostDecideHit(cards) {
    const score = getBestScore(cards);

    if (score > BLACKJACK_SCORE) return false;
    if (cards.length >= 5) return false;

    // Must reach at least 16
    if (score < MIN_VALID_SCORE) return true;

    // Host hits on 16, stays on 17+
    if (score < 17) return true;

    // Small chance to hit on 17
    if (score === 17) return Math.random() < 0.3;

    return false;
}

/**
 * Get a random AI personality
 */
export function getRandomPersonality() {
    const personalities = Object.values(AI_PERSONALITY);
    return personalities[Math.floor(Math.random() * personalities.length)];
}

/**
 * Get AI bet amount based on balance
 */
export function aiChooseBet(balance, minBet, maxBet) {
    // AI bets between min and a percentage of balance
    const maxAffordable = Math.min(maxBet, Math.floor(balance * 0.2));
    const bet = Math.max(minBet, Math.floor(Math.random() * maxAffordable / 100) * 100);
    return Math.min(bet, balance);
}
