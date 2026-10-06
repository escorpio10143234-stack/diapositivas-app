/**
 * ============================================================
 * SERVIDOR PRINCIPAL - SALA DE DIAPOSITIVAS EN TIEMPO REAL
 * ============================================================
 * CARACTERÍSTICAS:
 * - MÚLTIPLES SALAS con ID manual y contraseña hasheada
 * - Auto-limpieza de salas inactivas (1 hora)
 * - Nombres personalizados para participantes
 * - Envío de imágenes en tiempo real
 * - CHAT GRUPAL Y PRIVADO por sala
 * - Detección de desconexiones con tiempo de gracia
 * - Límite de 10 participantes por sala
 * - CORS permitido
 * ============================================================
 */

const express = require('express');
const app = express();
const http = require('http').createServer(app);
const crypto = require('crypto');

const io = require('socket.io')(http, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ['websocket', 'polling']
});

app.use(express.static('public'));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

io.engine.on('connection_error', (err) => {
  console.error('❌ Error de conexión en Socket.IO engine:', err.message);
});

// ============================================================
// CONFIGURACIÓN Y CONSTANTES
// ============================================================

const MAX_USERS_PER_ROOM = 10;
const ROOM_INACTIVE_TIMEOUT = 60 * 60 * 1000; // 1 hora
const ROOM_CLEANUP_INTERVAL = 10 * 60 * 1000; // 10 minutos
const HOST_RECONNECT_GRACE = 2 * 60 * 1000; // 2 minutos

// Estructura de las salas:
// rooms.set('reunion-2024', {
//   roomId, roomName, passwordHash, hostSocketId, hostName,
//   hostReconnectTimer, participants: [], createdAt, lastActivity
// })
const rooms = new Map();

let connectionCounter = 0;

// ============================================================
// FUNCIONES AUXILIARES
// ============================================================

/**
 * Genera un hash SHA-256 de una contraseña
 */
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

/**
 * Valida el formato del ID de sala
 * @returns {Object} { valid: boolean, error: string, cleanId: string }
 */
function validateRoomId(roomId) {
  if (!roomId || typeof roomId !== 'string') {
    return { valid: false, error: 'El ID de sala es obligatorio' };
  }
  
  const clean = roomId.trim().toLowerCase().replace(/\s+/g, '');
  
  if (clean.length < 4) {
    return { valid: false, error: 'El ID debe tener al menos 4 caracteres' };
  }
  if (clean.length > 20) {
    return { valid: false, error: 'El ID no puede tener más de 20 caracteres' };
  }
  if (!/^[a-z0-9_-]+$/.test(clean)) {
    return { valid: false, error: 'Solo letras, números, guiones (-) y guiones bajos (_)' };
  }
  
  return { valid: true, cleanId: clean };
}

/**
 * Valida el formato del nombre (de usuario o sala)
 */
function validateName(name, fieldName = 'Nombre', minLen = 2, maxLen = 40) {
  if (!name || typeof name !== 'string') {
    return { valid: false, error: `${fieldName} es obligatorio` };
  }
  
  const clean = name.trim();
  
  if (clean.length < minLen) {
    return { valid: false, error: `${fieldName} debe tener al menos ${minLen} caracteres` };
  }
  if (clean.length > maxLen) {
    return { valid: false, error: `${fieldName} no puede tener más de ${maxLen} caracteres` };
  }
  if (/[<>{}()]/.test(clean)) {
    return { valid: false, error: `${fieldName} contiene caracteres no permitidos` };
  }
  
  return { valid: true, cleanName: clean };
}

/**
 * Valida la contraseña
 */
function validatePassword(password) {
  if (!password || typeof password !== 'string') {
    return { valid: false, error: 'La contraseña es obligatoria' };
  }
  
  const clean = password.trim();
  
  if (clean.length < 4) {
    return { valid: false, error: 'La contraseña debe tener al menos 4 caracteres' };
  }
  if (clean.length > 30) {
    return { valid: false, error: 'La contraseña no puede tener más de 30 caracteres' };
  }
  
  return { valid: true, cleanPassword: clean };
}

/**
 * Obtiene información pública de una sala
 */
function getRoomInfo(room) {
  return {
    roomId: room.roomId,
    roomName: room.roomName,
    participantCount: room.participants.length,
    maxParticipants: MAX_USERS_PER_ROOM,
    hasHost: !!room.hostSocketId
  };
}

