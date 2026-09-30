/**
 * CORE.JS - RUTA DEL CAMBIO PORTLAND
 * Centraliza la carga de datos, gestión de sesión y lógica de roles.
 * Seguridad: La información de usuarios reside exclusivamente en el backend de Google Apps Script.
 */

const PORTLAND_WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbxcp3HlO-f4tK8h5pcQMaBPqecOAH-4UY2lfRcUkEl8oSQYTPqKyoHWm5ksop3EMRKKmQ/exec';

/**
 * Formatea el nombre de manera estandarizada (Solo Nombre y Apellido).
 */
function formatName(user) {
    if (!user) return '---';
    return user['Nombre Tripulante'] || user['Nombre Tripultante'] || 'Sin Nombre';
}

/**
 * Formatea el saludo del usuario logueado incluyendo su alias si existe.
 * Formato: Nombre "Alias" Apellido
 */
function formatGreeting(user) {
    if (!user) return '---';
    const fullName = user['Nombre Tripulante'] || user['Nombre Tripultante'] || '';
    const profile = getProfile();
    const alias = (profile && profile.aliasUsuario) ? profile.aliasUsuario : '';

    if (!alias) return fullName;

    const parts = fullName.split(' ');
    if (parts.length > 1) {
        return `${parts[0]} "${alias}" ${parts.slice(1).join(' ')}`;
    }
    return `${fullName} "${alias}"`;
}

/**
 * Obtiene el emoji de la bandera basado en el país.
 */
function getFlag(country) {
    const table = {
        'Chile': '🇨🇱',
        'Perú': '🇵🇪',
        'Colombia': '🇨🇴'
    };
    return table[country] || '🏴‍☠️';
}

/**
 * Recupera un usuario de la caché local del navegador (localStorage) para respuesta instantánea (0ms).
 */
function getLocalCachedUser(email) {
    if (!email) return null;
    const clean = email.trim().toLowerCase();
    try {
        const raw = localStorage.getItem('portland_cached_user_' + clean);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null;
    }
}

/**
 * Guarda el perfil en la caché local del navegador y en la lista de tripulantes recordados.
 */
function saveLocalCachedUser(email, responseData) {
    if (!email || !responseData) return;
    const clean = email.trim().toLowerCase();
    try {
        localStorage.setItem('portland_cached_user_' + clean, JSON.stringify(responseData));
        
        let crewList = [];
        try {
            crewList = JSON.parse(localStorage.getItem('portland_remembered_crew') || '[]');
        } catch(e) {}
        
        const userObj = responseData.user || responseData;
        const existingIdx = crewList.findIndex(c => (c.email || '').toLowerCase() === clean);
        const crewEntry = {
            email: clean,
            name: formatName(userObj),
            role: responseData.role || userObj.Rango || 'Tripulante',
            avatar: responseData.avatar || userObj.Avatar || '',
            alias: responseData.alias || userObj.Alias || '',
            hasVisa: !!(responseData.hasVisa || (userObj['Visa de Zarpe'] && userObj['Visa de Zarpe'].toString().toLowerCase() === 'si')),
            lastLogin: Date.now()
        };
        
        if (existingIdx >= 0) {
            crewList[existingIdx] = crewEntry;
        } else {
            crewList.unshift(crewEntry);
        }
        
        // Mantener hasta 5 tripulantes frecuentes en este equipo
        crewList = crewList.slice(0, 5);
        localStorage.setItem('portland_remembered_crew', JSON.stringify(crewList));
    } catch (e) {}
}

/**
 * Retorna los tripulantes recordados en este equipo.
 */
function getRememberedCrew() {
    try {
        return JSON.parse(localStorage.getItem('portland_remembered_crew') || '[]');
    } catch(e) {
        return [];
    }
}

/**
 * Elimina un tripulante de los recordados.
 */
function removeRememberedCrew(email) {
    if (!email) return;
    const clean = email.trim().toLowerCase();
    try {
        localStorage.removeItem('portland_cached_user_' + clean);
        let crewList = getRememberedCrew().filter(c => (c.email || '').toLowerCase() !== clean);
        localStorage.setItem('portland_remembered_crew', JSON.stringify(crewList));
    } catch(e) {}
}

/**
 * Consulta segura al backend de Google Apps Script para validar e identificar un usuario en Login.
 * Soporta AbortSignal para cancelar peticiones intermedias mientras se escribe.
 * NO descarga la base de usuarios completa en el navegador; solo recupera la ficha del tripulante autenticado.
 */
