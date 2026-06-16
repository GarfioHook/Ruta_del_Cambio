/**
 * CORE.JS - RUTA DEL CAMBIO PORTLAND
 * Centraliza la carga de datos, gestión de sesión y lógica de roles.
 */

const CSV_PATH = './Avance_RUTA.csv';

/**
 * Formatea el nombre de manera estandarizada con su alias.
 * Ejemplo: Leandro "Delfín" Jara
 */

/**
 * Formatea el nombre de manera estandarizada (Solo Nombre y Apellido).
 */
function formatName(user) {
    if (!user) return '---';
    return user['Nombre Tripultante'] || 'Sin Nombre';
}

/**
 * Formatea el saludo del usuario logueado incluyendo su alias si existe.
 * Formato: Nombre "Alias" Apellido
 */
function formatGreeting(user) {
    if (!user) return '---';
    const fullName = user['Nombre Tripultante'] || '';
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
 * Carga el archivo CSV y lo parsea a un Array de Objetos JSON.
 */
async function loadAppData() {
    try {
        const response = await fetch(CSV_PATH + '?t=' + Date.now());
        if (!response.ok) throw new Error('No se pudo cargar el archivo de datos.');
        const csvText = await response.text();
        const data = parseCSV(csvText);
        
        // Normalizar estados de visa y sincronizar memoria local
        const visas = ['Visa de Zarpe', 'Visa de Navegacion', 'Visa de Aduanas', 'Visa de Descarga', 'Visa de Transito'];
        data.forEach(user => {
            // Normalizar a "Si" si viene como "SI", "si", "Si" en el CSV
            visas.forEach(visa => {
                if (user[visa] && user[visa].toLowerCase() === 'si') {
                    user[visa] = 'Si';
                }
            });

            if (localStorage.getItem('portland_visa1_accepted_' + user.Email)) {
                user['Visa de Zarpe'] = 'Si';
            }
        });

        // REFRESCAR SESIÓN: Si hay un usuario logueado, actualizamos su objeto en localStorage 
        // con los datos frescos (incluyendo el parche de la visa que acabamos de aplicar arriba)
        const sessionUserStr = localStorage.getItem('portland_user');
        if (sessionUserStr) {
            const sessionUser = JSON.parse(sessionUserStr);
            const freshUser = data.find(u => u.Email.toLowerCase() === sessionUser.Email.toLowerCase());
            if (freshUser) {
                localStorage.setItem('portland_user', JSON.stringify(freshUser));
            }
        }
        
        return data;
    } catch (error) {
        console.error('Error al cargar datos:', error);
        return [];
    }
}

/**
 * Parsea un CSV con punto y coma (;) como separador.
 */
function parseCSV(csv) {
    const lines = csv.trim().split('\n');
    if (lines.length < 2) return [];
    
    const headers = lines[0].split(';').map(h => h.trim());
    const data = [];

    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(';');
        const entry = {};
        headers.forEach((header, index) => {
            entry[header] = values[index] ? values[index].trim() : '';
        });
        data.push(entry);
    }
    return data;
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
/**
 * Borra la sesión (Logout).
 */
function logout() {
    localStorage.removeItem('portland_user');
    localStorage.removeItem('portland_role');
    // Nota: El alias y avatar persisten aunque se cierre sesión, 
    // a menos que se quiera un reset total.
    window.location.href = 'index.html';
}

/**
 * Guarda el perfil personalizado (Alias y Avatar).
 */
function saveProfile(alias, avatar, email = null) {
    let suffix = '';
    if (email) {
        suffix = '_' + email.toLowerCase().trim();
    } else {
        const userStr = localStorage.getItem('portland_user');
        const user = userStr ? JSON.parse(userStr) : null;
        suffix = user ? ('_' + user.Email.toLowerCase().trim()) : '';
    }
    
    if (alias) localStorage.setItem('portland_aliasUsuario' + suffix, alias);
    if (avatar) localStorage.setItem('portland_avatarUsuario' + suffix, avatar);
}

/**
 * Recupera el perfil personalizado.
 */
function getProfile(email = null) {
    let suffix = '';
    if (email) {
        suffix = '_' + email.toLowerCase().trim();
    } else {
        const userStr = localStorage.getItem('portland_user');
        const user = userStr ? JSON.parse(userStr) : null;
        suffix = user ? ('_' + user.Email.toLowerCase().trim()) : '';
    }

    let alias = localStorage.getItem('portland_aliasUsuario' + suffix);
    let avatar = localStorage.getItem('portland_avatarUsuario' + suffix);
    
    // Migración: Si el avatar contiene un avión (✈️), lo reemplazamos por uno náutico limpio.
    if (avatar && avatar.includes('✈️')) {
        const role = localStorage.getItem('portland_role');
        // Usamos Oficial (👮‍♂️) para cargos de mando o Marinero (🧔) para el resto
        const newAvatar = (role === 'Capitan' || role === 'Almirante') ? '👮‍♂️' : '🧔';
        localStorage.setItem('portland_avatarUsuario' + suffix, newAvatar);
        avatar = newAvatar;
    }

    return {
        aliasUsuario: alias,
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
            let isDone = false;
            if (val === 'Si' || val === 'SI' || val === 'si') {
                isDone = true;
            } else if (!isNaN(parseInt(val)) && parseInt(val) >= 100) {
                isDone = true;
            }
            if (isDone) {
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
            if (val === 'Si' || val === 'SI' || val === 'si') {
                totalProgress += 100;
            } else if (!isNaN(parseInt(val))) {
                let pct = parseInt(val);
                totalProgress += pct > 100 ? 100 : pct;
            }
        });
    });
    return totalPossible ? Math.round((totalProgress / totalPossible) * 100) : 0;
}

/**
 * Calcula los días restantes para el Go-Live (30 de Septiembre de 2026).
 */
function getDaysToGoLive() {
    const target = new Date('2026-09-30');
    const today = new Date();
    const diff = target - today;
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    return days > 0 ? days : 0;
}

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

// Exportar globalmente
window.Core = {
    loadAppData,
    getUserRole,
    saveSession,
    checkSession,
    logout,
    getLatestAchievements,
    formatName,
    formatGreeting,
    getFlag,
    calculateProgressPercent,
    getDaysToGoLive,
    saveProfile,
    getProfile,
    getTransitiveSubordinates
};
