/**
 * ============================================================
 * APLICACIÓN CLIENTE - SALA DE DIAPOSITIVAS v2.0
 * ============================================================
 * CARACTERÍSTICAS:
 * - Sistema de MÚLTIPLES SALAS con ID manual y contraseña
 * - Detección automática de sala por URL (?room=XXX)
 * - Sonidos al crear/unirse/errores
 * - Nombres personalizados para participantes
 * - Modo oscuro/claro con persistencia
 * - Chat grupal y privado
 * - Lightbox para ver imágenes en pantalla completa
 * - Fix de teclado en móviles
 * - Drag & Drop táctil y mouse
 * - Redimensionado automático de imágenes
 * ============================================================
 */

(function() {
  'use strict';

  const DRAG_THRESHOLD = 10;

  // ============================================================
  // ELEMENTOS DEL DOM - LANDING
  // ============================================================
  const landing = document.getElementById('landing');
  const btnCreateRoom = document.getElementById('btnCreateRoom');
  const btnJoinRoom = document.getElementById('btnJoinRoom');
  const themeToggleLanding = document.getElementById('themeToggleLanding');

  // ============================================================
  // ELEMENTOS DEL DOM - OVERLAY CREAR SALA
  // ============================================================
  const createRoomOverlay = document.getElementById('createRoomOverlay');
  const createRoomClose = document.getElementById('createRoomClose');
  const createRoomCancel = document.getElementById('createRoomCancel');
  const createRoomSubmit = document.getElementById('createRoomSubmit');
  const createHostName = document.getElementById('createHostName');
  const createRoomId = document.getElementById('createRoomId');
  const createRoomIdStatus = document.getElementById('createRoomIdStatus');
  const createRoomName = document.getElementById('createRoomName');
  const createPassword = document.getElementById('createPassword');
  const createRoomError = document.getElementById('createRoomError');

  // ============================================================
  // ELEMENTOS DEL DOM - OVERLAY UNIRSE A SALA
  // ============================================================
  const joinRoomOverlay = document.getElementById('joinRoomOverlay');
  const joinRoomClose = document.getElementById('joinRoomClose');
  const joinRoomCancel = document.getElementById('joinRoomCancel');
  const joinRoomSubmit = document.getElementById('joinRoomSubmit');
  const joinUserName = document.getElementById('joinUserName');
  const joinRoomId = document.getElementById('joinRoomId');
  const joinRoomIdStatus = document.getElementById('joinRoomIdStatus');
  const joinPassword = document.getElementById('joinPassword');
  const joinRoomError = document.getElementById('joinRoomError');

  // ============================================================
  // ELEMENTOS DEL DOM - LOADING OVERLAY
  // ============================================================
  const loadingOverlay = document.getElementById('loadingOverlay');
  const loadingText = document.getElementById('loadingText');

  // ============================================================
  // ELEMENTOS DEL DOM - APP PRINCIPAL
  // ============================================================
  const appContainer = document.getElementById('appContainer');
  const btnExit = document.getElementById('btnExit');
  const appTitle = document.getElementById('appTitle');
  const appSubtitle = document.getElementById('appSubtitle');
  const roleBadge = document.getElementById('roleBadge');
  const themeToggleApp = document.getElementById('themeToggleApp');

  // Panel de info de la sala
  const roomInfoPanel = document.getElementById('roomInfoPanel');
  const roomInfoCode = document.getElementById('roomInfoCode');
  const roomInfoPassword = document.getElementById('roomInfoPassword');
  const copyRoomCodeBtn = document.getElementById('copyRoomCodeBtn');
  const toggleRoomPasswordBtn = document.getElementById('toggleRoomPasswordBtn');
  const copyRoomLinkBtn = document.getElementById('copyRoomLinkBtn');
  const closeRoomBtn = document.getElementById('closeRoomBtn');

  // Host Dashboard
  const hostDashboard = document.getElementById('hostDashboard');
  const slideGrid = document.getElementById('slideGrid');
  const addImagesBtn = document.getElementById('addImagesBtn');
  const fileInput = document.getElementById('fileInput');
  const userGrid = document.getElementById('userGrid');

  // Participant View
  const participantView = document.getElementById('participantView');
  const participantIdDisplay = document.getElementById('participantIdDisplay');
  const participantContent = document.getElementById('participantContent');

  // ============================================================
  // ELEMENTOS DEL DOM - CHAT
  // ============================================================
  const chatPanel = document.getElementById('chatPanel');
  const chatMessages = document.getElementById('chatMessages');
  const chatInput = document.getElementById('chatInput');
  const chatSendBtn = document.getElementById('chatSendBtn');
  const chatToggleBtn = document.getElementById('chatToggleBtn');
  const chatCloseBtn = document.getElementById('chatCloseBtn');
  const chatBadge = document.getElementById('chatBadge');
  const chatTargetSelect = document.getElementById('chatTargetSelect');
  const chatTitle = document.getElementById('chatTitle');

  // ============================================================
  // ESTADO GLOBAL
  // ============================================================
  let socket = null;
  let currentRole = null;           // 'host' | 'participant'
  let currentRoom = null;            // { roomId, roomName, password, hostName }
  let myUserId = null;
  let myUserName = null;
  let slides = [];
  let slideCounter = 0;
  let isHostConnected = false;
  let connectionAttempts = 0;
  let pingInterval = null;

  // Estado del chat
  let unreadCount = 0;
  let isChatOpen = false;
  let currentChatTarget = 'group';
  let connectedUsersList = [];

  // Estado del drag
  let draggedSlideId = null;
  let draggedElement = null;
  let touchClone = null;
  let touchOffsetX = 0;
  let touchOffsetY = 0;
  let isDragging = false;
  let isMoved = false;
  let startX = 0;
  let startY = 0;

  // Estado del lightbox
  let lightboxOverlay = null;

  // Verificación de sala pendiente
  let checkRoomTimeout = null;

  // Contraseña visible para el host
  let hostPasswordVisible = false;

  // ============================================================
  // SISTEMA DE SONIDOS (Web Audio API)
  // ============================================================

  let audioContext = null;

  function initAudioContext() {
      if (!audioContext) {
          try {
              audioContext = new (window.AudioContext || window.webkitAudioContext)();
          } catch (e) {
              console.warn('AudioContext no soportado:', e);
          }
      }
      // Reanudar si está suspendido (política del navegador)
      if (audioContext && audioContext.state === 'suspended') {
          audioContext.resume().catch(() => {});
      }
      return audioContext;
  }

  function playTone(frequency, duration, type = 'sine', volume = 0.15) {
      const ctx = initAudioContext();
      if (!ctx) return;
      
      try {
          const oscillator = ctx.createOscillator();
          const gainNode = ctx.createGain();
          
          oscillator.type = type;
          oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);
          
          gainNode.gain.setValueAtTime(0, ctx.currentTime);
          gainNode.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.01);
          gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
          
          oscillator.connect(gainNode);
          gainNode.connect(ctx.destination);
          
          oscillator.start(ctx.currentTime);
          oscillator.stop(ctx.currentTime + duration);
      } catch (e) {
          console.warn('Error al reproducir sonido:', e);
      }
  }

  function playSuccessSound() {
      // Dos tonos ascendentes (ding-ding)
      playTone(880, 0.15);
      setTimeout(() => playTone(1174, 0.2), 100);
  }

  function playErrorSound() {
      // Tono grave corto
      playTone(220, 0.3, 'sine', 0.12);
  }

  function playNotifySound() {
      // Tono suave
      playTone(660, 0.12, 'sine', 0.08);
  }

  function playCloseRoomSound() {
      // Tono descendente
      playTone(880, 0.1);
      setTimeout(() => playTone(440, 0.2), 100);
  }

  // ============================================================
  // MODO OSCURO
  // ============================================================

  function toggleTheme() {
      const isDark = document.body.classList.toggle('dark-mode');
      localStorage.setItem('theme', isDark ? 'dark' : 'light');
      document.querySelectorAll('.theme-toggle, #themeToggleLanding, #themeToggleApp').forEach(btn => {
          if (btn) btn.textContent = isDark ? '☀️' : '🌙';
      });
      const metaTheme = document.getElementById('themeColor');
      if (metaTheme) metaTheme.content = isDark ? '#0f172a' : '#1e293b';
  }

  function loadTheme() {
      const savedTheme = localStorage.getItem('theme');
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const isDark = savedTheme ? savedTheme === 'dark' : prefersDark;
      if (isDark) {
          document.body.classList.add('dark-mode');
          const metaTheme = document.getElementById('themeColor');
          if (metaTheme) metaTheme.content = '#0f172a';
          document.querySelectorAll('.theme-toggle, #themeToggleLanding, #themeToggleApp').forEach(btn => {
              if (btn) btn.textContent = '☀️';
          });
      }
  }

  function initThemeButtons() {
      themeToggleLanding?.addEventListener('click', toggleTheme);
      themeToggleApp?.addEventListener('click', toggleTheme);
  }

  // ============================================================
  // LIGHTBOX
  // ============================================================

  function createLightbox() {
      if (lightboxOverlay) return;

      lightboxOverlay = document.createElement('div');
      lightboxOverlay.className = 'lightbox-overlay';
      lightboxOverlay.innerHTML = `
          <button class="lightbox-close" title="Cerrar (Esc)">✕</button>
          <div class="lightbox-content">
              <img src="" alt="Vista completa" id="lightboxImg" />
          </div>
          <button class="lightbox-download" id="lightboxDownload">
              ⬇️ Descargar
          </button>
          <span class="lightbox-hint">Presiona ESC o haz clic fuera para cerrar</span>
      `;
      document.body.appendChild(lightboxOverlay);

      lightboxOverlay.addEventListener('click', (e) => {
          if (e.target === lightboxOverlay) closeLightbox();
      });

      lightboxOverlay.querySelector('.lightbox-close').addEventListener('click', (e) => {
          e.stopPropagation();
          closeLightbox();
      });

      lightboxOverlay.querySelector('#lightboxDownload').addEventListener('click', (e) => {
          e.stopPropagation();
          const img = document.getElementById('lightboxImg');
          if (img && img.src) downloadImage(img.src);
      });

      document.addEventListener('keydown', (e) => {
          if (e.key === 'Escape' && lightboxOverlay.classList.contains('active')) {
              closeLightbox();
          }
      });
  }

  function openLightbox(imageSrc) {
      if (!lightboxOverlay) createLightbox();
      const img = document.getElementById('lightboxImg');
      if (img) img.src = imageSrc;
      lightboxOverlay.classList.add('active');
      document.body.style.overflow = 'hidden';
  }

  function closeLightbox() {
      if (!lightboxOverlay) return;
      lightboxOverlay.classList.remove('active');
      document.body.style.overflow = '';
  }

  // ============================================================
  // FIX TECLADO MÓVIL
  // ============================================================

  function setupKeyboardFix() {
      if (!chatInput) return;

      if (window.visualViewport) {
          window.visualViewport.addEventListener('resize', () => {
              const keyboardHeight = window.innerHeight - window.visualViewport.height;
              const container = document.querySelector('.chat-input-container');

              if (keyboardHeight > 100 && isChatOpen) {
                  container?.classList.add('keyboard-open');
                  setTimeout(scrollChatToBottom, 100);
              } else {
                  container?.classList.remove('keyboard-open');
              }
          });
      }

      chatInput.addEventListener('focus', () => {
          setTimeout(scrollChatToBottom, 300);
      });
  }

  // ============================================================
  // MODALES (Crear / Unirse)
  // ============================================================

  function showModal(overlay) {
      if (!overlay) return;
      overlay.classList.add('active');
      document.body.style.overflow = 'hidden';
  }

  function hideModal(overlay) {
      if (!overlay) return;
      overlay.classList.remove('active');
      document.body.style.overflow = '';
  }

  function showCreateRoomModal() {
      // Limpiar campos
      createHostName.value = '';
      createRoomId.value = '';
      createRoomName.value = '';
      createPassword.value = '';
      createRoomIdStatus.textContent = '';
      createRoomIdStatus.className = 'form-status';
      createRoomError.classList.remove('visible');
      createRoomError.textContent = '';
      
      showModal(createRoomOverlay);
      setTimeout(() => createHostName.focus(), 300);
  }

  function showJoinRoomModal(prefillRoomId = null) {
      joinUserName.value = '';
      joinRoomId.value = prefillRoomId || '';
      joinPassword.value = '';
      joinRoomIdStatus.textContent = '';
      joinRoomIdStatus.className = 'form-status';
      joinRoomError.classList.remove('visible');
      joinRoomError.textContent = '';
      
      showModal(joinRoomOverlay);
      
      if (prefillRoomId) {
          setTimeout(() => {
              joinUserName.focus();
              checkRoomIdExists(prefillRoomId);
          }, 300);
      } else {
          setTimeout(() => joinUserName.focus(), 300);
      }
  }

  function showLoading(text = 'Procesando...') {
      loadingText.textContent = text;
      loadingOverlay.classList.add('active');
  }

  function hideLoading() {
      loadingOverlay.classList.remove('active');
  }

  function showFormError(element, message) {
      element.textContent = '❌ ' + message;
      element.classList.add('visible');
      playErrorSound();
      // Vibración en móvil (si está disponible)
      if (navigator.vibrate) navigator.vibrate([50, 30, 50]);
  }

  function clearFormError(element) {
      element.textContent = '';
      element.classList.remove('visible');
  }

  // ============================================================
  // VALIDACIONES
  // ============================================================

  function validateRoomIdFormat(roomId) {
      if (!roomId || roomId.trim().length === 0) {
          return { valid: false, error: 'El ID es obligatorio' };
      }
      const clean = roomId.trim().toLowerCase().replace(/\s+/g, '');
      if (clean.length < 4) return { valid: false, error: 'Mínimo 4 caracteres' };
      if (clean.length > 20) return { valid: false, error: 'Máximo 20 caracteres' };
      if (!/^[a-z0-9_-]+$/.test(clean)) {
          return { valid: false, error: 'Solo letras, números, - y _' };
      }
      return { valid: true, cleanId: clean };
  }

  function validateNameFormat(name, minLen = 2, maxLen = 20) {
      if (!name || name.trim().length === 0) {
          return { valid: false, error: 'El nombre es obligatorio' };
      }
      const clean = name.trim();
      if (clean.length < minLen) return { valid: false, error: `Mínimo ${minLen} caracteres` };
      if (clean.length > maxLen) return { valid: false, error: `Máximo ${maxLen} caracteres` };
      if (/[<>{}()]/.test(clean)) return { valid: false, error: 'Caracteres no permitidos' };
      return { valid: true, cleanName: clean };
  }

  function validatePasswordFormat(password) {
      if (!password || password.trim().length === 0) {
          return { valid: false, error: 'La contraseña es obligatoria' };
      }
      const clean = password.trim();
      if (clean.length < 4) return { valid: false, error: 'Mínimo 4 caracteres' };
      if (clean.length > 30) return { valid: false, error: 'Máximo 30 caracteres' };
      return { valid: true, cleanPassword: clean };
  }

  // ============================================================
  // VERIFICAR SI UNA SALA EXISTE (con debounce)
  // ============================================================

  function checkRoomIdExists(roomId) {
      if (checkRoomTimeout) clearTimeout(checkRoomTimeout);
      
      const val = validateRoomIdFormat(roomId);
      if (!val.valid) {
          joinRoomIdStatus.textContent = '';
          joinRoomIdStatus.className = 'form-status';
          return;
      }
      
      joinRoomIdStatus.textContent = '⏳ Verificando...';
      joinRoomIdStatus.className = 'form-status checking';
      
      checkRoomTimeout = setTimeout(() => {
          if (!socket) return;
          socket.emit('check-room', { roomId: val.cleanId });
      }, 400);
  }

  function checkCreateRoomIdExists(roomId) {
      if (checkRoomTimeout) clearTimeout(checkRoomTimeout);
      
      const val = validateRoomIdFormat(roomId);
      if (!val.valid) {
          createRoomIdStatus.textContent = '';
          createRoomIdStatus.className = 'form-status';
          return;
      }
      
      createRoomIdStatus.textContent = '⏳ Verificando disponibilidad...';
      createRoomIdStatus.className = 'form-status checking';
      
      checkRoomTimeout = setTimeout(() => {
          if (!socket) return;
          socket.emit('check-room', { roomId: val.cleanId, forCreate: true });
      }, 400);
  }

  // ============================================================
  // MANEJAR URLs CON PARÁMETRO ?room=XXX
  // ============================================================

  function checkUrlForRoomId() {
      const params = new URLSearchParams(window.location.search);
      const roomParam = params.get('room');
      if (roomParam) {
          console.log(`🔗 Sala detectada en URL: ${roomParam}`);
          // Esperar a que el socket se conecte y mostrar el modal
          setTimeout(() => {
              showJoinRoomModal(roomParam);
          }, 500);
          return true;
      }
      return false;
  }

  // ============================================================
  // COPIAR AL PORTAPAPELES
  // ============================================================

  async function copyToClipboard(text, successMessage = 'Copiado al portapapeles') {
      try {
          if (navigator.clipboard && window.isSecureContext) {
              await navigator.clipboard.writeText(text);
          } else {
              // Fallback para navegadores antiguos
              const textArea = document.createElement('textarea');
              textArea.value = text;
              textArea.style.position = 'fixed';
              textArea.style.left = '-9999px';
              document.body.appendChild(textArea);
              textArea.focus();
              textArea.select();
              document.execCommand('copy');
              document.body.removeChild(textArea);
          }
          showToast(`✅ ${successMessage}`, 'success');
          playNotifySound();
      } catch (e) {
          console.error('Error al copiar:', e);
          showToast('❌ Error al copiar', 'error');
          playErrorSound();
      }
  }

  // ============================================================
  // SISTEMA DE PING
  // ============================================================

  function startPingSystem() {
      if (pingInterval) clearInterval(pingInterval);
      pingInterval = setInterval(() => {
          if (socket && socket.connected) socket.emit('ping');
      }, 10000);
  }

  function stopPingSystem() {
      if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
  }

  // ============================================================
  // NAVEGACIÓN / MOSTRAR VISTAS
  // ============================================================

  function showLanding() {
      stopPingSystem();
      hideModal(createRoomOverlay);
      hideModal(joinRoomOverlay);
      hideLoading();
      resetChat();
      closeLightbox();
      
      landing.style.display = 'block';
      appContainer.classList.remove('active');
      appContainer.style.display = 'none';
      
      if (socket) { socket.disconnect(); socket = null; }
      
      currentRole = null;
      currentRoom = null;
      myUserId = null;
      myUserName = null;
      isHostConnected = false;
      slides = [];
      slideCounter = 0;
      connectedUsersList = [];
      hostPasswordVisible = false;
      
      slideGrid.innerHTML = '<div class="empty-slides">No hay diapositivas. Añade imágenes.</div>';
      userGrid.innerHTML = '';
      participantContent.innerHTML = '<div class="empty-state">🖼️ Esperando diapositiva...</div>';
      hostDashboard.classList.add('hidden');
      participantView.classList.add('hidden');
      roomInfoPanel.classList.remove('visible');
      
      document.body.style.overflow = '';
      document.body.style.touchAction = '';
      document.body.classList.remove('no-scroll');
      
      const isDark = document.body.classList.contains('dark-mode');
      if (themeToggleLanding) themeToggleLanding.textContent = isDark ? '☀️' : '🌙';
  }

  function showHostView() {
      landing.style.display = 'none';
      appContainer.style.display = 'block';
      appContainer.classList.add('active');
      currentRole = 'host';
      
      hostDashboard.classList.remove('hidden');
      participantView.classList.add('hidden');
      roomInfoPanel.classList.add('visible');
      
      roleBadge.textContent = '👤 Anfitrión';
      appTitle.textContent = '🎬 Panel de control';
      appSubtitle.textContent = `Sala: ${currentRoom.roomName}`;
      
      // Info de la sala
      roomInfoCode.textContent = currentRoom.roomId;
      updatePasswordDisplay();
      
      const isDark = document.body.classList.contains('dark-mode');
      if (themeToggleApp) themeToggleApp.textContent = isDark ? '☀️' : '🌙';
  }

  function showParticipantView() {
      landing.style.display = 'none';
      appContainer.style.display = 'block';
      appContainer.classList.add('active');
      currentRole = 'participant';
      
      hostDashboard.classList.add('hidden');
      participantView.classList.remove('hidden');
      roomInfoPanel.classList.remove('visible');
      
      roleBadge.textContent = '👤 Participante';
      appTitle.textContent = '👀 Sala de participantes';
      appSubtitle.textContent = `Sala: ${currentRoom.roomName}`;
      participantIdDisplay.textContent = `👤 ${myUserName}`;
      
      const isDark = document.body.classList.contains('dark-mode');
      if (themeToggleApp) themeToggleApp.textContent = isDark ? '☀️' : '🌙';
  }

  function updatePasswordDisplay() {
      if (!roomInfoPassword || !currentRoom) return;
      if (hostPasswordVisible) {
          roomInfoPassword.textContent = currentRoom.password;
          if (toggleRoomPasswordBtn) toggleRoomPasswordBtn.textContent = '🙈';
      } else {
          roomInfoPassword.textContent = '•'.repeat(currentRoom.password.length);
          if (toggleRoomPasswordBtn) toggleRoomPasswordBtn.textContent = '👁️';
      }
  }

  // ============================================================
  // CONEXIÓN SOCKET
  // ============================================================

  function connectSocket() {
      if (socket) { socket.disconnect(); socket = null; }
      connectionAttempts++;
      
      socket = io({
          reconnection: true,
          reconnectionAttempts: 5,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 5000,
          timeout: 20000
      });

      socket.on('connect', () => {
          console.log('✅ Conectado al servidor');
          
          // Si había un roomId pendiente por URL, ya se mostró el modal
          // Aquí no hacemos nada
      });

      // ============================================================
      // EVENTOS DE CREAR SALA
      // ============================================================
      
      socket.on('room-created', (data) => {
          console.log('✅ Sala creada:', data);
          hideLoading();
          hideModal(createRoomOverlay);
          playSuccessSound();
          
          // Guardar info de la sala
          currentRoom = {
              roomId: data.roomId,
              roomName: data.roomName,
              password: data.password,
              hostName: data.hostName
          };
          myUserName = data.hostName;
          myUserId = 0;
          isHostConnected = true;
          
          // Actualizar URL sin recargar
          const newUrl = `${window.location.pathname}?room=${data.roomId}`;
          window.history.replaceState({}, '', newUrl);
          
          showToast(`✅ Sala "${data.roomName}" creada`, 'success');
          showHostView();
          startPingSystem();
      });

      socket.on('create-room-error', (data) => {
          hideLoading();
          console.error('❌ Error al crear sala:', data.message);
          
          let errorMsg = data.message;
          if (data.code === 'ROOM_EXISTS') {
              errorMsg = `El ID "${createRoomId.value}" ya está en uso`;
              createRoomIdStatus.textContent = '❌ Ya está en uso';
              createRoomIdStatus.className = 'form-status taken';
          }
          
          showFormError(createRoomError, errorMsg);
      });

      // ============================================================
      // EVENTOS DE UNIRSE A SALA
      // ============================================================
      
      socket.on('room-joined', (data) => {
          console.log('✅ Unido a sala:', data);
          hideLoading();
          hideModal(joinRoomOverlay);
          playSuccessSound();
          
          currentRoom = {
              roomId: data.roomId,
              roomName: data.roomName,
              password: joinPassword.value.trim(),
              hostName: null
          };
          myUserId = data.userId;
          myUserName = data.userName;
          
          // Actualizar URL sin recargar
          const newUrl = `${window.location.pathname}?room=${data.roomId}`;
          window.history.replaceState({}, '', newUrl);
          
          showToast(`✅ Bienvenido a "${data.roomName}"`, 'success');
          showParticipantView();
          startPingSystem();
      });

      socket.on('join-room-error', (data) => {
          hideLoading();
          console.error('❌ Error al unirse:', data.message);
          
          let errorMsg = data.message;
          if (data.code === 'ROOM_NOT_FOUND') {
              errorMsg = 'La sala no existe. Verifica el código.';
              joinRoomIdStatus.textContent = '❌ No existe';
              joinRoomIdStatus.className = 'form-status taken';
          } else if (data.code === 'WRONG_PASSWORD') {
              errorMsg = 'Contraseña incorrecta';
          } else if (data.code === 'NAME_TAKEN') {
              errorMsg = 'Ese nombre ya está en uso, elige otro';
          } else if (data.code === 'ROOM_FULL') {
              errorMsg = 'La sala está llena (10/10)';
          } else if (data.code === 'NO_HOST') {
              errorMsg = 'El anfitrión no está disponible';
          }
          
          showFormError(joinRoomError, errorMsg);
      });

      // ============================================================
      // VERIFICAR SI SALA EXISTE
      // ============================================================
      
      socket.on('check-room-result', (data) => {
          if (!data.valid) {
              joinRoomIdStatus.textContent = '';
              createRoomIdStatus.textContent = '';
              return;
          }
          
          // Si es para crear sala
          if (createRoomIdStatus.classList.contains('checking')) {
              if (data.exists) {
                  createRoomIdStatus.textContent = '❌ Ya está en uso, elige otro';
                  createRoomIdStatus.className = 'form-status taken';
              } else {
                  createRoomIdStatus.textContent = '✅ Disponible';
                  createRoomIdStatus.className = 'form-status available';
              }
          }
          
          // Si es para unirse
          if (joinRoomIdStatus.classList.contains('checking')) {
              if (data.exists) {
                  joinRoomIdStatus.textContent = '✅ Sala encontrada';
                  joinRoomIdStatus.className = 'form-status available';
              } else {
                  joinRoomIdStatus.textContent = '❌ No existe';
                  joinRoomIdStatus.className = 'form-status taken';
              }
          }
      });

      // ============================================================
      // EVENTOS GENERALES DE LA SALA
      // ============================================================
      
      socket.on('update-users', (users) => {
          connectedUsersList = users || [];
          if (currentRole === 'host') {
              renderUserGrid(connectedUsersList);
          }
          updateChatTargetSelect(connectedUsersList);
      });

      socket.on('receive-image', (data) => {
          if (currentRole !== 'participant') return;
          displayReceivedImage(data.imageData, data.from);
          playNotifySound();
      });

      socket.on('image-sent', (data) => {
          if (currentRole !== 'host') return;
          if (data.success) {
              showToast(`✅ Imagen enviada a ${data.target}`, 'success');
          } else if (data.message &&
              !data.message.includes('no está conectado') &&
              !data.message.includes('No hay participantes')) {
              showToast(data.message, 'warning');
          }
      });

      socket.on('chat-message', (data) => {
          appendChatMessage(data);
          if (!isChatOpen && data.role !== 'system' && data.sender !== myUserName && data.sender !== 'Anfitrión') {
              playNotifySound();
          }
      });

      socket.on('chat-error', (data) => showToast(data.message, 'warning'));

      socket.on('host-disconnected', (data) => {
          if (currentRole === 'participant') {
              setTimeout(() => {
                  if (!isHostConnected) {
                      alert(`❌ ${data.message || 'El anfitrión ha abandonado la sala.'}`);
                      showLanding();
                  }
              }, 2000);
          }
      });

      socket.on('user-joined', (data) => {
          if (currentRole === 'participant') {
              showToast(`${data.name} se ha unido`, 'info');
          }
      });

      socket.on('user-left', (data) => {
          if (currentRole === 'participant') {
              showToast(`${data.name} ha salido`, 'info');
          }
      });

      socket.on('room-closed', (data) => {
          alert(`❌ ${data.message || 'La sala ha sido cerrada'}`);
          playErrorSound();
          showLanding();
      });

      socket.on('connect_error', () => {
          if (connectionAttempts >= 5) {
              alert('❌ No se pudo conectar al servidor.');
              showLanding();
          }
      });

      socket.on('disconnect', (reason) => {
          isHostConnected = false;
          if (reason === 'io server disconnect' && currentRole === 'participant') {
              alert('❌ El servidor cerró la conexión.');
              showLanding();
          }
      });

      socket.on('reconnect', () => {
          showToast('Conexión restablecida', 'success');
          // No reconectar automáticamente a la sala por ahora
          // (sería complejo de manejar)
      });

      socket.on('reconnect_failed', () => {
          alert('❌ No se pudo reconectar.');
          showLanding();
      });

      socket.on('pong', () => {});
  }

  // ============================================================
  // TOAST
  // ============================================================

  function showToast(message, type = 'info') {
      let toastContainer = document.getElementById('toastContainer');
      if (!toastContainer) {
          toastContainer = document.createElement('div');
          toastContainer.id = 'toastContainer';
          toastContainer.style.cssText = `
            position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
            z-index: 10000; display: flex; flex-direction: column; align-items: center;
            gap: 8px; pointer-events: none; max-width: 90%; width: 400px;
          `;
          document.body.appendChild(toastContainer);
      }
      const colors = { success: '#10b981', warning: '#f59e0b', error: '#ef4444', info: '#3b82f6' };
      const toast = document.createElement('div');
      toast.style.cssText = `
        background: ${colors[type] || colors.info}; color: white; padding: 12px 20px;
        border-radius: 12px; font-size: 0.95rem; font-weight: 500;
        box-shadow: 0 10px 40px rgba(0,0,0,0.2); pointer-events: auto;
        animation: slideUp 0.3s ease; width: 100%; text-align: center;
      `;
      toast.textContent = message;
      toastContainer.appendChild(toast);
      setTimeout(() => {
          toast.style.opacity = '0';
          toast.style.transform = 'translateY(-20px)';
          toast.style.transition = 'all 0.3s ease';
          setTimeout(() => {
              if (toast.parentNode) toast.remove();
              if (toastContainer.children.length === 0) toastContainer.remove();
          }, 300);
      }, 3000);
  }

  // ============================================================
  // CHAT
  // ============================================================

  function initChatElements() {
      chatToggleBtn?.addEventListener('click', () => isChatOpen ? closeChat() : openChat());
      chatCloseBtn?.addEventListener('click', closeChat);
      chatInput?.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              sendChatMessage();
          }
      });
      chatSendBtn?.addEventListener('click', sendChatMessage);

      chatTargetSelect?.addEventListener('change', (e) => {
          currentChatTarget = e.target.value;
          const selectedOption = e.target.options[e.target.selectedIndex];
          if (chatTitle) {
              chatTitle.textContent = currentChatTarget === 'group'
                  ? 'Chat grupal'
                  : `Chat con ${selectedOption.textContent}`;
          }
          if (chatInput) {
              chatInput.placeholder = currentChatTarget === 'group'
                  ? 'Mensaje para todos...'
                  : `Mensaje privado para ${selectedOption.textContent}...`;
          }
      });
  }

  function updateChatTargetSelect(users) {
      if (!chatTargetSelect) return;

      const currentValue = chatTargetSelect.value;

      chatTargetSelect.innerHTML = '<option value="group">🌐 Todos (Grupal)</option>';

      users.forEach(u => {
          if (currentRole === 'participant' && u.name === myUserName) return;
          const option = document.createElement('option');
          option.value = u.userId;
          option.textContent = u.name;
          chatTargetSelect.appendChild(option);
      });

      if (currentValue !== 'group' && Array.from(chatTargetSelect.options).some(o => o.value === currentValue)) {
          chatTargetSelect.value = currentValue;
      } else {
          chatTargetSelect.value = 'group';
          currentChatTarget = 'group';
      }
  }

  function openChat() {
      if (!chatPanel) return;
      chatPanel.classList.remove('hidden');
      isChatOpen = true;
      unreadCount = 0;
      updateChatBadge();
      setTimeout(() => {
          chatInput?.focus();
          scrollChatToBottom();
      }, 300);
  }

  function closeChat() {
      if (!chatPanel) return;
      chatPanel.classList.add('hidden');
      isChatOpen = false;
  }

  function sendChatMessage() {
      if (!socket || !chatInput) return;
      const text = chatInput.value.trim();
      if (!text) return;

      if (!isHostConnected && currentRole === 'host') {
          showToast('⚠️ Aún no estás conectado', 'warning');
          return;
      }
      if (currentRole === 'participant' && !myUserName) {
          showToast('⚠️ Aún no estás conectado', 'warning');
          return;
      }

      const targetValue = chatTargetSelect?.value || 'group';

      if (targetValue === 'group') {
          socket.emit('chat-message', { text, targetType: 'group' });
      } else {
          socket.emit('chat-message', {
              text,
              targetType: 'private',
              targetUserId: parseInt(targetValue, 10)
          });
      }

      chatInput.value = '';
      chatInput.focus();
  }

  function updateChatBadge() {
      if (!chatBadge) return;
      if (unreadCount > 0) {
          chatBadge.textContent = unreadCount > 9 ? '9+' : unreadCount;
          chatBadge.style.display = 'block';
      } else {
          chatBadge.style.display = 'none';
      }
  }

  function scrollChatToBottom() {
      if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function formatTime(timestamp) {
      const date = new Date(timestamp);
      const h = date.getHours().toString().padStart(2, '0');
      const m = date.getMinutes().toString().padStart(2, '0');
      return `${h}:${m}`;
  }

  function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
  }

  function appendChatMessage(message) {
      if (!chatMessages) return;

      const welcome = chatMessages.querySelector('.chat-welcome');
      if (welcome) welcome.remove();

      const isOwn = (message.role === 'host' && currentRole === 'host' && message.sender === 'Anfitrión') ||
                    (message.role === 'participant' && message.sender === myUserName) ||
                    message.isOwn === true;
      const isSystem = message.role === 'system';
      const isPrivate = message.isPrivate === true;

      const messageDiv = document.createElement('div');
      messageDiv.className = `chat-message ${isSystem ? 'system' : (isOwn ? 'own' : 'other')}${isPrivate ? ' private' : ''}`;

      if (isSystem) {
          messageDiv.innerHTML = `
              <div class="chat-message-bubble">${escapeHtml(message.text)}</div>
          `;
      } else {
          const privateLabel = isPrivate
              ? `<span class="chat-private-label">🔒 Privado${message.targetName && !isOwn ? ` → ${escapeHtml(message.targetName)}` : ''}</span>`
              : '';
          messageDiv.innerHTML = `
              <div class="chat-message-header">
                  ${privateLabel}
                  <span class="chat-message-sender">${escapeHtml(message.sender)}</span>
                  <span class="chat-message-time">${formatTime(message.timestamp)}</span>
              </div>
              <div class="chat-message-bubble">${escapeHtml(message.text)}</div>
          `;
      }

      chatMessages.appendChild(messageDiv);
      scrollChatToBottom();

      if (!isChatOpen && !isOwn && !isSystem) {
          unreadCount++;
          updateChatBadge();
      }
  }

  function resetChat() {
      if (chatMessages) {
          chatMessages.innerHTML = `
              <div class="chat-welcome">
                  <span class="chat-welcome-icon">👋</span>
                  <p>¡Bienvenido al chat!</p>
                  <span class="chat-welcome-hint">Puedes escribir mensajes grupales o privados</span>
              </div>
          `;
      }
      if (chatTargetSelect) {
          chatTargetSelect.innerHTML = '<option value="group">🌐 Todos (Grupal)</option>';
          chatTargetSelect.value = 'group';
      }
      if (chatTitle) chatTitle.textContent = 'Chat grupal';
      if (chatInput) chatInput.placeholder = 'Escribe un mensaje...';
      currentChatTarget = 'group';
      unreadCount = 0;
      updateChatBadge();
      isChatOpen = false;
      if (chatPanel) chatPanel.classList.add('hidden');
  }

  // ============================================================
  // REDIMENSIONAR IMAGEN
  // ============================================================

  function resizeImage(file, maxWidth = 1024, maxHeight = 1024, quality = 0.8) {
      return new Promise((resolve, reject) => {
          const url = URL.createObjectURL(file);
          const img = new Image();
          img.onload = function() {
              let width = img.width, height = img.height;
              if (width > maxWidth || height > maxHeight) {
                  const ratio = Math.min(maxWidth / width, maxHeight / height);
                  width = Math.round(width * ratio);
                  height = Math.round(height * ratio);
              }
              const canvas = document.createElement('canvas');
              canvas.width = width;
              canvas.height = height;
              canvas.getContext('2d').drawImage(img, 0, 0, width, height);
              const base64 = canvas.toDataURL('image/jpeg', quality);
              URL.revokeObjectURL(url);
              resolve(base64);
          };
          img.onerror = function() {
              URL.revokeObjectURL(url);
              reject(new Error('Error al cargar la imagen'));
          };
          img.src = url;
      });
  }

  // ============================================================
  // RENDER USUARIOS
  // ============================================================

  function renderUserGrid(users) {
      if (!userGrid) return;
      userGrid.innerHTML = '';

      const todosCard = document.createElement('div');
      todosCard.className = 'user-card todos';
      todosCard.dataset.target = 'todos';
      todosCard.innerHTML = `<span class="number">👥</span><span class="label">TODOS</span>`;
      userGrid.appendChild(todosCard);

      for (let i = 1; i <= 10; i++) {
          const user = users ? users.find(u => u.userId === i) : null;
          const card = document.createElement('div');
          card.className = 'user-card';
          if (!user) card.classList.add('offline');
          card.dataset.target = `user-${i}`;
          card.innerHTML = `
              <span class="number">${i}</span>
              <span class="label">${user ? user.name : `Usuario ${i}`}</span>
          `;
          userGrid.appendChild(card);
      }

      if (currentRole === 'host' && isHostConnected) enableDropTargets();
  }

  // ============================================================
  // DRAG TÁCTIL
  // ============================================================

  function handleTouchStart(e, slideElement, slideId) {
      if (currentRole !== 'host' || !isHostConnected) return;
      const touch = e.touches[0];
      if (!touch) return;
      startX = touch.clientX;
      startY = touch.clientY;
      isMoved = false;
      draggedSlideId = slideId;
      draggedElement = slideElement;
  }

  function handleTouchMove(e) {
      if (!draggedSlideId || !draggedElement) return;
      const touch = e.touches[0];
      if (!touch) return;
      const deltaX = Math.abs(touch.clientX - startX);
      const deltaY = Math.abs(touch.clientY - startY);

      if (!isMoved && (deltaX > DRAG_THRESHOLD || deltaY > DRAG_THRESHOLD)) {
          isMoved = true;
          isDragging = true;
          const rect = draggedElement.getBoundingClientRect();
          touchOffsetX = rect.width / 2;
          touchOffsetY = rect.height / 2;

          touchClone = draggedElement.cloneNode(true);
          touchClone.className = 'touch-clone';
          const isMobile = window.innerWidth < 768;
          const cloneSize = isMobile ? 80 : 120;
          const cloneHeight = cloneSize * 0.75;

          touchClone.style.cssText = `
              position: fixed !important; width: ${cloneSize}px !important;
              height: ${cloneHeight}px !important; max-width: 120px !important;
              max-height: 90px !important; pointer-events: none !important;
              z-index: 99999 !important; opacity: 0.92 !important;
              border-radius: 12px !important; border: 3px solid #3b82f6 !important;
              background: white !important; padding: 3px !important;
              left: ${touch.clientX - touchOffsetX}px !important;
              top: ${touch.clientY - touchOffsetY}px !important;
              overflow: hidden !important;
          `;
          const cloneImg = touchClone.querySelector('img');
          if (cloneImg) cloneImg.style.cssText = 'width:100%!important;height:100%!important;object-fit:cover!important;border-radius:8px!important;';
          const cloneDelete = touchClone.querySelector('.slide-delete');
          if (cloneDelete) cloneDelete.style.display = 'none';
          document.body.appendChild(touchClone);
          draggedElement.classList.add('dragging');
          document.body.style.overflow = 'hidden';
          document.body.style.touchAction = 'none';
          document.body.classList.add('no-scroll');
      }

      if (isDragging && touchClone) {
          e.preventDefault();
          e.stopPropagation();
          touchClone.style.left = (touch.clientX - touchOffsetX) + 'px';
          touchClone.style.top = (touch.clientY - touchOffsetY) + 'px';
          document.querySelectorAll('.user-card').forEach(c => c.classList.remove('drag-over'));
          const element = document.elementFromPoint(touch.clientX, touch.clientY);
          if (element) {
              const cardElement = element.closest('.user-card');
              if (cardElement) cardElement.classList.add('drag-over');
          }
      }
  }

  function handleTouchEnd(e) {
      if (touchClone) { touchClone.remove(); touchClone = null; }
      document.querySelectorAll('.user-card').forEach(c => c.classList.remove('drag-over'));
      if (draggedElement) draggedElement.classList.remove('dragging');
      document.body.style.overflow = '';
      document.body.style.touchAction = '';
      document.body.classList.remove('no-scroll');
      if (isDragging && draggedSlideId) {
          const touch = e.changedTouches[0];
          if (touch) {
              const element = document.elementFromPoint(touch.clientX, touch.clientY);
              if (element) {
                  const cardElement = element.closest('.user-card');
                  if (cardElement) {
                      const target = cardElement.dataset.target;
                      if (target) {
                          const slide = slides.find(s => s.id === parseInt(draggedSlideId, 10));
                          if (slide) {
                              cardElement.style.animation = 'pulse 0.3s ease';
                              setTimeout(() => cardElement.style.animation = '', 300);
                              sendImageTo(target, slide.dataURL);
                          }
                      }
                  }
              }
          }
      }
      isDragging = false;
      isMoved = false;
      draggedSlideId = null;
      draggedElement = null;
  }

  function handleTouchCancel() {
      if (touchClone) { touchClone.remove(); touchClone = null; }
      document.querySelectorAll('.user-card').forEach(c => c.classList.remove('drag-over'));
      if (draggedElement) draggedElement.classList.remove('dragging');
      document.body.style.overflow = '';
      document.body.style.touchAction = '';
      document.body.classList.remove('no-scroll');
      isDragging = false; isMoved = false;
      draggedSlideId = null; draggedElement = null;
  }

  function enableDropTargets() {
      const cards = userGrid.querySelectorAll('.user-card');
      cards.forEach(card => {
          card.addEventListener('dragover', (e) => { e.preventDefault(); card.classList.add('drag-over'); });
          card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
          card.addEventListener('drop', (e) => {
              e.preventDefault();
              card.classList.remove('drag-over');
              const slideId = e.dataTransfer.getData('text/plain');
              if (!slideId) return;
              const slide = slides.find(s => s.id === parseInt(slideId, 10));
              if (!slide) return;
              sendImageTo(card.dataset.target, slide.dataURL);
          });
          card.addEventListener('touchmove', (e) => { if (isDragging) e.preventDefault(); }, { passive: false });
      });
  }

  // ============================================================
  // ENVÍO DE IMÁGENES
  // ============================================================

  function sendImageTo(target, imageData) {
      if (!socket || currentRole !== 'host' || !isHostConnected) {
          showToast('⚠️ No conectado como anfitrión', 'error');
          return;
      }
      let userId = null;
      if (target === 'todos') userId = 'todos';
      else if (target.startsWith('user-')) {
          userId = parseInt(target.split('-')[1], 10);
          if (isNaN(userId) || userId < 1 || userId > 10) return;
      } else return;
      socket.emit('send-image', { target: userId, imageData });
  }

  // ============================================================
  // RECEPCIÓN DE IMÁGENES
  // ============================================================

  function displayReceivedImage(base64, from) {
      if (currentRole !== 'participant') return;
      const fromText = from && from !== 'todos' ? `de ${from}` : 'para todos';
      participantContent.innerHTML = `
          <div style="display:flex;flex-direction:column;align-items:center;width:100%;padding:0 10px;">
            <div style="position:relative;width:100%;max-width:600px;background:white;border-radius:24px;box-shadow:0 20px 60px rgba(0,0,0,0.15);overflow:hidden;padding:12px;">
              <img src="${base64}" alt="Diapositiva" class="received-image" id="receivedImg"
                   style="width:100%;height:auto;border-radius:16px;display:block;cursor:pointer;" />
              <button class="download-btn" id="downloadBtn"
                style="position:absolute;bottom:24px;right:24px;background:rgba(255,255,255,0.95);
                backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,0.3);border-radius:50px;
                padding:12px 20px;font-weight:600;cursor:pointer;display:flex;align-items:center;
                gap:10px;font-size:0.95rem;color:#1e293b;touch-action:manipulation;">
                ⬇️ Descargar
              </button>
            </div>
            <p style="margin-top:12px;color:#64748b;font-size:0.9rem;text-align:center;">
              Imagen ${fromText} · Toca la imagen para ampliar
            </p>
          </div>
      `;

      const downloadBtn = document.getElementById('downloadBtn');
      if (downloadBtn) {
          downloadBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              downloadImage(base64);
          });
      }

      const receivedImg = document.getElementById('receivedImg');
      if (receivedImg) {
          receivedImg.style.animation = 'fadeIn 0.5s ease';
          receivedImg.addEventListener('click', (e) => {
              e.stopPropagation();
              openLightbox(base64);
          });
      }
  }

  function downloadImage(base64) {
      try {
          const link = document.createElement('a');
          link.href = base64;
          link.download = `diapositiva_${Date.now()}.png`;
          document.body.appendChild(link);
          link.click();
          setTimeout(() => link.remove(), 100);
          showToast('✅ Imagen descargada', 'success');
      } catch (e) {
          showToast('❌ Error al descargar', 'error');
      }
  }

  // ============================================================
  // DIAPOSITIVAS
  // ============================================================

  function renderSlides() {
      if (!slideGrid) return;
      slideGrid.innerHTML = '';
      if (slides.length === 0) {
          slideGrid.innerHTML = '<div class="empty-slides">No hay diapositivas. Añade imágenes.</div>';
          return;
      }
      slides.forEach(slide => {
          const slideDiv = document.createElement('div');
          slideDiv.className = 'slide-item';
          slideDiv.draggable = true;
          slideDiv.dataset.slideId = slide.id;
          slideDiv.style.touchAction = 'none';
          slideDiv.innerHTML = `
              <img src="${slide.dataURL}" alt="Diapositiva" loading="lazy" />
              <button class="slide-delete" data-id="${slide.id}">✕</button>
          `;

          slideDiv.querySelector('.slide-delete')?.addEventListener('click', (e) => {
              e.stopPropagation();
              deleteSlide(parseInt(e.target.dataset.id, 10));
          });

          slideDiv.addEventListener('click', (e) => {
              if (isDragging || isMoved) return;
              e.stopPropagation();
              openLightbox(slide.dataURL);
          });

          slideDiv.addEventListener('dragstart', (e) => {
              e.dataTransfer.setData('text/plain', slide.id);
              slideDiv.classList.add('dragging');
          });
          slideDiv.addEventListener('dragend', () => slideDiv.classList.remove('dragging'));
          slideDiv.addEventListener('touchstart', (e) => handleTouchStart(e, slideDiv, slide.id), { passive: true });
          slideDiv.addEventListener('touchmove', (e) => handleTouchMove(e), { passive: false });
          slideDiv.addEventListener('touchend', (e) => handleTouchEnd(e), { passive: true });
          slideDiv.addEventListener('touchcancel', () => handleTouchCancel(), { passive: true });
          slideGrid.appendChild(slideDiv);
      });
  }

  function deleteSlide(id) {
      const idx = slides.findIndex(s => s.id === id);
      if (idx === -1) return;
      slides.splice(idx, 1);
      renderSlides();
      showToast(`🗑️ Diapositiva eliminada`, 'info');
  }

  function addImages(files) {
      if (!files || files.length === 0) return;
      let addedCount = 0;
      const validImages = [];

      Array.from(files).forEach(file => {
          if (!file.type.startsWith('image/')) {
              showToast(`⚠️ ${file.name} no es válida`, 'warning');
              return;
          }
          const sizeMB = file.size / (1024 * 1024);
          validImages.push({ file, needsResize: sizeMB > 0.5 || file.type === 'image/png' });
      });

      if (validImages.length === 0) {
          showToast('⚠️ No hay imágenes válidas', 'warning');
          return;
      }

      validImages.forEach(({ file, needsResize }) => {
          (async () => {
              try {
                  let dataURL;
                  if (needsResize) {
                      showToast(`🔄 Redimensionando ${file.name}...`, 'info');
                      dataURL = await resizeImage(file, 1024, 1024, 0.8);
                  } else {
                      dataURL = await new Promise((resolve, reject) => {
                          const reader = new FileReader();
                          reader.onload = (e) => resolve(e.target.result);
                          reader.onerror = reject;
                          reader.readAsDataURL(file);
                      });
                  }
                  slides.push({ id: ++slideCounter, dataURL, name: file.name });
                  addedCount++;
                  if (addedCount === validImages.length) {
                      renderSlides();
                      showToast(`✅ ${addedCount} imágenes agregadas`, 'success');
                  }
              } catch (error) {
                  showToast(`❌ Error con ${file.name}`, 'error');
              }
          })();
      });
  }

  // ============================================================
  // EVENTOS UI - LANDING
  // ============================================================

  btnCreateRoom?.addEventListener('click', () => {
      initAudioContext(); // Desbloquear audio en el primer clic
      // Conectar socket si no está conectado
      if (!socket) connectSocket();
      showCreateRoomModal();
  });

  btnJoinRoom?.addEventListener('click', () => {
      initAudioContext();
      if (!socket) connectSocket();
      showJoinRoomModal();
  });

  // ============================================================
  // EVENTOS UI - CREAR SALA
  // ============================================================

  createRoomClose?.addEventListener('click', () => hideModal(createRoomOverlay));
  createRoomCancel?.addEventListener('click', () => hideModal(createRoomOverlay));
  createRoomOverlay?.addEventListener('click', (e) => {
      if (e.target === createRoomOverlay) hideModal(createRoomOverlay);
  });

  createRoomId?.addEventListener('input', (e) => {
      // Convertir a minúsculas y limpiar
      const val = e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '');
      e.target.value = val;
      clearFormError(createRoomError);
      checkCreateRoomIdExists(val);
  });

  createHostName?.addEventListener('input', () => clearFormError(createRoomError));
  createRoomName?.addEventListener('input', () => clearFormError(createRoomError));
  createPassword?.addEventListener('input', () => clearFormError(createRoomError));

  createRoomSubmit?.addEventListener('click', () => {
      initAudioContext();
      clearFormError(createRoomError);
      
      // Validar nombre del host
      const hostVal = validateNameFormat(createHostName.value, 2, 20);
      if (!hostVal.valid) {
          showFormError(createRoomError, `Nombre: ${hostVal.error}`);
          return;
      }
      
      // Validar ID de sala
      const roomIdVal = validateRoomIdFormat(createRoomId.value);
      if (!roomIdVal.valid) {
          showFormError(createRoomError, `ID: ${roomIdVal.error}`);
          return;
      }
      
      // Validar nombre de la sala
      const roomNameVal = validateNameFormat(createRoomName.value, 2, 40);
      if (!roomNameVal.valid) {
          showFormError(createRoomError, `Nombre de sala: ${roomNameVal.error}`);
          return;
      }
      
      // Validar contraseña
      const passwordVal = validatePasswordFormat(createPassword.value);
      if (!passwordVal.valid) {
          showFormError(createRoomError, `Contraseña: ${passwordVal.error}`);
          return;
      }
      
      // Enviar al servidor
      showLoading('Creando sala...');
      
      // Asegurar conexión
      if (!socket || !socket.connected) {
          if (!socket) connectSocket();
          // Esperar a que se conecte
          setTimeout(() => {
              if (socket && socket.connected) {
                  socket.emit('create-room', {
                      hostName: hostVal.cleanName,
                      roomId: roomIdVal.cleanId,
                      roomName: roomNameVal.cleanName,
                      password: passwordVal.cleanPassword
                  });
              } else {
                  hideLoading();
                  showFormError(createRoomError, 'Sin conexión al servidor');
              }
          }, 500);
      } else {
          socket.emit('create-room', {
              hostName: hostVal.cleanName,
              roomId: roomIdVal.cleanId,
              roomName: roomNameVal.cleanName,
              password: passwordVal.cleanPassword
          });
      }
  });

  // ============================================================
  // EVENTOS UI - UNIRSE A SALA
  // ============================================================

  joinRoomClose?.addEventListener('click', () => hideModal(joinRoomOverlay));
  joinRoomCancel?.addEventListener('click', () => hideModal(joinRoomOverlay));
  joinRoomOverlay?.addEventListener('click', (e) => {
      if (e.target === joinRoomOverlay) hideModal(joinRoomOverlay);
  });

  joinRoomId?.addEventListener('input', (e) => {
      const val = e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '');
      e.target.value = val;
      clearFormError(joinRoomError);
      checkRoomIdExists(val);
  });

  joinUserName?.addEventListener('input', () => clearFormError(joinRoomError));
  joinPassword?.addEventListener('input', () => clearFormError(joinRoomError));

  joinRoomSubmit?.addEventListener('click', () => {
      initAudioContext();
      clearFormError(joinRoomError);
      
      // Validar nombre
      const nameVal = validateNameFormat(joinUserName.value, 2, 20);
      if (!nameVal.valid) {
          showFormError(joinRoomError, `Nombre: ${nameVal.error}`);
          return;
      }
      
      // Validar ID de sala
      const roomIdVal = validateRoomIdFormat(joinRoomId.value);
      if (!roomIdVal.valid) {
          showFormError(joinRoomError, `ID: ${roomIdVal.error}`);
          return;
      }
      
      // Validar contraseña
      const passwordVal = validatePasswordFormat(joinPassword.value);
      if (!passwordVal.valid) {
          showFormError(joinRoomError, `Contraseña: ${passwordVal.error}`);
          return;
      }
      
      // Enviar al servidor
      showLoading('Uniéndose a la sala...');
      
      if (!socket || !socket.connected) {
          if (!socket) connectSocket();
          setTimeout(() => {
              if (socket && socket.connected) {
                  socket.emit('join-room', {
                      userName: nameVal.cleanName,
                      roomId: roomIdVal.cleanId,
                      password: passwordVal.cleanPassword
                  });
              } else {
                  hideLoading();
                  showFormError(joinRoomError, 'Sin conexión al servidor');
              }
          }, 500);
      } else {
          socket.emit('join-room', {
              userName: nameVal.cleanName,
              roomId: roomIdVal.cleanId,
              password: passwordVal.cleanPassword
          });
      }
  });

  // ============================================================
  // EVENTOS UI - APP
  // ============================================================

  btnExit?.addEventListener('click', () => {
      if (confirm('¿Estás seguro de que quieres salir?')) {
          showLanding();
      }
  });

  addImagesBtn?.addEventListener('click', () => fileInput.click());
  fileInput?.addEventListener('change', (e) => {
      if (e.target.files?.length > 0) {
          addImages(e.target.files);
          fileInput.value = '';
      }
  });

  // ============================================================
  // EVENTOS UI - PANEL DE INFO DE LA SALA
  // ============================================================

  copyRoomCodeBtn?.addEventListener('click', () => {
      if (currentRoom) {
          copyToClipboard(currentRoom.roomId, 'Código copiado');
      }
  });

  toggleRoomPasswordBtn?.addEventListener('click', () => {
      hostPasswordVisible = !hostPasswordVisible;
      updatePasswordDisplay();
  });

  copyRoomLinkBtn?.addEventListener('click', () => {
      if (currentRoom) {
          const link = `${window.location.origin}${window.location.pathname}?room=${currentRoom.roomId}`;
          copyToClipboard(link, 'Enlace copiado');
      }
  });

  closeRoomBtn?.addEventListener('click', () => {
      if (!currentRoom) return;
      if (confirm(`¿Cerrar la sala "${currentRoom.roomName}"?\n\nTodos los participantes serán desconectados.`)) {
          if (socket) {
              socket.emit('close-room');
              playCloseRoomSound();
          }
      }
  });

  // ============================================================
  // PREVENCIÓN DE COMPORTAMIENTOS POR DEFECTO
  // ============================================================

  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => e.preventDefault());

  document.addEventListener('touchmove', (e) => {
      if (isDragging) { e.preventDefault(); e.stopPropagation(); }
  }, { passive: false });

  document.addEventListener('contextmenu', (e) => {
      if (e.target.closest('.slide-item') || e.target.closest('.user-card')) e.preventDefault();
  });

  // ============================================================
  // ESTILOS DINÁMICOS
  // ============================================================

  (function addDynamicStyles() {
      const style = document.createElement('style');
      style.textContent = `
          @keyframes fadeIn { from { opacity:0; transform:scale(0.95); } to { opacity:1; transform:scale(1); } }
          @keyframes slideUp { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }
          @keyframes pulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.08)} }
          .slide-item.dragging { transform:scale(0.95); opacity:0.6; border-color:#3b82f6; }
          .user-card.drag-over { border-color:#3b82f6 !important; background:#eff6ff !important; transform:scale(1.08) !important; }
          .user-card.todos.drag-over { background:#1e40af !important; }
          .no-scroll { overflow:hidden !important; touch-action:none !important; position:fixed !important; width:100% !important; height:100% !important; }
      `;
      document.head.appendChild(style);
  })();

  // ============================================================
  // INICIALIZACIÓN
  // ============================================================

  console.log('🚀 Sala de Diapositivas v2.0 - Iniciando...');
  console.log(`📱 Dispositivo: ${window.innerWidth < 768 ? 'Móvil' : 'Escritorio'}`);

  // Configurar
  loadTheme();
  initThemeButtons();
  initChatElements();
  createLightbox();
  setupKeyboardFix();
  showLanding();

  // Verificar si hay un room en la URL
  if (checkUrlForRoomId()) {
      console.log('🔗 Esperando para unirse a sala desde URL...');
  }

  // Conectar socket automáticamente para verificación de salas
  connectSocket();

  console.log('✅ Inicialización completa');

})();