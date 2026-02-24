import { createServerGame } from './gameManager.js';
import { MAX_SEATS } from '../src/engine/constants.js';

const rooms = new Map();
let roomIdCounter = 1;

export function createRoom(name) {
    const id = `room-${roomIdCounter++}`;
    const room = {
        id,
        name: name || `Bàn ${roomIdCounter - 1}`,
        game: createServerGame(id),
        players: new Map(), // socketId -> { id, name }
        createdAt: Date.now(),
    };
    rooms.set(id, room);
    return room;
}

export function getRoom(roomId) {
    return rooms.get(roomId);
}

export function listRooms() {
    const list = [];
    for (const [id, room] of rooms) {
        const activePlayers = room.game.getActivePlayers();
        const totalConnected = room.players.size;
        list.push({
            id,
            name: room.name,
            playerCount: activePlayers.length,
            observerCount: totalConnected - activePlayers.length,
            maxSeats: MAX_SEATS,
            state: room.game.state,
        });
    }
    return list;
}

export function deleteRoom(roomId) {
    const room = rooms.get(roomId);
    if (room) {
        room.game.clearTurnTimer();
        rooms.delete(roomId);
    }
}

export function cleanupEmptyRooms() {
    for (const [id, room] of rooms) {
        if (room.players.size === 0 && Date.now() - room.createdAt > 60000) {
            deleteRoom(id);
        }
    }
}

// Auto-cleanup every 30 seconds
setInterval(cleanupEmptyRooms, 30000);

// Ensure at least one room exists
export function ensureDefaultRooms() {
    if (rooms.size === 0) {
        createRoom('Bàn 1');
        createRoom('Bàn 2');
        createRoom('Bàn 3');
    }
}