/**
 * Emite la lista de usuarios al anfitrión de la sala
 */
function emitUserList(roomId) {
  const room = rooms.get(roomId);
  if (!room || !room.hostSocketId) return;
  
  const hostSocket = io.sockets.sockets.get(room.hostSocketId);
  if (!hostSocket) return;
  
  const userList = room.participants.map(p => ({
    userId: p.userId,
    name: p.name
  }));
  
  hostSocket.emit('update-users', userList);
  
  // También enviar la lista a los participantes (para el chat privado)
  room.participants.forEach(p => {
    const pSocket = io.sockets.sockets.get(p.socketId);
    if (pSocket) {
      pSocket.emit('update-users', userList);
    }
  });
  
  console.log(`📋 [${roomId}] Lista de usuarios actualizada:`, userList);
}

/**
 * Envía un mensaje del sistema al chat de una sala
 */
function sendSystemMessage(roomId, text) {
  const room = rooms.get(roomId);
  if (!room) return;
  
  const systemMessage = {
    text,
    sender: 'Sistema',
    role: 'system',
    timestamp: Date.now(),
    isPrivate: false,
    targetType: 'group'
  };
  
  if (room.hostSocketId) {
    io.to(room.hostSocketId).emit('chat-message', systemMessage);
  }
  room.participants.forEach(p => {
    io.to(p.socketId).emit('chat-message', systemMessage);
  });
}

/**
 * Asigna un número de usuario disponible en una sala
 */
function assignUserId(room) {
  for (let i = 1; i <= MAX_USERS_PER_ROOM; i++) {
    const exists = room.participants.some(p => p.userId === i);
    if (!exists) return i;
  }
  return null;
}

/**
 * Verifica si un nombre ya está en uso en la sala
 */
function isNameTaken(room, name, excludeSocketId = null) {
  if (!name) return false;
  return room.participants.some(p => 
    p.name.toLowerCase() === name.toLowerCase() && p.socketId !== excludeSocketId
  );
}

/**
 * Obtiene la sala a partir del socket
 */
function getRoomBySocket(socket) {
  if (!socket.roomId) return null;
  return rooms.get(socket.roomId) || null;
}

/**
 * Encuentra el socket de un participante por userId en una sala
 */
function findSocketByUserId(room, userId) {
  if (userId === 0) {
    // El host tiene ID 0
    return room.hostSocketId ? io.sockets.sockets.get(room.hostSocketId) : null;
  }
  const participant = room.participants.find(p => p.userId === userId);
  if (!participant) return null;
  return io.sockets.sockets.get(participant.socketId);
}

/**
 * Obtiene el nombre de un usuario por ID
 */
function getUserName(room, userId) {
  if (userId === 0) return room.hostName || 'Anfitrión';
  const p = room.participants.find(p => p.userId === userId);
  return p ? p.name : `Usuario ${userId}`;
}

/**
 * Actualiza la actividad de la sala
 */
function touchRoom(roomId) {
  const room = rooms.get(roomId);
  if (room) room.lastActivity = Date.now();
}

/**
 * Destruye una sala completamente
 */
function destroyRoom(roomId, reason = 'Sala cerrada') {
  const room = rooms.get(roomId);
  if (!room) return;
  
  console.log(`🗑️ Destruyendo sala "${roomId}" - Razón: ${reason}`);
  
  // Notificar a todos
  if (room.hostSocketId) {
    io.to(room.hostSocketId).emit('room-closed', { message: reason });
  }
  room.participants.forEach(p => {
    io.to(p.socketId).emit('room-closed', { message: reason });
  });
  
  // Limpiar temporizadores
  if (room.hostReconnectTimer) {
    clearTimeout(room.hostReconnectTimer);
  }
  
  rooms.delete(roomId);
}

/**
 * Obtiene la IP local
 */
function getLocalIP() {
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '127.0.0.1';
}

// ============================================================
// LIMPIEZA AUTOMÁTICA DE SALAS INACTIVAS
// ============================================================

setInterval(() => {
  const now = Date.now();
  const toDelete = [];
  
  rooms.forEach((room, roomId) => {
    const inactive = now - room.lastActivity > ROOM_INACTIVE_TIMEOUT;
    const noHost = !room.hostSocketId;
    const noParticipants = room.participants.length === 0;
    
    if (inactive && noHost && noParticipants) {
      toDelete.push(roomId);
    }
  });
  
  toDelete.forEach(roomId => {
    console.log(`🧹 Eliminando sala inactiva: ${roomId}`);
    destroyRoom(roomId, 'La sala se eliminó por inactividad');
  });
  
  if (toDelete.length > 0) {
    console.log(`🧹 ${toDelete.length} salas eliminadas. Salas activas: ${rooms.size}`);
  }
}, ROOM_CLEANUP_INTERVAL);

