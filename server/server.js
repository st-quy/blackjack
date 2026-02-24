import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import path from 'path';
import { createRoom, getRoom, listRooms, deleteRoom, ensureDefaultRooms } from './roomManager.js';
import { GAME_STATE } from '../src/engine/constants.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
    },
});

const PORT = process.env.PORT || 3001;

// Ensure default rooms
ensureDefaultRooms();

// Track which room each socket is in
const socketRooms = new Map(); // socketId -> roomId
const socketNames = new Map(); // socketId -> playerName

function broadcastGameState(roomId) {
    const room = getRoom(roomId);
    if (!room) return;

    for (const [socketId, playerInfo] of room.players) {
        const socket = io.sockets.sockets.get(socketId);
        if (socket) {
            socket.emit('game-state', room.game.serializeForPlayer(socketId));
        }
    }
}

function broadcastRoomList() {
    io.emit('room-list', listRooms());
}

function startTurnTimerForRoom(roomId) {
    const room = getRoom(roomId);
    if (!room) return;

    room.game.startTurnTimer(() => {
        // Timer expired - auto action
        const game = room.game;
        if (game.state === GAME_STATE.PLAYER_TURNS) {
            const nonHost = game.getActiveNonHostPlayers().filter(p => !p.hasStayed);
            for (const p of nonHost) {
                // Try stay first, if can't (score < 16), force hit
                const stayResult = game.stay(p.id);
                if (!stayResult.ok) {
                    game.hit(p.id);
                }
            }
        } else if (game.state === GAME_STATE.HOST_TURN) {
            game.resolveAllUnchecked();
        }
        broadcastGameState(roomId);
        broadcastRoomList();
    });

    // Broadcast timer ticks
    const tickInterval = setInterval(() => {
        const r = getRoom(roomId);
        if (!r || r.game.state === GAME_STATE.RESULTS || r.game.state === GAME_STATE.LOBBY) {
            clearInterval(tickInterval);
            return;
        }
        io.to(roomId).emit('timer-tick', r.game.getTurnTimeLeft());
    }, 1000);
}

