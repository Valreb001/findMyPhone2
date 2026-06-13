/**
 * server/src/index.js
 * Find My Phone - Express + Socket.io Server
 * Handles real-time location tracking for multiple rooms
 */

import express from 'express';
import { createServer as createHttpServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import { readFileSync } from 'fs';
import { join } from 'path';
import { existsSync } from 'fs';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { RoomManager } from './socket/roomManager.js';

dotenv.config();

const PORT = process.env.PORT || 3000;

// Check if SSL certificates exist
const certPath = join(process.cwd(), 'certs', 'cert.pem');
const keyPath = join(process.cwd(), 'certs', 'key.pem');

const hasSSL = process.env.USE_HTTPS === 'true' && existsSync(certPath) && existsSync(keyPath);
const PROTOCOL = hasSSL ? 'https' : 'http';
const CLIENT_URL = process.env.CLIENT_URL || `${PROTOCOL}://localhost:5173`;

const app = express();

// Create server with HTTPS if certificates exist, otherwise HTTP
let httpServer;
if (hasSSL) {
  const options = {
    key: readFileSync(keyPath),
    cert: readFileSync(certPath),
  };
  httpServer = createHttpsServer(options, app);
  console.log('[SERVER] Using HTTPS with self-signed certificates');
} else {
  httpServer = createHttpServer(app);
  console.log('[SERVER] Using HTTP (certificates not found)');
}

// Initialize Socket.io with CORS - allow any origin for development
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// Middleware - allow CORS from any origin for development
app.use(cors());
app.use(express.json());

// Initialize room manager
const roomManager = new RoomManager(io);

function normalizeRoomId(roomId) {
  return typeof roomId === 'string' ? roomId.trim().toUpperCase() : '';
}

// REST API endpoints
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/rooms/:roomId/status', (req, res) => {
  const { roomId } = req.params;
  const status = roomManager.getRoomStatus(roomId);
  
  if (!status) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  res.json(status);
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log(`[SOCKET] Client connected: ${socket.id}`);

  /**
   * Device joins a tracking room
   * Emits: device_joined
   */
  socket.on('device:join', (data) => {
    const roomId = normalizeRoomId(data?.roomId);
    if (!roomId) {
      socket.emit('join_error', { message: 'Missing room code' });
      return;
    }

    console.log(`[SOCKET] Device joining room: ${roomId}`);
    
    socket.data.roomId = roomId;
    socket.data.role = 'device';
    roomManager.addDevice(roomId, socket.id);
    socket.join(roomId);
    
    io.to(roomId).emit('device_status', {
      status: 'online',
      deviceId: socket.id,
      timestamp: new Date().toISOString(),
    });
    
    socket.emit('device_joined', { roomId, deviceId: socket.id });
  });

  /**
   * Owner joins a tracking room
   * Emits: owner_joined, device_status
   */
  socket.on('owner:join', (data) => {
    const roomId = normalizeRoomId(data?.roomId);
    if (!roomId) {
      socket.emit('join_error', { message: 'Missing room code' });
      return;
    }

    console.log(`[SOCKET] Owner joining room: ${roomId}`);
    
    socket.data.roomId = roomId;
    socket.data.role = 'owner';
    roomManager.addOwner(roomId, socket.id);
    socket.join(roomId);
    
    // Send current device status to owner
    const deviceStatus = roomManager.getDeviceStatus(roomId);
    socket.emit('owner_joined', { roomId, ownerId: socket.id });
    
    if (deviceStatus) {
      socket.emit('device_status', deviceStatus);
    }

    const latestLocation = roomManager.getLatestLocation(roomId);
    if (latestLocation) {
      socket.emit('position_update', latestLocation);
    }
  });

  /**
   * Receive position update from tracked device
   * Broadcasts: position_update to room
   */
  socket.on('position:update', (data) => {
    const roomId = socket.data.roomId;
    
    if (!roomId) {
      console.warn(`[SOCKET] Position update without room context`);
      return;
    }

    if (socket.data.role !== 'device') {
      console.warn(`[SOCKET] Ignoring position update from non-device ${socket.id}`);
      return;
    }

    const positionData = {
      latitude: Number(data.latitude),
      longitude: Number(data.longitude),
      accuracy: data.accuracy || null,
      heading: data.heading || null,
      speed: data.speed || null,
      timestamp: new Date().toISOString(),
      deviceId: socket.id,
    };

    if (!Number.isFinite(positionData.latitude) || !Number.isFinite(positionData.longitude)) {
      console.warn(`[SOCKET] Invalid position update from ${socket.id}:`, data);
      return;
    }

    const ownerCount = roomManager.getOwnerCount(roomId);
    console.log(`[SOCKET] Position update in room ${roomId} (${ownerCount} owner(s)):`, positionData);

    // Store latest position in room manager
    roomManager.updateDeviceLocation(roomId, positionData);

    // Broadcast to all owners in the room
    io.to(roomId).emit('position_update', positionData);
  });

  /**
   * Ring device request from owner
   * Emits: ring event to specific device
   */
  socket.on('device:ring', (data) => {
    const roomId = socket.data.roomId;
    
    if (!roomId) {
      console.warn(`[SOCKET] Ring request without room context`);
      return;
    }

    const deviceId = roomManager.getDeviceId(roomId);
    
    if (deviceId) {
      io.to(deviceId).emit('device:ring', {
        timestamp: new Date().toISOString(),
      });
      console.log(`[SOCKET] Sent ring signal to device ${deviceId}`);
    } else {
      socket.emit('ring_error', { message: 'Device is not online' });
      console.warn(`[SOCKET] Ring requested in ${roomId}, but no device is online`);
    }
  });

  /**
   * Request compass bearing from device
   * Emits: compass:request to device
   */
  socket.on('compass:request', () => {
    const roomId = socket.data.roomId;
    
    if (!roomId) return;

    const deviceId = roomManager.getDeviceId(roomId);
    
    if (deviceId) {
      io.to(deviceId).emit('compass:request');
    }
  });

  /**
   * Receive compass heading from device
   * Broadcasts: compass:heading to room
   */
  socket.on('compass:heading', (data) => {
    const roomId = socket.data.roomId;
    
    if (!roomId) return;

    io.to(roomId).emit('compass:heading', {
      heading: data.heading,
      accuracy: data.accuracy || null,
      timestamp: new Date().toISOString(),
      deviceId: socket.id,
    });
  });

  /**
   * Handle socket disconnect
   */
  socket.on('disconnecting', () => {
    const roomId = socket.data.roomId;
    const role = socket.data.role;

    if (!roomId) return;

    roomManager.removeClient(roomId, socket.id);

    if (role === 'device') {
      io.to(roomId).emit('device_status', {
        status: 'offline',
        deviceId: socket.id,
        timestamp: new Date().toISOString(),
      });
    }
  });

  socket.on('disconnect', () => {
    console.log(`[SOCKET] Client disconnected: ${socket.id}`);
  });

  /**
   * Handle socket errors
   */
  socket.on('error', (error) => {
    console.error(`[SOCKET] Error from ${socket.id}:`, error);
  });
});

// Start server
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Find My Phone Server running on port ${PORT}`);
  console.log(`📍 Listening on: 0.0.0.0:${PORT}`);
  console.log(`📍 Client URL: ${CLIENT_URL}`);
  console.log(`✅ Ready for connections\n`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  httpServer.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