// ============================================================
// RUTAS HTTP
// ============================================================

app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    activeRooms: rooms.size,
    timestamp: new Date().toISOString() 
  });
});

app.get('/api/rooms', (req, res) => {
  const roomsList = Array.from(rooms.values()).map(r => ({
    roomId: r.roomId,
    roomName: r.roomName,
    participantCount: r.participants.length,
    hasHost: !!r.hostSocketId,
    createdAt: r.createdAt
  }));
  res.json({ rooms: roomsList, total: roomsList.length });
});

app.get('/api/room/:roomId/exists', (req, res) => {
  const { cleanId, valid } = validateRoomId(req.params.roomId);
  if (!valid) {
    return res.json({ exists: false, valid: false });
  }
  const room = rooms.get(cleanId);
  res.json({ 
    exists: !!room, 
    valid: true,
    info: room ? getRoomInfo(room) : null
  });
});

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// ============================================================
// MANEJO DE SOCKETS
// ============================================================

io.on('connection', (socket) => {
  connectionCounter++;
  const clientId = socket.id;

  console.log(`🔌 [${connectionCounter}] Cliente conectado: ${clientId}`);
  console.log(`📊 Conexiones activas: ${io.engine.clientsCount} | Salas activas: ${rooms.size}`);

  // ============================================================
  // EVENTO: check-room - Verificar si una sala existe
  // ============================================================
  socket.on('check-room', (data) => {
    const { valid, error, cleanId } = validateRoomId(data?.roomId);
    
    if (!valid) {
      socket.emit('check-room-result', { 
        exists: false, 
        valid: false, 
        error 
      });
      return;
    }
    
    const room = rooms.get(cleanId);
    socket.emit('check-room-result', {
      exists: !!room,
      valid: true,
      roomId: cleanId,
      info: room ? getRoomInfo(room) : null
    });
  });

  // ============================================================
  // EVENTO: create-room - Crear una nueva sala
  // ============================================================
  socket.on('create-room', (data) => {
    console.log(`🆕 [${clientId}] Solicitud de crear sala:`, data);

    // Validar nombre del host
    const hostNameVal = validateName(data?.hostName, 'Nombre del anfitrión', 2, 20);
    if (!hostNameVal.valid) {
      socket.emit('create-room-error', { message: hostNameVal.error });
      return;
    }

    // Validar ID de sala
    const roomIdVal = validateRoomId(data?.roomId);
    if (!roomIdVal.valid) {
      socket.emit('create-room-error', { message: roomIdVal.error });
      return;
    }

    // Verificar si el ID ya existe
    if (rooms.has(roomIdVal.cleanId)) {
      socket.emit('create-room-error', { 
        message: `El ID "${roomIdVal.cleanId}" ya está en uso. Elige otro.`,
        code: 'ROOM_EXISTS'
      });
      return;
    }

    // Validar nombre de la sala
    const roomNameVal = validateName(data?.roomName, 'Nombre de la sala', 2, 40);
    if (!roomNameVal.valid) {
      socket.emit('create-room-error', { message: roomNameVal.error });
      return;
    }

    // Validar contraseña
    const passwordVal = validatePassword(data?.password);
    if (!passwordVal.valid) {
      socket.emit('create-room-error', { message: passwordVal.error });
      return;
    }

    // Crear la sala
    const roomId = roomIdVal.cleanId;
    const newRoom = {
      roomId,
      roomName: roomNameVal.cleanName,
      passwordHash: hashPassword(passwordVal.cleanPassword),
      hostSocketId: socket.id,
      hostName: hostNameVal.cleanName,
      hostReconnectTimer: null,
      participants: [],
      createdAt: Date.now(),
      lastActivity: Date.now()
    };

    rooms.set(roomId, newRoom);

    // Configurar el socket como host de la sala
    socket.roomId = roomId;
    socket.role = 'host';
    socket.userId = 0;
    socket.userName = hostNameVal.cleanName;
    socket.join(`room-${roomId}`);
    socket.join(`host-room-${roomId}`);

    console.log(`✅ Sala "${roomId}" creada por "${hostNameVal.cleanName}"`);

    // Enviar confirmación
    socket.emit('room-created', {
      roomId,
      roomName: roomNameVal.cleanName,
      hostName: hostNameVal.cleanName,
      password: passwordVal.cleanPassword, // Se envía para que el host pueda verla
      shareUrl: `/?room=${roomId}`,
      createdAt: newRoom.createdAt
    });
  });

  // ============================================================
  // EVENTO: join-room - Unirse a una sala existente
  // ============================================================
  socket.on('join-room', (data) => {
    console.log(`🚪 [${clientId}] Solicitud de unirse a sala:`, {
      roomId: data?.roomId,
      userName: data?.userName
    });

    // Validar ID de sala
    const roomIdVal = validateRoomId(data?.roomId);
    if (!roomIdVal.valid) {
      socket.emit('join-room-error', { message: roomIdVal.error });
      return;
    }

    const room = rooms.get(roomIdVal.cleanId);
    if (!room) {
      socket.emit('join-room-error', { 
        message: 'La sala no existe. Verifica el código.',
        code: 'ROOM_NOT_FOUND'
      });
      return;
    }

    // Verificar contraseña
    const passwordVal = validatePassword(data?.password);
    if (!passwordVal.valid) {
      socket.emit('join-room-error', { message: passwordVal.error });
      return;
    }

    if (hashPassword(passwordVal.cleanPassword) !== room.passwordHash) {
      socket.emit('join-room-error', { 
        message: 'Contraseña incorrecta',
        code: 'WRONG_PASSWORD'
      });
      return;
    }

    // Validar nombre del participante
    const userNameVal = validateName(data?.userName, 'Nombre', 2, 20);
    if (!userNameVal.valid) {
      socket.emit('join-room-error', { message: userNameVal.error });
      return;
    }

    // Verificar si el nombre ya está en uso
    if (isNameTaken(room, userNameVal.cleanName)) {
      socket.emit('join-room-error', {
        message: `El nombre "${userNameVal.cleanName}" ya está en uso. Elige otro.`,
        code: 'NAME_TAKEN'
      });
      return;
    }

    // Verificar si el host está conectado
    if (!room.hostSocketId) {
      socket.emit('join-room-error', {
        message: 'El anfitrión no está disponible en este momento',
        code: 'NO_HOST'
      });
      return;
    }

    // Verificar si la sala está llena
    if (room.participants.length >= MAX_USERS_PER_ROOM) {
      socket.emit('join-room-error', {
        message: `La sala está llena (${MAX_USERS_PER_ROOM}/${MAX_USERS_PER_ROOM})`,
        code: 'ROOM_FULL'
      });
      return;
    }

    // Asignar número de usuario
    const userId = assignUserId(room);
    if (userId === null) {
      socket.emit('join-room-error', {
        message: 'La sala está llena',
        code: 'ROOM_FULL'
      });
      return;
    }

    // Agregar el participante
    const participant = {
      userId,
      name: userNameVal.cleanName,
      socketId: socket.id,
      joinedAt: Date.now()
    };
    room.participants.push(participant);

    // Configurar el socket
    socket.roomId = roomIdVal.cleanId;
    socket.role = 'participant';
    socket.userId = userId;
    socket.userName = userNameVal.cleanName;
    socket.join(`room-${roomIdVal.cleanId}`);
    socket.join(`participant-room-${roomIdVal.cleanId}`);

    touchRoom(roomIdVal.cleanId);

    console.log(`✅ [${roomIdVal.cleanId}] Participante "${userNameVal.cleanName}" (ID: ${userId}) conectado`);

    // Confirmar al participante
    socket.emit('room-joined', {
      roomId: roomIdVal.cleanId,
      roomName: room.roomName,
      userId,
      userName: userNameVal.cleanName,
      totalUsers: room.participants.length,
      maxUsers: MAX_USERS_PER_ROOM
    });

    // Actualizar lista de usuarios
    emitUserList(roomIdVal.cleanId);

    // Notificar a todos los de la sala
    sendSystemMessage(roomIdVal.cleanId, `${userNameVal.cleanName} se ha unido a la sala`);
  });

  // ============================================================
  // EVENTO: send-image - El anfitrión envía una imagen
  // ============================================================
  socket.on('send-image', (data) => {
    const room = getRoomBySocket(socket);
    if (!room) {
      socket.emit('error', { message: 'No estás en una sala' });
      return;
    }

    if (socket.role !== 'host' || socket.id !== room.hostSocketId) {
      socket.emit('error', { message: 'Solo el anfitrión puede enviar imágenes' });
      return;
    }

    touchRoom(room.roomId);

    const { target, imageData } = data;
    if (!target || !imageData) {
      socket.emit('error', { message: 'Datos incompletos' });
      return;
    }

    const imageSizeKB = Math.round(imageData.length / 1024);
    console.log(`📤 [${room.roomId}] Enviando imagen (${imageSizeKB} KB) a: ${target}`);

    if (target === 'todos') {
      if (room.participants.length > 0) {
        room.participants.forEach(p => {
          io.to(p.socketId).emit('receive-image', {
            imageData,
            from: 'todos',
            timestamp: Date.now()
          });
        });
        socket.emit('image-sent', {
          target: 'TODOS',
          success: true,
          count: room.participants.length
        });
      } else {
        socket.emit('image-sent', {
          target: 'TODOS',
          success: false,
          message: 'No hay participantes conectados'
        });
      }
    } else {
      const userId = parseInt(target);
      if (isNaN(userId) || userId < 1 || userId > MAX_USERS_PER_ROOM) {
        socket.emit('image-sent', { target, success: false, message: 'ID inválido' });
        return;
      }

      const participant = room.participants.find(p => p.userId === userId);
      if (!participant) {
        socket.emit('image-sent', {
          target: `Usuario ${userId}`,
          success: false,
          message: 'El usuario no está conectado'
        });
        return;
      }

      io.to(participant.socketId).emit('receive-image', {
        imageData,
        from: participant.name,
        timestamp: Date.now()
      });
      socket.emit('image-sent', {
        target: participant.name,
        success: true
      });
    }
  });

  // ============================================================
  // EVENTO: chat-message - Mensaje grupal o privado
  // ============================================================
  socket.on('chat-message', (data) => {
    const room = getRoomBySocket(socket);
    if (!room) return;

    touchRoom(room.roomId);

    const messageText = data?.text?.trim();
    const targetType = data?.targetType || 'group';
    const targetUserId = data?.targetUserId;

    if (!messageText || messageText.length === 0) return;
    if (messageText.length > 500) {
      socket.emit('chat-error', { message: 'Mensaje demasiado largo (máx 500 caracteres)' });
      return;
    }

    // Determinar remitente
    let senderName = 'Anónimo';
    let senderRole = 'unknown';
    let senderId = null;

    if (socket.id === room.hostSocketId) {
      senderName = room.hostName || 'Anfitrión';
      senderRole = 'host';
      senderId = 0;
    } else {
      const p = room.participants.find(p => p.socketId === socket.id);
      if (p) {
        senderName = p.name;
        senderRole = 'participant';
        senderId = p.userId;
      } else {
        return;
      }
    }

    // CHAT GRUPAL
    if (targetType === 'group') {
      const chatMessage = {
        text: messageText,
        sender: senderName,
        senderId,
        role: senderRole,
        timestamp: Date.now(),
        targetType: 'group',
        isPrivate: false
      };

      console.log(`💬 [${room.roomId}] Grupal [${senderName}]: ${messageText}`);

      if (room.hostSocketId) {
        io.to(room.hostSocketId).emit('chat-message', chatMessage);
      }
      room.participants.forEach(p => {
        io.to(p.socketId).emit('chat-message', chatMessage);
      });
    }
    // CHAT PRIVADO
    else if (targetType === 'private') {
      const targetId = parseInt(targetUserId);
      if (isNaN(targetId)) {
        socket.emit('chat-error', { message: 'Destinatario inválido' });
        return;
      }

      const targetSocket = findSocketByUserId(room, targetId);
      const targetName = getUserName(room, targetId);

      if (!targetSocket) {
        socket.emit('chat-error', { message: `El destinatario no está disponible` });
        return;
      }

      const chatMessage = {
        text: messageText,
        sender: senderName,
        senderId,
        role: senderRole,
        timestamp: Date.now(),
        targetType: 'private',
        isPrivate: true,
        targetId,
        targetName
      };

      console.log(`🔒 [${room.roomId}] Privado [${senderName} → ${targetName}]: ${messageText}`);

      targetSocket.emit('chat-message', chatMessage);
      if (targetSocket.id !== socket.id) {
        socket.emit('chat-message', { ...chatMessage, isOwn: true });
      }
    }
  });

  // ============================================================
  // EVENTO: close-room - Cerrar la sala (solo host)
  // ============================================================
  socket.on('close-room', () => {
    const room = getRoomBySocket(socket);
    if (!room) {
      socket.emit('error', { message: 'No estás en una sala' });
      return;
    }

    if (socket.id !== room.hostSocketId) {
      socket.emit('error', { message: 'Solo el anfitrión puede cerrar la sala' });
      return;
    }

    console.log(`🚪 [${room.roomId}] Anfitrión cerró la sala manualmente`);
    destroyRoom(room.roomId, 'El anfitrión ha cerrado la sala');

    // Limpiar el socket
    socket.roomId = null;
    socket.role = null;
    socket.userId = null;
    socket.userName = null;
  });

  // ============================================================
  // EVENTO: ping
  // ============================================================
  socket.on('ping', () => {
    socket.emit('pong', { timestamp: Date.now() });
  });

  // ============================================================
  // EVENTO: disconnect
  // ============================================================
  socket.on('disconnect', (reason) => {
    console.log(`🔌 Cliente desconectado: ${socket.id} (${reason})`);

    const room = getRoomBySocket(socket);
    if (!room) return;

    // CASO 1: El ANFITRIÓN se desconectó
    if (socket.id === room.hostSocketId) {
      console.log(`👑 [${room.roomId}] Host "${room.hostName}" desconectado - esperando reconexión...`);
      room.hostSocketId = null;

      // Notificar a los participantes
      room.participants.forEach(p => {
        io.to(p.socketId).emit('host-disconnected', {
          message: 'El anfitrión se ha desconectado. Esperando reconexión...'
        });
      });

      // Dar tiempo de gracia
      room.hostReconnectTimer = setTimeout(() => {
        const currentRoom = rooms.get(room.roomId);
        if (!currentRoom || currentRoom.hostSocketId) return;
        
        console.log(`👑 [${room.roomId}] Host no regresó - cerrando sala`);
        destroyRoom(room.roomId, 'El anfitrión abandonó la sala');
      }, HOST_RECONNECT_GRACE);
    }

    // CASO 2: Un PARTICIPANTE se desconectó
    const participant = room.participants.find(p => p.socketId === socket.id);
    if (participant) {
      const { userId, name } = participant;
      room.participants = room.participants.filter(p => p.socketId !== socket.id);
      
      console.log(`👤 [${room.roomId}] Participante "${name}" (ID: ${userId}) desconectado`);
      
      emitUserList(room.roomId);
      sendSystemMessage(room.roomId, `${name} ha salido de la sala`);
      
      // Notificar al host
      if (room.hostSocketId) {
        io.to(room.hostSocketId).emit('user-left', {
          userId,
          name,
          totalUsers: room.participants.length
        });
      }
    }
  });

  socket.on('error', (err) => {
    console.error(`❌ Error en socket ${socket.id}:`, err.message);
  });
});