io.on('connection', (socket) => {
    console.log(`[+] Connected: ${socket.id}`);

    // Send room list on connect
    socket.emit('room-list', listRooms());

    // --- Room Events ---

    socket.on('list-rooms', () => {
        socket.emit('room-list', listRooms());
    });

    socket.on('create-room', (data) => {
        const room = createRoom(data?.name);
        broadcastRoomList();
        socket.emit('room-created', { id: room.id, name: room.name });
    });

    socket.on('join-room', (data) => {
        const { roomId, playerName } = data;
        const room = getRoom(roomId);
        if (!room) {
            socket.emit('error-msg', { message: 'Phòng không tồn tại' });
            return;
        }

        // Leave previous room
        const prevRoomId = socketRooms.get(socket.id);
        if (prevRoomId) {
            leaveRoom(socket, prevRoomId);
        }

        // Join new room
        socket.join(roomId);
        socketRooms.set(socket.id, roomId);
        socketNames.set(socket.id, playerName || 'Khách');
        room.players.set(socket.id, { id: socket.id, name: playerName || 'Khách' });

        // Try to reconnect if player was previously in this room
        room.game.playerReconnected(socket.id);

        socket.emit('joined-room', { roomId, roomName: room.name });
        broadcastGameState(roomId);
        broadcastRoomList();
    });

    socket.on('leave-room', () => {
        const roomId = socketRooms.get(socket.id);
        if (roomId) {
            leaveRoom(socket, roomId);
            broadcastRoomList();
        }
    });

    // --- Game Events ---

    socket.on('sit', (data) => {
        const roomId = socketRooms.get(socket.id);
        const room = getRoom(roomId);
        if (!room) return;

        const name = socketNames.get(socket.id) || 'Khách';
        const result = room.game.sit(socket.id, name, data.seatIndex);
        if (!result.ok) {
            socket.emit('error-msg', { message: result.error });
            return;
        }
        broadcastGameState(roomId);
        broadcastRoomList();
    });

    socket.on('leave-seat', () => {
        const roomId = socketRooms.get(socket.id);
        const room = getRoom(roomId);
        if (!room) return;

        room.game.leaveSeat(socket.id);
        broadcastGameState(roomId);
        broadcastRoomList();
    });

    socket.on('set-bet', (data) => {
        const roomId = socketRooms.get(socket.id);
        const room = getRoom(roomId);
        if (!room) return;

        room.game.setBet(socket.id, data.amount);
        broadcastGameState(roomId);
    });

    socket.on('deal', () => {
        const roomId = socketRooms.get(socket.id);
        const room = getRoom(roomId);
        if (!room) return;

        const result = room.game.deal(socket.id);
        if (!result.ok) {
            socket.emit('error-msg', { message: result.error });
            return;
        }
        broadcastGameState(roomId);
        broadcastRoomList();

        // Start turn timer
        if (room.game.state === GAME_STATE.PLAYER_TURNS || room.game.state === GAME_STATE.HOST_TURN) {
            startTurnTimerForRoom(roomId);
        }
    });

    socket.on('hit', () => {
        const roomId = socketRooms.get(socket.id);
        const room = getRoom(roomId);
        if (!room) return;

        const prevState = room.game.state;
        const result = room.game.hit(socket.id);
        if (!result.ok) {
            socket.emit('error-msg', { message: 'Không thể bốc bài' });
            return;
        }

        // Reset timer on action
        if (room.game.state === GAME_STATE.PLAYER_TURNS || room.game.state === GAME_STATE.HOST_TURN) {
            startTurnTimerForRoom(roomId);
        }

        broadcastGameState(roomId);
        if (room.game.state !== prevState) broadcastRoomList();
    });

    socket.on('stay', () => {
        const roomId = socketRooms.get(socket.id);
        const room = getRoom(roomId);
        if (!room) return;

        const prevState = room.game.state;
        const result = room.game.stay(socket.id);
        if (!result.ok) {
            socket.emit('error-msg', { message: result.error || 'Không thể dừng' });
            return;
        }

        // Reset timer if state changed
        if (room.game.state !== prevState) {
            room.game.clearTurnTimer();
            if (room.game.state === GAME_STATE.HOST_TURN) {
                startTurnTimerForRoom(roomId);
            }
        }

        broadcastGameState(roomId);
        if (room.game.state !== prevState) broadcastRoomList();
    });

    socket.on('host-check', (data) => {
        const roomId = socketRooms.get(socket.id);
        const room = getRoom(roomId);
        if (!room) return;

        const result = room.game.hostCheck(socket.id, data.targetSeatIndex);
        if (!result.ok) {
            socket.emit('error-msg', { message: result.error || 'Không thể xét bài' });
            return;
        }

        broadcastGameState(roomId);
        if (result.roundFinished) {
            room.game.clearTurnTimer();
            broadcastRoomList();
        }
    });

    socket.on('transfer-host', (data) => {
        const roomId = socketRooms.get(socket.id);
        const room = getRoom(roomId);
        if (!room) return;

        const result = room.game.transferHost(socket.id, data.targetSeatIndex);
        if (!result.ok) {
            socket.emit('error-msg', { message: result.error });
            return;
        }
        broadcastGameState(roomId);
    });

    // --- Disconnect ---
    socket.on('disconnect', () => {
        console.log(`[-] Disconnected: ${socket.id}`);
        const roomId = socketRooms.get(socket.id);
        if (roomId) {
            leaveRoom(socket, roomId);
            broadcastRoomList();
        }
        socketNames.delete(socket.id);
    });
});

function leaveRoom(socket, roomId) {
    const room = getRoom(roomId);
    if (room) {
        room.players.delete(socket.id);
        room.game.removePlayer(socket.id);
        socket.leave(roomId);

        if (room.players.size === 0) {
            // Keep room alive for a bit, cleanup will handle it
        } else {
            broadcastGameState(roomId);
        }
    }
    socketRooms.delete(socket.id);
}

// Serve Vite build output in production
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));
app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
});

httpServer.listen(PORT, () => {
    console.log(`🃏 Xì Dách Server running on http://localhost:${PORT}`);
    console.log(`   ${listRooms().length} rooms ready`);
});
