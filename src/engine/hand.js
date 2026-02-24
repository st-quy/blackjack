import {
    RANK_VALUES, HAND_TYPE, HAND_TYPE_RANK,
    BLACKJACK_SCORE, MIN_VALID_SCORE, NGU_LINH_CARDS
} from './constants.js';

/**
 * Get all possible scores for a hand, considering Ace flexibility (1, 10, or 11)
 */
function getPossibleScores(cards) {
    let scores = [0];

    for (const card of cards) {
        const values = Array.isArray(RANK_VALUES[card.rank])
            ? RANK_VALUES[card.rank]
            : [RANK_VALUES[card.rank]];

        const newScores = [];
        for (const score of scores) {
            for (const val of values) {
                newScores.push(score + val);
            }
        }
        scores = newScores;
    }

    // Remove duplicates
    return [...new Set(scores)].sort((a, b) => a - b);
}

/**
 * Get the best score for a hand (closest to 21 without going over)
 */
export function getBestScore(cards) {
    const scores = getPossibleScores(cards);

    // Find best score ≤ 21
    const validScores = scores.filter(s => s <= BLACKJACK_SCORE);
    if (validScores.length > 0) {
        return Math.max(...validScores);
    }

    // All scores bust - return the lowest (least bad)
    return Math.min(...scores);
}

/**
 * Check if hand is Xì Bàng (2 Aces)
 */
export function isXiBang(cards) {
    return cards.length === 2 && cards[0].rank === 'A' && cards[1].rank === 'A';
}

/**
 * Check if hand is Xì Dách (1 Ace + one 10-value card)
 */
export function isXiDach(cards) {
    if (cards.length !== 2) return false;
    const hasAce = cards.some(c => c.rank === 'A');
    const hasTenValue = cards.some(c => ['10', 'J', 'Q', 'K'].includes(c.rank));
    return hasAce && hasTenValue;
}

/**
 * Check if hand is Ngũ Linh (5 cards, total ≤ 21)
 */
export function isNguLinh(cards) {
    if (cards.length !== NGU_LINH_CARDS) return false;
    const bestScore = getBestScore(cards);
    return bestScore <= BLACKJACK_SCORE;
}

/**
 * Classify a hand into its type
 */
export function classifyHand(cards) {
    if (cards.length === 0) return { type: HAND_TYPE.INVALID, score: 0 };

    if (isXiBang(cards)) {
        return { type: HAND_TYPE.XI_BANG, score: 22 }; // Best possible
    }

    if (isXiDach(cards)) {
        return { type: HAND_TYPE.XI_DACH, score: 21 };
    }

    const bestScore = getBestScore(cards);

    if (isNguLinh(cards)) {
        return { type: HAND_TYPE.NGU_LINH, score: bestScore };
    }

    if (bestScore > BLACKJACK_SCORE) {
        return { type: HAND_TYPE.BUSTED, score: bestScore };
    }

    if (bestScore < MIN_VALID_SCORE) {
        return { type: HAND_TYPE.INVALID, score: bestScore };
    }

    return { type: HAND_TYPE.NORMAL, score: bestScore };
}

/**
 * Compare two hands. Returns:
 *   negative if hand1 loses to hand2
 *   0 if tie
 *   positive if hand1 beats hand2
 */
export function compareHands(cards1, cards2) {
    const h1 = classifyHand(cards1);
    const h2 = classifyHand(cards2);

    const rank1 = HAND_TYPE_RANK[h1.type];
    const rank2 = HAND_TYPE_RANK[h2.type];

    // Different hand types: lower rank = better
    if (rank1 !== rank2) {
        return rank2 - rank1; // positive if h1 is better
    }

    // Same hand type
    switch (h1.type) {
        case HAND_TYPE.XI_BANG:
            return 0; // Both have Xì Bàng = tie
        case HAND_TYPE.XI_DACH:
            return 0; // Both have Xì Dách = tie
        case HAND_TYPE.NGU_LINH:
            // Lower score is better for Ngũ Linh
            return h2.score - h1.score;
        case HAND_TYPE.NORMAL:
            // Higher score is better
            return h1.score - h2.score;
        case HAND_TYPE.BUSTED:
            return 0; // Both busted = tie (both lose)
        case HAND_TYPE.INVALID:
            return 0; // Both invalid = tie (both lose)
        default:
            return 0;
    }
}

/**
 * Check if a player can hit (take another card)
 */
export function canHit(cards) {
    if (cards.length >= NGU_LINH_CARDS) return false;
    const bestScore = getBestScore(cards);
    if (bestScore > BLACKJACK_SCORE) return false;
    // Check for natural hands (Xì Bàng, Xì Dách)
    if (isXiBang(cards) || isXiDach(cards)) return false;
    return true;
}

/**
 * Check if a player must stay (can't hit anymore)
 */
export function mustStay(cards) {
    return !canHit(cards);
}

/**
 * Get display name for hand type
 */
export function getHandTypeName(type) {
    const names = {
        [HAND_TYPE.XI_BANG]: 'Xì Bàng',
        [HAND_TYPE.XI_DACH]: 'Xì Dách',
        [HAND_TYPE.NGU_LINH]: 'Ngũ Linh',
        [HAND_TYPE.NORMAL]: 'Bình thường',
        [HAND_TYPE.BUSTED]: 'Quắc!',
        [HAND_TYPE.INVALID]: 'Không hợp lệ',
    };
    return names[type] || type;
}

/**
 * Get payout multiplier based on hand comparison
 * Returns multiplier for the player's bet
 * Positive = player wins, Negative = player loses
 */
export function getPayoutMultiplier(playerCards, hostCards) {
    const playerHand = classifyHand(playerCards);
    const hostHand = classifyHand(hostCards);

    // Player has invalid hand or busted - always loses
    if (playerHand.type === HAND_TYPE.INVALID || playerHand.type === HAND_TYPE.BUSTED) {
        // If host also busted/invalid, it depends on who busted
        // But per rules, invalid = auto lose
        if (playerHand.type === HAND_TYPE.INVALID) return -1;
        if (hostHand.type === HAND_TYPE.BUSTED || hostHand.type === HAND_TYPE.INVALID) return 0;
        return -1;
    }

    // Host has invalid hand
    if (hostHand.type === HAND_TYPE.INVALID) {
        return 1;
    }

    const comparison = compareHands(playerCards, hostCards);

    if (comparison > 0) {
        // Player wins
        // Special hands pay double
        if (playerHand.type === HAND_TYPE.XI_BANG) return 2;
        if (playerHand.type === HAND_TYPE.XI_DACH) return 2;
        return 1;
    } else if (comparison < 0) {
        // Player loses
        if (hostHand.type === HAND_TYPE.XI_BANG) return -2;
        if (hostHand.type === HAND_TYPE.XI_DACH) return -2;
        return -1;
    }

    return 0; // Tie
}