// ============================================================
// MANEJO DE ERRORES
// ============================================================

process.on('uncaughtException', (err) => {
  console.error('❌ Error no capturado:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('❌ Promesa no manejada:', err);
});

// ============================================================
// INICIO DEL SERVIDOR
// ============================================================

const PORT = process.env.PORT || 3000;

http.listen(PORT, '0.0.0.0', () => {
  console.log('╔═══════════════════════════════════════════════════════════════════════╗');
  console.log('║              🚀  SERVIDOR DE DIAPOSITIVAS EN TIEMPO REAL              ║');
  console.log('║                    CON MÚLTIPLES SALAS Y CHAT                         ║');
  console.log('╠═══════════════════════════════════════════════════════════════════════╣');
  console.log(`║  📡 Puerto: ${PORT}                                                    ║`);
  console.log(`║  👥 Máximo participantes por sala: ${MAX_USERS_PER_ROOM}                           ║`);
  console.log(`║  🌐 URL local: http://localhost:${PORT}                              ║`);
  console.log(`║  📱 URL móvil: http://${getLocalIP()}:${PORT}                        ║`);
  console.log('║  🏠 Salas: Sin límite (auto-limpieza a 1h)                            ║');
  console.log('║  🔒 Contraseñas: Hasheadas con SHA-256                                ║');
  console.log('║  💬 Chat: Grupal + Privado por sala                                    ║');
  console.log('║  🔊 Sonidos: Activados                                                ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('📌 Esperando conexiones...');
  console.log('');
});