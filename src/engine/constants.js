// === Suits & Ranks ===
export const SUITS = ['♠', '♥', '♦', '♣'];
export const SUIT_NAMES = { '♠': 'spades', '♥': 'hearts', '♦': 'diamonds', '♣': 'clubs' };
export const SUIT_COLORS = { '♠': 'black', '♥': 'red', '♦': 'red', '♣': 'black' };
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

// === Card Values ===
export const RANK_VALUES = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
  'J': 10, 'Q': 10, 'K': 10,
  'A': [1, 10, 11] // Ace can be 1, 10, or 11
};

// === Hand Types (ranked from best to worst) ===
export const HAND_TYPE = {
  XI_BANG: 'XI_BANG',       // 2 Aces - best
  XI_DACH: 'XI_DACH',       // Ace + 10/J/Q/K - second
  NGU_LINH: 'NGU_LINH',     // 5 cards, total ≤ 21 - third
  NORMAL: 'NORMAL',         // 16-21 points - fourth
  BUSTED: 'BUSTED',         // Over 21
  INVALID: 'INVALID',       // Under 16 (not Ngũ Linh)
};

// Hand type ranking (lower = better)
export const HAND_TYPE_RANK = {
  [HAND_TYPE.XI_BANG]: 1,
  [HAND_TYPE.XI_DACH]: 2,
  [HAND_TYPE.NGU_LINH]: 3,
  [HAND_TYPE.NORMAL]: 4,
  [HAND_TYPE.BUSTED]: 5,
  [HAND_TYPE.INVALID]: 6,
};

// === Game States ===
export const GAME_STATE = {
  LOBBY: 'LOBBY',             // Waiting for players
  BETTING: 'BETTING',         // Players placing bets
  DEALING: 'DEALING',         // Cards being dealt
  PLAYER_TURNS: 'PLAYER_TURNS', // Players deciding hit/stay
  HOST_TURN: 'HOST_TURN',     // Host hitting/checking
  RESULTS: 'RESULTS',         // Showing results
};

// === Player Types ===
export const PLAYER_TYPE = {
  HUMAN: 'HUMAN',
  AI: 'AI',
};

// === AI Personalities ===
export const AI_PERSONALITY = {
  CONSERVATIVE: 'CONSERVATIVE', // Stays early
  BALANCED: 'BALANCED',         // Standard strategy
  AGGRESSIVE: 'AGGRESSIVE',     // Hits more
};

// === Game Config ===
export const MAX_SEATS = 10;
export const STARTING_BALANCE = 10000;
export const MIN_BET = 100;
export const MAX_BET = 5000;
export const BET_OPTIONS = [100, 200, 500, 1000, 2000, 5000];
export const MIN_VALID_SCORE = 16;
export const BLACKJACK_SCORE = 21;
export const NGU_LINH_CARDS = 5;

// === AI Names ===
export const AI_NAMES = [
  'Minh', 'Hương', 'Tuấn', 'Linh', 'Đức',
  'Thảo', 'Phong', 'Mai', 'Khoa', 'Ngọc'
];

// === Animation Durations (ms) ===
export const ANIM = {
  CARD_DEAL: 400,
  CARD_FLIP: 500,
  RESULT_DELAY: 1000,
  AI_THINK: 800,
  BETWEEN_ACTIONS: 600,
};