async function getUserFromBackend(email, signal = null, bypassCache = false) {
    if (!email) return { success: false, error: 'Email requerido' };
    try {
        const cleanEmail = email.trim().toLowerCase();
        let url = `${PORTLAND_WEBHOOK_URL}?action=getUser&email=${encodeURIComponent(cleanEmail)}`;
        if (bypassCache) url += '&fresh=1';
        
        const fetchOptions = {};
        if (signal) fetchOptions.signal = signal;

        const res = await fetch(url, fetchOptions);
        if (!res.ok) throw new Error('No se pudo conectar a la bitácora de navegación.');
        const data = await res.json();

        if (data && data.success) {
            saveLocalCachedUser(cleanEmail, data);
        }
        return data;
    } catch (err) {
        if (err.name === 'AbortError') {
            return { success: false, aborted: true };
        }
        console.error('Error al consultar usuario en backend:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Carga los datos protegidos desde Google Apps Script según la sesión activa y el rol del usuario.
 * Utiliza almacenamiento en caché (sessionStorage) para una navegación ultra rápida entre páginas.
 */
async function loadAppData(forceRefresh = false) {
    try {
        const sessionUserStr = localStorage.getItem('portland_user');
        if (!sessionUserStr) return [];
        const sessionUser = JSON.parse(sessionUserStr);
        const email = (sessionUser.Email || '').toLowerCase().trim();
        if (!email) return [];

        // Detectar si estamos en modo "viewAs" (ej: Almirante viendo panel de un Capitán)
        const urlParams = new URLSearchParams(window.location.search);
        const viewAs = urlParams.get('viewAs') || '';

        const cacheKey = `portland_appdata_${email}_${viewAs}`;
        const cacheTimeKey = `portland_appdata_time_${email}_${viewAs}`;
        const CACHE_TTL_MS = 300000; // 5 minutos (300.000 ms) para evitar recargas continuas entre pantallas
        
        // Si no se fuerza refresco y la caché es reciente (< 5 segundos), usarla
        if (!forceRefresh) {
            const cachedTime = parseInt(sessionStorage.getItem(cacheTimeKey) || '0', 10);
            if (Date.now() - cachedTime < CACHE_TTL_MS) {
                const cached = sessionStorage.getItem(cacheKey);
                if (cached) {
                    try {
                        const cachedData = JSON.parse(cached);
                        if (Array.isArray(cachedData) && cachedData.length > 0) {
                            return cachedData;
                        }
                    } catch (e) {}
                }
            }
        }

        const url = `${PORTLAND_WEBHOOK_URL}?action=getAppData&email=${encodeURIComponent(email)}${viewAs ? '&viewAs=' + encodeURIComponent(viewAs) : ''}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error('No se pudo conectar al libro de navegación en Google Apps Script.');
        const result = await response.json();

        if (!result.success || !Array.isArray(result.users)) {
            throw new Error(result.error || 'Respuesta inválida del servidor');
        }

        const data = result.users;

        // Normalizar estados de visa y sincronizar memoria local
        const visas = ['Visa de Zarpe', 'Visa de Navegacion', 'Visa de Aduanas', 'Visa de Descarga', 'Visa de Transito'];
        data.forEach(user => {
            // Sincronizar variantes singular/plural de Visa de Aduanas
            const aduanasVal = user['Visa de Aduanas'] !== undefined ? user['Visa de Aduanas'] : user['Visa de Aduana'];
            if (aduanasVal !== undefined) {
                user['Visa de Aduanas'] = aduanasVal;
                user['Visa de Aduana'] = aduanasVal;
            }
            const fechaAduanas = user['Fecha Visa de Aduanas'] !== undefined ? user['Fecha Visa de Aduanas'] : user['Fecha Visa de Aduana'];
            if (fechaAduanas !== undefined) {
                user['Fecha Visa de Aduanas'] = fechaAduanas;
                user['Fecha Visa de Aduana'] = fechaAduanas;
            }

            // Normalizar a "Si" si viene como "SI", "si", "Si"
            visas.forEach(visa => {
                if (user[visa] && user[visa].toString().toLowerCase() === 'si') {
                    user[visa] = 'Si';
                }
            });

            // Normalizar roles especiales
            user.Tester = (user.Tester && user.Tester.trim().toUpperCase() === 'SI') ? 'SI' : 'NO';
            user.Trainer = (user.Trainer && user.Trainer.trim().toUpperCase() === 'SI') ? 'SI' : 'NO';
            user['Trainer a Cargo'] = (user['Trainer a Cargo'] || '').trim();

            if (localStorage.getItem('portland_visa1_accepted_' + (user.Email || '').toLowerCase().trim())) {
                user['Visa de Zarpe'] = 'Si';
            }
        });

        // REFRESCAR SESIÓN: Si hay un usuario logueado, actualizamos su objeto en localStorage 
        const freshUser = data.find(u => (u.Email || '').toLowerCase().trim() === email);
        if (freshUser) {
            localStorage.setItem('portland_user', JSON.stringify(freshUser));
        }
        
        // Guardar en caché de sesión con marca de tiempo
        try {
            sessionStorage.setItem(cacheKey, JSON.stringify(data));
            sessionStorage.setItem(cacheTimeKey, Date.now().toString());
        } catch (e) {}

        return data;
    } catch (error) {
        console.error('Error al cargar datos desde Apps Script:', error);
        const sessionUserStr = localStorage.getItem('portland_user');
        return sessionUserStr ? [JSON.parse(sessionUserStr)] : [];
    }
}

/**
 * Identifica el rol del usuario basado en la columna "Rango".
 */
function getUserRole(email, allData) {
    const userRow = allData.find(u => u.Email.toLowerCase() === email.toLowerCase());
    if (!userRow) return null;
    return userRow['Rango']; // Almirante, Capitan, Tripulante
}

/**
 * Guarda la sesión del usuario.
 */
function saveSession(user, role) {
    localStorage.setItem('portland_user', JSON.stringify(user));
    localStorage.setItem('portland_role', role);
}

/**
 * Borra la sesión (Logout).
 */
function logout() {
    localStorage.removeItem('portland_user');
    localStorage.removeItem('portland_role');
    // Eliminar también claves globales heredadas
    localStorage.removeItem('portland_aliasUsuario');
    localStorage.removeItem('portland_avatarUsuario');
    window.location.href = 'index.html?logout=true';
}

/**
 * Guarda el perfil personalizado (Alias y Avatar) vinculado estrictamente al email del tripulante.
 */
function saveProfile(alias, avatar, email = null) {
    let targetEmail = email ? email.toLowerCase().trim() : null;
    if (!targetEmail) {
        const userStr = localStorage.getItem('portland_user');
        const user = userStr ? JSON.parse(userStr) : null;
        if (user && user.Email) {
            targetEmail = user.Email.toLowerCase().trim();
        }
    }
    
    // NUNCA guardar si no hay email asociado al usuario actual
    if (!targetEmail) return;

    const suffix = '_' + targetEmail;
    const cleanAlias = (alias !== null && alias !== undefined) ? alias.toString().trim() : '';
    
    if (cleanAlias) {
        localStorage.setItem('portland_aliasUsuario' + suffix, cleanAlias);
    }
    if (avatar) {
        localStorage.setItem('portland_avatarUsuario' + suffix, avatar);
    }

    // Sincronizar en segundo plano con la hoja Usuarios en el backend solo si hay un alias real
    if (cleanAlias && typeof PORTLAND_WEBHOOK_URL !== 'undefined' && PORTLAND_WEBHOOK_URL) {
        try {
            fetch(PORTLAND_WEBHOOK_URL, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: targetEmail,
                    alias: cleanAlias,
                    avatar: avatar || '',
                    action: 'UPDATE_PROFILE'
                })
            }).catch(() => {});
        } catch (e) {}
    }
}

/**
 * Recupera el perfil personalizado estrictamente para el email solicitado o el usuario en sesión.
 * Función pura: no escribe en localStorage ni dispara sincronizaciones secundarias.
 */
function getProfile(email = null) {
    let targetEmail = email ? email.toLowerCase().trim() : null;
    if (!targetEmail) {
        const userStr = localStorage.getItem('portland_user');
        const user = userStr ? JSON.parse(userStr) : null;
        if (user && user.Email) {
            targetEmail = user.Email.toLowerCase().trim();
        }
    }

    if (!targetEmail) {
        return {
            aliasUsuario: '',
            avatarUsuario: 'img/Avatar01.webp'
        };
    }

    const suffix = '_' + targetEmail;
    let alias = (localStorage.getItem('portland_aliasUsuario' + suffix) || '').trim();
    let avatar = localStorage.getItem('portland_avatarUsuario' + suffix);
    
    // Solo si el usuario en sesión activa coincide EXACTAMENTE con el email solicitado, recuperar su Alias
    if (!alias) {
        const userStr = localStorage.getItem('portland_user');
        const user = userStr ? JSON.parse(userStr) : null;
        if (user && user.Email && user.Email.toLowerCase().trim() === targetEmail && user.Alias) {
            alias = user.Alias.trim();
        }
    }

    // Avatar por defecto náutico si no tiene uno asignado
    if (!avatar || (!avatar.includes('.webp') && !avatar.includes('.png') && !avatar.includes('.jpg'))) {
        avatar = 'img/Avatar01.webp';
    }
    
    // Migración de avatar antiguo
    if (avatar && avatar.includes('✈️')) {
        const role = localStorage.getItem('portland_role');
        avatar = (role === 'Capitan' || role === 'Almirante') ? 'img/Avatar03.webp' : 'img/Avatar01.webp';
    }

    return {
        aliasUsuario: alias || '',
        avatarUsuario: avatar
    };
}

/**
 * Verifica si hay una sesión activa.
 */
function checkSession() {
    const user = localStorage.getItem('portland_user');
    const role = localStorage.getItem('portland_role');
    if (!user || !role) {
        if (!window.location.href.includes('index.html')) {
            window.location.href = 'index.html';
        }
    }
    return user ? JSON.parse(user) : null;
}

/**
 * Parsea el estado y porcentaje de una Visa (acepta 'Si', 'SI', '1', '1.0', '100%', 1, decimales 0.5 = 50%, etc.)
 * @param {*} val Valor proveniente de la hoja o backend
 * @returns {{ pct: number, isDone: boolean }}
 */
function parseVisaStatus(val) {
    if (val === null || val === undefined) return { pct: 0, isDone: false };
    const str = val.toString().trim().toLowerCase();
    if (!str || str === 'no' || str === '0' || str === '0%') return { pct: 0, isDone: false };
    
    if (str === 'si' || str === 'sí' || str === 'true' || str === 'completado') {
        return { pct: 100, isDone: true };
    }
    
    // Si contiene '%' (ej: "100%", "75%")
    if (str.includes('%')) {
        const num = parseFloat(str.replace('%', '').trim());
        if (!isNaN(num)) {
            const pct = Math.min(100, Math.max(0, Math.round(num)));
            return { pct: pct, isDone: pct >= 100 };
        }
    }
    
    // Si es un número decimal o entero (ej: 1 o "1" proveniente de Google Sheets para 100%, 0.5 para 50%, o 100)
    const num = parseFloat(str);
    if (!isNaN(num)) {
        // En Google Sheets, un formato de porcentaje 100% se exporta como 1 (o 1.0), y 50% como 0.5
        if (num > 0 && num <= 1) {
            const pct = Math.round(num * 100);
            return { pct: pct, isDone: pct >= 100 };
        }
        const pct = Math.min(100, Math.max(0, Math.round(num)));
        return { pct: pct, isDone: pct >= 100 };
    }
    
    return { pct: 0, isDone: false };
}

/**
 * Genera el "Muro de la Victoria" filtrado.
 */
function getLatestAchievements(allData, filterCaptainEmail = null) {
    const visas = [
        'Visa de Zarpe', 
        'Visa de Navegacion', 
        'Visa de Aduanas', 
        'Visa de Descarga', 
        'Visa de Transito'
    ];
    
    let achievements = [];

    allData.forEach(user => {
        // Filtro por capitán si se provee (se usa el email del capitán)
        if (filterCaptainEmail && user['Capitan a Cargo'] !== filterCaptainEmail) {
            return;
        }

        const badgeNames = {
            'Visa de Zarpe': 'Insignia Argonauta',
            'Visa de Navegacion': 'Insignia Navegante',
            'Visa de Aduanas': 'Insignia Estratega',
            'Visa de Descarga': 'Insignia Timonel',
            'Visa de Transito': 'Insignia Ulises'
        };

        visas.forEach(visa => {
            const val = user[visa];
            const status = parseVisaStatus(val);
            if (status.isDone) {
                const dateKey = `Fecha ${visa}`;
                achievements.push({
                    name: formatName(user),
                    visa: badgeNames[visa] || visa,
                    date: user[dateKey] || 'Reciente',
                    avatar: user['Rango'] === 'Capitan' ? '👮‍♂️' : (user['Rango'] === 'Almirante' ? '💼' : '👨‍💼')
                });
            }
        });
    });

    return achievements.reverse().slice(0, 5);
}

/**
 * Calcula el porcentaje de Visas logradas sobre el total posible.
 * @param {Array} users - Lista de usuarios.
 * @param {Array} visas - Nombres de las visas a considerar.
 */
function calculateProgressPercent(users, visas) {
    if (!users || users.length === 0) return 0;
    let totalProgress = 0;
    let totalPossible = users.length * visas.length * 100;
    users.forEach(u => {
        visas.forEach(v => {
            let val = u[v];
            if (val === undefined && v.includes('Aduanas')) val = u['Visa de Aduana'];
            if (val === undefined && v.includes('Aduana')) val = u['Visa de Aduanas'];
            const status = parseVisaStatus(val);
            totalProgress += status.pct;
        });
    });
    return totalPossible ? Math.round((totalProgress / totalPossible) * 100) : 0;
}

/**
 * Calcula los días faltantes para el Próximo Destino según el calendario:
 * 1. Hasta el 02 de Noviembre de 2026.
 * 2. Después del 02 de Noviembre de 2026, cuenta hacia el 02 de Diciembre de 2026.
 * 3. Después del 02 de Diciembre de 2026, cuenta hacia el 04 de Enero de 2027.
 */
function getDaysToGoLive() {
    const today = new Date();
    // Normalizar a inicio del día (medianoche local)
    const current = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    const milestone1 = new Date(2026, 10, 2); // 02 de Noviembre de 2026
    const milestone2 = new Date(2026, 11, 2); // 02 de Diciembre de 2026
    const milestone3 = new Date(2027, 0, 4);  // 04 de Enero de 2027

    let targetDate = milestone1;

    if (current > milestone2) {
        targetDate = milestone3;
    } else if (current > milestone1) {
        targetDate = milestone2;
    }

    const diffMs = targetDate - current;
    const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
    return days > 0 ? days : 0;
}

// Alias para claridad de propósito
const getDaysToNextDestination = getDaysToGoLive;

/**
 * Obtiene todos los subordinados de manera recursiva (transitiva).
 * @param {string} email - Email del superior.
 * @param {Array} allData - Todos los datos disponibles.
 */
function getTransitiveSubordinates(email, allData) {
    if (!email) return [];
    let result = [];
    const direct = allData.filter(u => (u['Capitan a Cargo'] || '').toLowerCase() === email.toLowerCase() && u.Email.toLowerCase() !== email.toLowerCase());
    
    result.push(...direct);
    
    direct.forEach(sub => {
        // Solo buscamos más abajo si el subordinado no es un tripulante raso (optimización)
        if (sub['Rango'] !== 'Tripulante') {
            result.push(...getTransitiveSubordinates(sub.Email, allData));
        }
    });
    
    // Eliminar duplicados
    const unique = [];
    const emails = new Set();
    result.forEach(u => {
        if (u.Email && !emails.has(u.Email.toLowerCase())) {
            emails.add(u.Email.toLowerCase());
            unique.push(u);
        }
    });
    return unique;
}

/**
 * ============================================================================
 * RUTAS ESPECIALES: TESTER, TRAINER Y EVALUACIÓN DE USUARIOS NORMALES
 * ============================================================================
 */

function isTester(user) {
    return !!(user && user.Tester && user.Tester.toUpperCase() === 'SI');
}

function isTrainer(user) {
    return !!(user && user.Trainer && user.Trainer.toUpperCase() === 'SI');
}

function getTrainerForUser(user, allData) {
    if (!user || !user['Trainer a Cargo'] || !allData) return null;
    const trainerEmail = user['Trainer a Cargo'].trim().toLowerCase();
    return allData.find(u => (u.Email || '').trim().toLowerCase() === trainerEmail) || null;
}

function getAssignedUsersForTrainer(trainerEmail, allData) {
    if (!trainerEmail || !allData) return [];
    const tEmail = trainerEmail.trim().toLowerCase();
    return allData.filter(u => (u['Trainer a Cargo'] || '').trim().toLowerCase() === tEmail);
}

/**
 * Envío asíncrono a Google Apps Script Webhook (Registro2 / Emails)
 */
async function sendWebhookEvent(payload) {
    try {
        await fetch(PORTLAND_WEBHOOK_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        return { success: true };
    } catch (err) {
        console.warn('Advertencia al enviar al webhook (se mantendrá en memoria local):', err);
        return { success: false, error: err };
    }
}

/**
 * Guarda la confirmación de asistencia a la capacitación de Tester
 */
async function saveTesterTraining(email, nombre) {
    const key = 'portland_tester_training_' + email.toLowerCase().trim();
    const now = new Date();
    const fecha = now.toLocaleDateString('es-CL') + ' ' + now.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
    const record = { fecha, timestamp: Date.now() };
    localStorage.setItem(key, JSON.stringify(record));

    // Envío en segundo plano al Webhook para Registro2
    sendWebhookEvent({
        action: 'TESTER_CAPACITACION',
        email: email,
        nombre: nombre,
        rol: 'Tester',
        detalle: 'Capacitación de Tester Asistida',
        observaciones: 'Asistencia confirmada por el tripulante en la plataforma'
    });

    return record;
}

/**
 * Guarda la entrega de un Ciclo de Test con su archivo y observaciones.
 * Envía la planilla vía Webhook por correo a gsalinas@pjportland.cl y al usuario.
 */
async function saveTesterCycle(email, nombre, cycleNum, file, observaciones = '') {
    const key = `portland_tester_cycle_${cycleNum}_` + email.toLowerCase().trim();
    const now = new Date();
    const fecha = now.toLocaleDateString('es-CL') + ' ' + now.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });

    // Convertir archivo a Base64 si viene presente
    let fileBase64 = null;
    let fileName = '';
    let fileMimeType = '';

    if (file) {
        fileName = file.name;
        fileMimeType = file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        fileBase64 = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                // Extraer únicamente la cadena base64 después de la coma
                const result = reader.result;
                const base64Index = result.indexOf(',') + 1;
                resolve(result.substring(base64Index));
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    const record = {
        fecha,
        fileName,
        observaciones,
        timestamp: Date.now()
    };
    localStorage.setItem(key, JSON.stringify(record));

    // Notificar al Webhook (dispara correo a gsalinas@pjportland.cl y respaldo al usuario)
    await sendWebhookEvent({
        action: `TESTER_CICLO_${cycleNum}`,
        email: email,
        nombre: nombre,
        rol: 'Tester',
        detalle: `Ciclo ${cycleNum} de Pruebas`,
        fileName: fileName,
        fileMimeType: fileMimeType,
        fileBase64: fileBase64,
        observaciones: observaciones
    });

    return record;
}

/**
 * Obtiene el estado consolidado de la Ruta de Tester para un email
 */
function getTesterStatus(email) {
    if (!email) return { training: null, cycle1: null, cycle2: null, cycle3: null, completedCount: 0, percent: 0 };
    const e = email.toLowerCase().trim();
    const trainingStr = localStorage.getItem('portland_tester_training_' + e);
    const cycle1Str = localStorage.getItem('portland_tester_cycle_1_' + e);
    const cycle2Str = localStorage.getItem('portland_tester_cycle_2_' + e);
    const cycle3Str = localStorage.getItem('portland_tester_cycle_3_' + e);

    const training = trainingStr ? JSON.parse(trainingStr) : null;
    const cycle1 = cycle1Str ? JSON.parse(cycle1Str) : null;
    const cycle2 = cycle2Str ? JSON.parse(cycle2Str) : null;
    const cycle3 = cycle3Str ? JSON.parse(cycle3Str) : null;

    let completed = 0;
    if (training) completed++;
    if (cycle1) completed++;
    if (cycle2) completed++;
    if (cycle3) completed++;

    return {
        training,
        cycle1,
        cycle2,
        cycle3,
        completedCount: completed,
        totalMilestones: 4,
        percent: Math.round((completed / 4) * 100)
    };
}

/**
 * Guarda el registro de una Sesión impartida por el Trainer
 */
async function saveTrainerSession(email, nombre, sessionNum, tema, observaciones = '') {
    const key = `portland_trainer_session_${sessionNum}_` + email.toLowerCase().trim();
    const now = new Date();
    const fecha = now.toLocaleDateString('es-CL') + ' ' + now.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });

    const record = {
        sessionNum,
        tema,
        observaciones,
        fecha,
        timestamp: Date.now()
    };
    localStorage.setItem(key, JSON.stringify(record));

    await sendWebhookEvent({
        action: `TRAINER_SESION_${sessionNum}`,
        email: email,
        nombre: nombre,
        rol: 'Trainer',
        detalle: `Sesión ${sessionNum}: ${tema}`,
        observaciones: observaciones
    });

    return record;
}

/**
 * Obtiene el estado del Trainer (sesiones impartidas y alumnos a cargo con sus evaluaciones)
 */
function getTrainerStatus(email, allData) {
    if (!email) return { session1: null, session2: null, sessionCount: 0, assignedUsers: [] };
    const e = email.toLowerCase().trim();
    const s1Str = localStorage.getItem('portland_trainer_session_1_' + e);
    const s2Str = localStorage.getItem('portland_trainer_session_2_' + e);

    const session1 = s1Str ? JSON.parse(s1Str) : null;
    const session2 = s2Str ? JSON.parse(s2Str) : null;

    let sessionCount = 0;
    if (session1) sessionCount++;
    if (session2) sessionCount++;

    const assignedUsers = getAssignedUsersForTrainer(e, allData).map(u => {
        const uEmail = u.Email.toLowerCase().trim();
        const eval1Str = localStorage.getItem('portland_normal_eval_1_' + uEmail);
        const eval2Str = localStorage.getItem('portland_normal_eval_2_' + uEmail);
        return {
            user: u,
            eval1: eval1Str ? JSON.parse(eval1Str) : null,
            eval2: eval2Str ? JSON.parse(eval2Str) : null
        };
    });

    return {
        session1,
        session2,
        sessionCount,
        percent: Math.round((sessionCount / 2) * 100),
        assignedUsers
    };
}

/**
 * Guarda la evaluación del Usuario Normal sobre la sesión de su Trainer
 */
async function saveNormalUserEval(email, nombre, trainerEmail, sessionNum, evaluacion, requiereRefuerzo, observaciones = '', nivel = '') {
    const key = `portland_normal_eval_${sessionNum}_` + email.toLowerCase().trim();
    const now = new Date();
    const fecha = now.toLocaleDateString('es-CL') + ' ' + now.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });

    const record = {
        sessionNum,
        trainerEmail,
        evaluacion,
        nivel: nivel || '',
        requiereRefuerzo: !!requiereRefuerzo,
        observaciones,
        fecha,
        timestamp: Date.now()
    };
    localStorage.setItem(key, JSON.stringify(record));

    await sendWebhookEvent({
        action: 'NORMAL_EVAL_TRAINING',
        email: email,
        nombre: nombre,
        rol: 'Tripulante',
        trainerEmail: trainerEmail,
        detalle: `Evaluación Sesión ${sessionNum} con Trainer: ${trainerEmail}`,
        evaluacion: evaluacion,
        requiereRefuerzo: !!requiereRefuerzo,
        observaciones: observaciones
    });

    return record;
}

function getNormalUserEval(email, sessionNum) {
    if (!email) return null;
    const key = `portland_normal_eval_${sessionNum}_` + email.toLowerCase().trim();
    const str = localStorage.getItem(key);
    return str ? JSON.parse(str) : null;
}

// Exportar globalmente
window.Core = {
    loadAppData,
    getUserFromBackend,
    getUserRole,
    saveSession,
    checkSession,
    logout,
    getLatestAchievements,
    formatName,
    formatGreeting,
    getFlag,
    calculateProgressPercent,
    parseVisaStatus,
    getDaysToGoLive,
    getDaysToNextDestination,
    saveProfile,
    getProfile,
    getTransitiveSubordinates,
    // Nuevos métodos para Rutas Especiales
    WEBHOOK_URL: PORTLAND_WEBHOOK_URL,
    isTester,
    isTrainer,
    getTrainerForUser,
    getAssignedUsersForTrainer,
    sendWebhookEvent,
    saveTesterTraining,
    saveTesterCycle,
    getTesterStatus,
    saveTrainerSession,
    getTrainerStatus,
    saveNormalUserEval,
    getNormalUserEval,
    // Métodos de optimización de Login y Caché Local
    getLocalCachedUser,
    saveLocalCachedUser,
    getRememberedCrew,
    removeRememberedCrew
};

