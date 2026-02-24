import { SUIT_COLORS } from '../engine/constants.js';

/**
 * Create a card DOM element
 * @param {object} card - { suit, rank }
 * @param {boolean} faceUp - show face or back
 * @param {boolean} small - smaller card size
 * @param {boolean} animate - deal animation
 */
export function createCardElement(card, faceUp = true, small = false, animate = false) {
    const container = document.createElement('div');
    container.className = 'card-container';

    const cardEl = document.createElement('div');
    cardEl.className = `card${small ? ' small' : ''}${faceUp ? ' flipped' : ''}${animate ? ' card-deal' : ''}`;
    cardEl.dataset.cardId = card.id;

    // Front face
    const front = document.createElement('div');
    const color = SUIT_COLORS[card.suit];
    front.className = `card-face card-front ${color}`;

    const rankTop = document.createElement('div');
    rankTop.className = 'card-rank';
    rankTop.textContent = card.rank;

    const suitTop = document.createElement('div');
    suitTop.className = 'card-suit-top';
    suitTop.textContent = card.suit;

    const centerSuit = document.createElement('div');
    centerSuit.className = 'card-center-suit';
    centerSuit.textContent = card.suit;

    front.appendChild(rankTop);
    front.appendChild(suitTop);
    front.appendChild(centerSuit);

    // Back face
    const back = document.createElement('div');
    back.className = 'card-face card-back';

    cardEl.appendChild(front);
    cardEl.appendChild(back);
    container.appendChild(cardEl);

    return container;
}

/**
 * Flip a card to show/hide face
 */
export function flipCard(cardContainer, faceUp) {
    const card = cardContainer.querySelector('.card');
    if (faceUp) {
        card.classList.add('flipped');
    } else {
        card.classList.remove('flipped');
    }
}

/**
 * Render a hand of cards
 */
export function renderHand(cards, faceUp = true, small = false, animate = false) {
    const hand = document.createElement('div');
    hand.className = `cards-hand${cards.length > 4 ? ' compact' : ''}`;

    cards.forEach((card, i) => {
        const el = createCardElement(card, faceUp, small, animate);
        if (animate) {
            el.style.animationDelay = `${i * 100}ms`;
        }
        hand.appendChild(el);
    });

    return hand;
}
