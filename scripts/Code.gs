/**
 * ============================================================================
 * GOOGLE APPS SCRIPT - PROYECTO ULISES (RUTA DEL CAMBIO PORTLAND)
 * Webhook para Registro de Visas y Rutas Especializadas (Testers y Trainers)
 * ============================================================================
 * 
 * INSTRUCCIONES DE INSTALACIÓN / ACTUALIZACIÓN:
 * 1. Abre tu proyecto en Google Apps Script (asociado a tu hoja de cálculo "Registro").
 * 2. Reemplaza todo el contenido del archivo Code.gs con este código.
 * 3. Haz clic en "Implementar" -> "Administrar implementaciones" -> "Editar" -> Nueva versión -> "Implementar".
 * 4. La pestaña "Registro" original seguirá funcionando para la Visa de Zarpe.
 * 5. La pestaña "Registro2" se creará automáticamente para los eventos de Testers y Trainers.
 */

const RECIPIENT_PROJECT_EMAIL = 'gsalinas@pjportland.cl';
const SHEET_REGISTRO_LEGACY = 'Registro';
const SHEET_REGISTRO_SPECIAL = 'Registro2';
const SHEET_USUARIOS = 'Usuarios';

/**
 * Manejador GET: Consulta si el usuario aceptó la Visa de Zarpe, consulta estados y entrega datos protegidos.
 */
function doGet(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const params = (e && e.parameter) ? e.parameter : {};
    const email = (params.email || '').trim().toLowerCase();
    const action = params.action || '';
    const viewAs = (params.viewAs || '').trim().toLowerCase();

    // =========================================================================
    // ACCIÓN 1: getRegistro2 (Historial de Testers y Trainers)
    // =========================================================================
    if (action === 'getRegistro2' && email) {
      const sheet2 = ss.getSheetByName(SHEET_REGISTRO_SPECIAL);
      if (!sheet2) {
        return createJsonResponse({ success: true, records: [] });
      }
      const data = sheet2.getDataRange().getValues();
      const records = [];
      // Columnas: 0: Fecha, 1: Email, 2: Nombre, 3: Rol, 4: Tipo Evento, 5: Detalle, 6: Evaluación, 7: Requiere Refuerzo, 8: Archivo, 9: Observaciones
      for (let i = 1; i < data.length; i++) {
        const rowEmail = (data[i][1] || '').toString().trim().toLowerCase();
        if (rowEmail === email || !email) {
          records.push({
            timestamp: data[i][0],
            email: data[i][1],
            nombre: data[i][2],
            rol: data[i][3],
            tipoEvento: data[i][4],
            detalle: data[i][5],
            evaluacion: data[i][6],
            requiereRefuerzo: data[i][7],
            archivo: data[i][8],
            observaciones: data[i][9]
          });
        }
      }
      return createJsonResponse({ success: true, records: records });
    }

    // =========================================================================
    // ACCIÓN 2: getUser / login (Identificación individual en Login - Máxima Seguridad)
    // =========================================================================
    if (action === 'getUser' || action === 'login') {
      if (!email) {
        return createJsonResponse({ success: false, error: 'Email requerido' });
      }

      const allUsers = getUsersFromSheet(ss);
      const user = allUsers.find(u => (u.Email || '').toLowerCase() === email);

      if (!user) {
        return createJsonResponse({ success: false, error: 'Tripulante no encontrado en el rol oficial' });
      }

      // Recuperar alias, avatar y estado de Visa de Zarpe desde la hoja Registro
      const profileData = getProfileAndVisaFromRegistro(ss, email);
      
      const hasAcceptedVisa = profileData.hasVisa || (user['Visa de Zarpe'] && user['Visa de Zarpe'].toString().toLowerCase() === 'si');
      if (hasAcceptedVisa) {
        user['Visa de Zarpe'] = 'Si';
      }

      return createJsonResponse({
        success: true,
        user: user,
        role: user['Rango'] || 'Tripulante',
        alias: profileData.alias || user['Alias'] || '',
        avatar: profileData.avatar || '',
        hasVisa: !!hasAcceptedVisa
      });
    }

    // =========================================================================
    // ACCIÓN 3: getAppData (Carga protegida de datos según el rol del usuario)
    // =========================================================================
    if (action === 'getAppData') {
      if (!email) {
        return createJsonResponse({ success: false, error: 'Email requerido' });
      }

      const allUsers = getUsersFromSheet(ss);
      const currentUser = allUsers.find(u => (u.Email || '').toLowerCase() === email);

      if (!currentUser) {
        return createJsonResponse({ success: false, error: 'Usuario no registrado' });
      }

      // Sincronizar visa de zarpe del usuario actual si está en Registro
      const profileData = getProfileAndVisaFromRegistro(ss, email);
      if (profileData.hasVisa) {
        currentUser['Visa de Zarpe'] = 'Si';
      }

      const role = (currentUser['Rango'] || 'Tripulante').trim();
      let usersToReturn = [];
      let achievements = [];

      if (role === 'Tripulante') {
        // Un tripulante solo recibe sus propios datos, su trainer y alumnos asignados si es trainer
        usersToReturn.push(currentUser);

        // Si tiene un Trainer a cargo, incluir al Trainer para que vea su contacto
        if (currentUser['Trainer a Cargo']) {
          const trainerEmail = currentUser['Trainer a Cargo'].trim().toLowerCase();
          const trainerUser = allUsers.find(u => (u.Email || '').toLowerCase() === trainerEmail);
          if (trainerUser) usersToReturn.push(trainerUser);
        }

        // Si este tripulante es Trainer, incluir a sus alumnos asignados
        if (currentUser.Trainer === 'SI') {
          const myStudents = allUsers.filter(u => (u['Trainer a Cargo'] || '').trim().toLowerCase() === email);
          usersToReturn.push(...myStudents);
        }

        // Logros de su capitán / tripulación
        achievements = getLatestAchievementsGS(allUsers, currentUser['Capitan a Cargo']);

      } else if (role === 'Capitan') {
        // Un capitán recibe sus datos y toda su tripulación subordinada
        const myCrew = getSubordinatesTransitiveGS(email, allUsers);
        usersToReturn = [currentUser, ...myCrew];
        achievements = getLatestAchievementsGS(allUsers, email);

      } else if (role === 'Almirante') {
        const isSuperAdmiral = currentUser.Email.toLowerCase() === (currentUser['Capitan a Cargo'] || '').toLowerCase();

        // Modo vista de capitán (cuando el almirante inspecciona el panel de un capitán)
        if (viewAs) {
          const targetCap = allUsers.find(u => (u.Email || '').toLowerCase() === viewAs);
          if (targetCap) {
            const crew = getSubordinatesTransitiveGS(viewAs, allUsers);
            usersToReturn = isSuperAdmiral ? allUsers : [targetCap, ...crew];
            achievements = getLatestAchievementsGS(allUsers, viewAs);
          } else {
            usersToReturn = isSuperAdmiral ? allUsers : [currentUser, ...getSubordinatesTransitiveGS(email, allUsers)];
            achievements = getLatestAchievementsGS(allUsers, null);
          }
        } else {
          // Si es Súper Almirante (se reporta a sí mismo), tiene visión global de toda la flota
          if (isSuperAdmiral) {
            usersToReturn = allUsers;
          } else {
            // Almirante de flota específica: sus subordinados transitivos y él mismo
            const myFleet = getSubordinatesTransitiveGS(email, allUsers);
            usersToReturn = [currentUser, ...myFleet];
          }
          achievements = getLatestAchievementsGS(allUsers, null);
        }
      } else {
        usersToReturn = [currentUser];
      }

      // Eliminar duplicados si los hubiera
      const uniqueUsers = [];
      const seen = new Set();
      usersToReturn.forEach(u => {
        const em = (u.Email || '').toLowerCase();
        if (em && !seen.has(em)) {
          seen.add(em);
          uniqueUsers.push(u);
        }
      });

      return createJsonResponse({
        success: true,
        user: currentUser,
        role: role,
        users: uniqueUsers,
        achievements: achievements
      });
    }

    // =========================================================================
    // FLUJO LEGADO: Consulta directa de Visa de Zarpe y perfil en hoja Registro
    // =========================================================================
    const profile = getProfileAndVisaFromRegistro(ss, email);

    // Si además el usuario está en la hoja Usuarios, verificar si allí tiene la visa
    let userFound = null;
    try {
      const allUsers = getUsersFromSheet(ss);
      userFound = allUsers.find(u => (u.Email || '').toLowerCase() === email);
      if (userFound && (userFound['Visa de Zarpe'] || '').toLowerCase() === 'si') {
        profile.hasVisa = true;
      }
    } catch (eUsers) {
      Logger.log('Advertencia al consultar hoja Usuarios en flujo legado: ' + eUsers);
    }

    return createJsonResponse({
      success: true,
      email: email,
      hasVisa: profile.hasVisa,
      alias: profile.alias,
      avatar: profile.avatar,
      user: userFound
    });
  } catch (error) {
    return createJsonResponse({
      success: false,
      error: error.toString()
    });
  }
}

/**
 * Manejador POST: Registra eventos tanto para Registro (Visa de Zarpe) como Registro2 (Testers/Trainers).
 */
function doPost(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let body = {};

    if (e && e.postData && e.postData.contents) {
      try {
        body = JSON.parse(e.postData.contents);
      } catch (err) {
        body = e.parameter || {};
      }
    } else if (e && e.parameter) {
      body = e.parameter;
    }

    const email = (body.email || '').trim().toLowerCase();
    const nombre = body.nombre || body.alias || 'Tripulante';
    const action = body.action || '';

    // =========================================================================
    // CASO 1: EVENTOS DE RUTAS ESPECIALES (TESTER / TRAINER / ALUMNOS) -> Registro2
    // =========================================================================
    if (action.startsWith('TESTER_') || action.startsWith('TRAINER_') || action.startsWith('NORMAL_')) {
      const sheet2 = getOrCreateSheet(ss, SHEET_REGISTRO_SPECIAL, [
        'Marca Temporal',
        'Email Usuario',
        'Nombre Tripulante',
        'Rol',
        'Tipo Evento',
        'Detalle / Tema',
        'Nivel Preparación (1-5)',
        'Requiere Refuerzo (SI/NO)',
        'Archivo / Enlace',
        'Observaciones / Comentarios'
      ]);

      const now = new Date();
      const formattedDate = Utilities.formatDate(now, 'America/Santiago', 'dd/MM/yyyy HH:mm:ss');
      const rol = body.rol || 'Tripulante';
      const detalle = body.detalle || '';
      const evaluacion = body.evaluacion || '';
      const requiereRefuerzo = body.requiereRefuerzo ? 'SI' : 'NO';
      const fileName = body.fileName || '';
      const observaciones = body.observaciones || '';

      let driveResult = null;
      let archivoRegistro = fileName;

      // Si es envío de planilla de ciclo de test con archivo adjunto
      if (action.startsWith('TESTER_CICLO') && body.fileBase64) {
        const decodedBytes = Utilities.base64Decode(body.fileBase64);
        const fileBlob = Utilities.newBlob(decodedBytes, body.fileMimeType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fileName);

        // 1. Guardar en Google Drive: Testers / Ciclo_X / [nombre]_[usuario].[ext]
        driveResult = guardarArchivoEnDrive({
          ciclo: detalle || action,
          fileName: fileName,
          nombreTester: nombre
        }, fileBlob);

        if (driveResult && driveResult.fileUrl) {
          archivoRegistro = driveResult.fileUrl;
        }

        // 2. Enviar correo a gsalinas@pjportland.cl con copia al Tester y enlace directo a Drive
        enviarEmailPlanillaTest({
          emailTester: email,
          nombreTester: nombre,
          ciclo: detalle || action,
          fileName: fileName,
          savedFileName: (driveResult && driveResult.savedFileName) ? driveResult.savedFileName : fileName,
          driveUrl: (driveResult && driveResult.fileUrl) ? driveResult.fileUrl : '',
          driveFolder: (driveResult && driveResult.folderPath) ? driveResult.folderPath : '',
          fileMimeType: body.fileMimeType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          fileBase64: body.fileBase64,
          observaciones: observaciones,
          fechaEnvio: formattedDate
        });
      }

      // Registrar fila en Registro2 (guardando el enlace directo a Drive si se guardó con éxito)
      sheet2.appendRow([
        formattedDate,
        email,
        nombre,
        rol,
        action,
        detalle,
        evaluacion,
        requiereRefuerzo,
        archivoRegistro,
        observaciones
      ]);

      // Si es evaluación de usuario normal y requiere refuerzo, notificar al Trainer asignado y a gsalinas
      if (action === 'NORMAL_EVAL_TRAINING' && body.requiereRefuerzo && body.trainerEmail) {
        enviarEmailAlertaRefuerzo({
          emailAlumno: email,
          nombreAlumno: nombre,
          emailTrainer: body.trainerEmail,
          detalle: detalle,
          evaluacion: evaluacion,
          observaciones: observaciones,
          fechaEnvio: formattedDate
        });
      }

      return createJsonResponse({
        success: true,
        message: 'Evento registrado con éxito en ' + SHEET_REGISTRO_SPECIAL,
        driveUrl: (driveResult && driveResult.fileUrl) ? driveResult.fileUrl : '',
        fecha: formattedDate
      });
    }

    // =========================================================================
    // CASO 2: FLUJO LEGADO DE VISA DE ZARPE -> Pestaña Registro original + Usuarios
    // =========================================================================
    const sheet1 = ss.getSheetByName(SHEET_REGISTRO_LEGACY) || ss.getSheets()[0];
    const now = new Date();
    const formattedDate = Utilities.formatDate(now, 'America/Santiago', 'dd/MM/yyyy HH:mm:ss');
    const formattedDateShort = Utilities.formatDate(now, 'America/Santiago', 'dd-MM-yyyy');
    
    sheet1.appendRow([
      body.alias || '',
      body.avatar || '',
      email,
      body.aceptoTyC ? 'Aceptado' : 'Pendiente',
      formattedDate,
      body.userAgent || '',
      body.ip || 'N/A'
    ]);

    // Actualizar directamente en la hoja Usuarios si existe
    try {
      actualizarVisaUsuarioEnSheet(ss, email, formattedDateShort);
    } catch (eUpd) {
      Logger.log('Aviso al actualizar visa en hoja Usuarios: ' + eUpd);
    }

    return createJsonResponse({
      success: true,
      message: 'Visa de Zarpe registrada con éxito en ' + SHEET_REGISTRO_LEGACY
    });

  } catch (error) {
    return createJsonResponse({
      success: false,
      error: error.toString()
    });
  }
}

/**
 * Envía la planilla de resultados del ciclo de test vía email.
 * Destinatarios: gsalinas@pjportland.cl y con copia (cc) y respuesta directa (replyTo) al Tester.
 */
function enviarEmailPlanillaTest(data) {
  try {
    const decodedBytes = Utilities.base64Decode(data.fileBase64);
    const attachment = Utilities.newBlob(decodedBytes, data.fileMimeType, data.fileName);

    const subject = `[Proyecto Ulises] Entrega Planilla de Test - ${data.ciclo} - ${data.nombreTester}`;
    const senderName = `Proyecto Ulises - ${data.nombreTester}`;
    
    const htmlBody = `
      <div style="font-family: Arial, sans-serif; color: #0F2035; max-width: 600px; border: 1px solid #C5A059; border-radius: 8px; overflow: hidden;">
        <div style="background-color: #0F2035; color: #FFFFFF; padding: 20px; text-align: center;">
          <h2 style="margin: 0; color: #E6C875; font-size: 22px;">PROYECTO ULISES</h2>
          <p style="margin: 5px 0 0 0; font-size: 14px; color: #FFFFFF;">Ruta del Cambio Portland</p>
        </div>
        <div style="padding: 25px; background-color: #F5F4EF;">
          <h3 style="color: #1B365D; margin-top: 0;">📋 Nueva Planilla de Pruebas Recibida</h3>
          <p>Se ha registrado la entrega del ciclo de pruebas por parte de un integrante del equipo Tester:</p>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
            <tr>
              <td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #DDD; width: 40%;">Tester:</td>
              <td style="padding: 8px; border-bottom: 1px solid #DDD;">${data.nombreTester} (${data.emailTester})</td>
            </tr>
            <tr>
              <td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #DDD;">Ciclo de Test:</td>
              <td style="padding: 8px; border-bottom: 1px solid #DDD; color: #C5A059; font-weight: bold;">${data.ciclo}</td>
            </tr>
            <tr>
              <td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #DDD;">Fecha de Envío:</td>
              <td style="padding: 8px; border-bottom: 1px solid #DDD;">${data.fechaEnvio}</td>
            </tr>
            <tr>
              <td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #DDD;">Archivo Guardado:</td>
              <td style="padding: 8px; border-bottom: 1px solid #DDD;"><strong>${data.savedFileName || data.fileName}</strong></td>
            </tr>
            ${data.driveUrl ? `
            <tr>
              <td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #DDD;">Ubicación Drive:</td>
              <td style="padding: 8px; border-bottom: 1px solid #DDD;">
                <a href="${data.driveUrl}" target="_blank" style="background:#0F2035; color:#E6C875; padding:4px 10px; border-radius:4px; text-decoration:none; font-weight:bold; font-size:11px; display:inline-block;">
                  📂 Abrir Archivo en Google Drive
                </a>
              </td>
            </tr>` : ''}
            ${data.observaciones ? `
            <tr>
              <td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #DDD;">Observaciones:</td>
              <td style="padding: 8px; border-bottom: 1px solid #DDD;">${data.observaciones}</td>
            </tr>` : ''}
          </table>
          <div style="background:#FFFFFF; border-left:4px solid #C5A059; padding:10px; margin-top:15px; font-size:12px; color:#5C6E80;">
            💡 <em>Al responder este correo desde Outlook, responderás directamente a la casilla de <strong>${data.nombreTester}</strong> (${data.emailTester}).</em>
          </div>
        </div>
        <div style="background-color: #1B365D; color: #FFFFFF; padding: 10px; text-align: center; font-size: 11px;">
          Proyecto Ulises - Sistema Automatizado de Seguimiento
        </div>
      </div>
    `;

    const plainTextBody = `PROYECTO ULISES - ENTREGA DE PLANILLA DE TEST\n\n` +
      `Ciclo: ${data.ciclo}\n` +
      `Tester: ${data.nombreTester} (${data.emailTester})\n` +
      `Fecha de Envío: ${data.fechaEnvio}\n` +
      `Archivo Guardado: ${data.savedFileName || data.fileName}\n` +
      (data.driveUrl ? `Enlace Google Drive: ${data.driveUrl}\n` : '') +
      `Observaciones: ${data.observaciones || 'Sin observaciones'}\n\n` +
      `Para contactar al Tester, puedes responder directamente a este correo.`;

    // Envío con replyTo hacia la cuenta Outlook del Tester
    try {
      GmailApp.sendEmail(RECIPIENT_PROJECT_EMAIL, subject, plainTextBody, {
        cc: data.emailTester,
        replyTo: data.emailTester,
        name: senderName,
        htmlBody: htmlBody,
        attachments: [attachment]
      });
      Logger.log('✅ Correo enviado exitosamente vía GmailApp (registrado en Enviados).');
    } catch (errGmail) {
      Logger.log('⚠️ GmailApp no disponible o sin permisos, intentando MailApp: ' + errGmail.toString());
      MailApp.sendEmail({
        to: RECIPIENT_PROJECT_EMAIL,
        cc: data.emailTester,
        replyTo: data.emailTester,
        name: senderName,
        subject: subject,
        htmlBody: htmlBody,
        body: plainTextBody,
        attachments: [attachment]
      });
      Logger.log('✅ Correo enviado exitosamente vía MailApp.');
    }

  } catch (e) {
    Logger.log('❌ Error enviando email planilla test: ' + e.toString());
  }
}

/**
 * Guarda el archivo adjunto en Google Drive:
 * Carpeta "Testers" -> Carpeta "Ciclo_1", "Ciclo_2" o "Ciclo_3"
 * Nombre con sufijo: [NombreOriginal]_[NombreUsuario].[ext]
 */
function guardarArchivoEnDrive(data, blob) {
  try {
    // 1. Obtener la carpeta donde reside la hoja de cálculo
    let parentFolder = DriveApp.getRootFolder();
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const ssFile = DriveApp.getFileById(ss.getId());
      const parents = ssFile.getParents();
      if (parents.hasNext()) {
        parentFolder = parents.next();
      }
    } catch (e) {
      Logger.log('Usando carpeta raíz de Drive: ' + e.toString());
    }

    // 2. Obtener o crear carpeta 'Testers'
    const testersFolder = getOrCreateFolder(parentFolder, 'Testers');

    // 3. Determinar subcarpeta según el ciclo: Ciclo_1, Ciclo_2, Ciclo_3
    let cycleFolderName = 'Ciclo_1';
    const actionStr = (data.ciclo || '').toString().toLowerCase();
    if (actionStr.includes('3') || actionStr.includes('ciclo 3') || actionStr.includes('ciclo_3')) {
      cycleFolderName = 'Ciclo_3';
    } else if (actionStr.includes('2') || actionStr.includes('ciclo 2') || actionStr.includes('ciclo_2')) {
      cycleFolderName = 'Ciclo_2';
    } else {
      cycleFolderName = 'Ciclo_1';
    }

    const cycleFolder = getOrCreateFolder(testersFolder, cycleFolderName);

    // 4. Construir nombre del archivo con sufijo del nombre del usuario
    const originalName = data.fileName || 'Planilla.xlsx';
    const cleanUserName = (data.nombreTester || 'Usuario').replace(/[\\/:*?"<>|]/g, '').trim();
    
    let savedFileName = originalName;
    const dotIndex = originalName.lastIndexOf('.');
    if (dotIndex !== -1) {
      const base = originalName.substring(0, dotIndex);
      const ext = originalName.substring(dotIndex);
      savedFileName = `${base}_${cleanUserName}${ext}`;
    } else {
      savedFileName = `${originalName}_${cleanUserName}`;
    }

    // 5. Crear el archivo en Drive
    const driveFile = cycleFolder.createFile(blob.setName(savedFileName));
    
    Logger.log(`📁 Archivo guardado en Drive: Testers/${cycleFolderName}/${savedFileName} -> ${driveFile.getUrl()}`);

    return {
      success: true,
      fileId: driveFile.getId(),
      fileUrl: driveFile.getUrl(),
      savedFileName: savedFileName,
      folderPath: `Testers/${cycleFolderName}`
    };
  } catch (err) {
    Logger.log('❌ Error guardando archivo en Google Drive: ' + err.toString());
    return {
      success: false,
      error: err.toString(),
      savedFileName: data.fileName || ''
    };
  }
}

/**
 * Helper para buscar o crear una carpeta en Drive
 */
function getOrCreateFolder(parentFolder, folderName) {
  const folders = parentFolder.getFoldersByName(folderName);
  if (folders.hasNext()) {
    return folders.next();
  }
  return parentFolder.createFolder(folderName);
}

/**
 * ============================================================================
 * FUNCIÓN DE PRUEBA DE CONCEPTO (POC): DRIVE + CORREO
 * ============================================================================
 * Ejecuta esta función en el editor de Google Apps Script:
 * 1. Selecciona 'testEnviarEmailPOC' en la barra superior.
 * 2. Clic en 'Ejecutar'.
 * 3. Si te solicita permisos para Google Drive, concédelos.
 * 4. Verifica que se cree la carpeta 'Testers/Ciclo_1' con el archivo guardado y el correo en Outlook.
 */
function testEnviarEmailPOC() {
  Logger.log('🚀 Iniciando Prueba de Concepto (POC): Guardar en Drive + Envío Correo...');
  
  const originalFileName = 'planilla_test_ulises.xlsx';
  const testerName = 'Patricio Abarca';
  const fileBytes = Utilities.base64Encode('Contenido simulado de la planilla de test de Proyecto Ulises para validar Drive y Correo');
  const decodedBytes = Utilities.base64Decode(fileBytes);
  const fileBlob = Utilities.newBlob(decodedBytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', originalFileName);

  // 1. Probar guardado en Drive
  const driveResult = guardarArchivoEnDrive({
    ciclo: 'Ciclo 1 de Pruebas (POC)',
    fileName: originalFileName,
    nombreTester: testerName
  }, fileBlob);

  // 2. Probar envío de correo
  const testData = {
    emailTester: 'gsalinas@pjportland.cl',
    nombreTester: `${testerName} (Prueba POC)`,
    ciclo: 'Ciclo 1 de Pruebas',
    fileName: originalFileName,
    savedFileName: driveResult.savedFileName || originalFileName,
    driveUrl: driveResult.fileUrl || '',
    fileMimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    fileBase64: fileBytes,
    observaciones: 'Prueba de concepto para verificar carpetas en Drive (Testers/Ciclo_1) y recepción de correo.',
    fechaEnvio: Utilities.formatDate(new Date(), 'America/Santiago', 'dd/MM/yyyy HH:mm:ss')
  };

  enviarEmailPlanillaTest(testData);
  Logger.log('🏁 Fin de la prueba de concepto. Revisa tu Google Drive y tu buzón.');
}

/**
 * Notifica al Trainer cuando un alumno solicita sesión de refuerzo.
 */
function enviarEmailAlertaRefuerzo(data) {
  try {
    const subject = `[Proyecto Ulises] Solicitud de Refuerzo - ${data.nombreAlumno}`;
    const senderName = `Proyecto Ulises - Alerta de Refuerzo`;

    const htmlBody = `
      <div style="font-family: Arial, sans-serif; color: #0F2035; max-width: 600px; border: 1px solid #C0392B; border-radius: 8px; overflow: hidden;">
        <div style="background-color: #0F2035; color: #FFFFFF; padding: 20px; text-align: center;">
          <h2 style="margin: 0; color: #E6C875; font-size: 22px;">PROYECTO ULISES</h2>
          <p style="margin: 5px 0 0 0; font-size: 14px; color: #FFFFFF;">Coordinación de Refuerzo de Capacitación</p>
        </div>
        <div style="padding: 25px; background-color: #F5F4EF;">
          <div style="background:#FADBD8; color:#78281F; padding:10px 15px; border-radius:6px; font-weight:bold; margin-bottom:15px;">
            ⚠️ Un tripulante a tu cargo ha indicado que requiere una sesión de refuerzo adicional.
          </div>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
            <tr>
              <td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #DDD; width: 40%;">Tripulante:</td>
              <td style="padding: 8px; border-bottom: 1px solid #DDD;">${data.nombreAlumno} (${data.emailAlumno})</td>
            </tr>
            <tr>
              <td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #DDD;">Sesión Evaluada:</td>
              <td style="padding: 8px; border-bottom: 1px solid #DDD;">${data.detalle}</td>
            </tr>
            <tr>
              <td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #DDD;">Nivel Obtenido:</td>
              <td style="padding: 8px; border-bottom: 1px solid #DDD; color:#C0392B; font-weight:bold;">${data.evaluacion}</td>
            </tr>
            <tr>
              <td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #DDD;">Fecha:</td>
              <td style="padding: 8px; border-bottom: 1px solid #DDD;">${data.fechaEnvio}</td>
            </tr>
            ${data.observaciones ? `
            <tr>
              <td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #DDD;">Temas a Reforzar:</td>
              <td style="padding: 8px; border-bottom: 1px solid #DDD; font-style:italic;">"${data.observaciones}"</td>
            </tr>` : ''}
          </table>
          <p style="font-size: 12px; color: #5C6E80;">
            Por favor, coordina directamente con el tripulante la fecha y hora de la sesión complementaria. Al responder este correo desde Outlook, responderás directamente a su casilla.
          </p>
        </div>
        <div style="background-color: #1B365D; color: #FFFFFF; padding: 10px; text-align: center; font-size: 11px;">
          Proyecto Ulises - Sistema Automatizado de Seguimiento
        </div>
      </div>
    `;

    try {
      GmailApp.sendEmail(data.emailTrainer, subject, `Solicitud de refuerzo de ${data.nombreAlumno} (${data.emailAlumno}). Temas: ${data.observaciones || 'Sin detalles'}`, {
        cc: RECIPIENT_PROJECT_EMAIL,
        replyTo: data.emailAlumno,
        name: senderName,
        htmlBody: htmlBody
      });
      Logger.log('✅ Alerta de refuerzo enviada vía GmailApp.');
    } catch (errGmail) {
      Logger.log('⚠️ Intentando alerta de refuerzo vía MailApp: ' + errGmail.toString());
      MailApp.sendEmail({
        to: data.emailTrainer,
        cc: RECIPIENT_PROJECT_EMAIL,
        replyTo: data.emailAlumno,
        name: senderName,
        subject: subject,
        htmlBody: htmlBody,
        body: `Solicitud de refuerzo de ${data.nombreAlumno} (${data.emailAlumno}). Temas: ${data.observaciones || 'Sin detalles'}`
      });
      Logger.log('✅ Alerta de refuerzo enviada vía MailApp.');
    }

  } catch (e) {
    Logger.log('❌ Error enviando alerta de refuerzo: ' + e.toString());
  }
}

/**
 * Obtiene o crea una pestaña con encabezados especificados si no existe.
 */
function getOrCreateSheet(ss, sheetName, headers) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(headers);
    const headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setBackground('#0F2035');
    headerRange.setFontColor('#E6C875');
    headerRange.setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * Helper para responder en formato JSON compatible con Webhooks.
 */
function createJsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * ============================================================================
 * GESTIÓN DE BASE DE USUARIOS (BACKEND SEGURO)
 * ============================================================================
 */

/**
 * Encabezados oficiales para la hoja "Usuarios" (idénticos al esquema de datos Portland)
 */
const HEADERS_USUARIOS = [
  'ID Tripulante',
  'Rango',
  'Nombre Tripulante',
  'Alias',
  'Email',
  'Bandera',
  'Capitan a Cargo',
  'Visa de Zarpe',
  'Fecha Visa de Zarpe',
  'Visa de Navegacion',
  'Fecha Visa de Navegacion',
  'Visa de Aduanas',
  'Fecha Visa de Aduanas',
  'Visa de Descarga',
  'Fecha Visa de Descarga',
  'Visa de Transito',
  'Fecha Visa de Transito',
  'Tester',
  'Trainer',
  'Trainer a Cargo'
];

/**
 * Obtiene la pestaña de usuarios en la planilla ("Usuarios", "BaseUsuarios" o "Avance_RUTA").
 */
function getUsuariosSheet(ss) {
  return ss.getSheetByName(SHEET_USUARIOS) || 
         ss.getSheetByName('BaseUsuarios') || 
         ss.getSheetByName('Avance_RUTA') ||
         null;
}

/**
 * Lee todos los usuarios de la hoja y los entrega como array de objetos normalizados.
 */
function getUsersFromSheet(ss) {
  const sheet = getUsuariosSheet(ss);
  if (!sheet) return [];

  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const headers = values[0].map(h => (h || '').toString().trim());
  const users = [];

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const user = {};
    headers.forEach((h, colIdx) => {
      let val = row[colIdx];
      if (val instanceof Date) {
        val = Utilities.formatDate(val, 'America/Santiago', 'dd-MM-yyyy');
      } else {
        val = (val !== null && val !== undefined) ? val.toString().trim() : '';
      }
      user[h] = val;
    });

    // Compatibilidad si la columna se llama "Nombre Tripultante" (con 't') o "Nombre Tripulante"
    if (user['Nombre Tripultante'] && !user['Nombre Tripulante']) {
      user['Nombre Tripulante'] = user['Nombre Tripultante'];
    }
    if (user['Nombre Tripulante'] && !user['Nombre Tripultante']) {
      user['Nombre Tripultante'] = user['Nombre Tripulante'];
    }

    // Normalizar estados
    user.Tester = (user.Tester && user.Tester.toUpperCase() === 'SI') ? 'SI' : 'NO';
    user.Trainer = (user.Trainer && user.Trainer.toUpperCase() === 'SI') ? 'SI' : 'NO';
    user['Trainer a Cargo'] = (user['Trainer a Cargo'] || '').trim();

    if (user.Email) {
      users.push(user);
    }
  }

  return users;
}

/**
 * Consulta la pestaña Registro para obtener alias, avatar y verificar si aceptó Visa de Zarpe.
 */
function getProfileAndVisaFromRegistro(ss, email) {
  const sheet = ss.getSheetByName(SHEET_REGISTRO_LEGACY) || ss.getSheets()[0];
  if (!sheet) return { hasVisa: false, alias: '', avatar: '' };

  const data = sheet.getDataRange().getValues();
  const targetEmail = (email || '').trim().toLowerCase();

  let hasVisa = false;
  let alias = '';
  let avatar = '';

  for (let i = 1; i < data.length; i++) {
    const rowEmail = (data[i][2] || data[i][0] || '').toString().trim().toLowerCase();
    if (rowEmail === targetEmail) {
      hasVisa = true;
      alias = (data[i][0] || '').toString().trim();
      avatar = (data[i][1] || '').toString().trim();
      break;
    }
  }

  return { hasVisa, alias, avatar };
}

/**
 * Actualiza el estado de Visa de Zarpe en la hoja Usuarios si la hoja existe.
 */
function actualizarVisaUsuarioEnSheet(ss, email, fechaStr) {
  const sheet = getUsuariosSheet(ss);
  if (!sheet) return false;

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return false;

  const headers = data[0].map(h => (h || '').toString().trim().toLowerCase());
  const emailColIdx = headers.indexOf('email');
  let visaColIdx = headers.indexOf('visa de zarpe');
  let fechaColIdx = headers.indexOf('fecha visa de zarpe');

  if (emailColIdx === -1) return false;

  const targetEmail = (email || '').trim().toLowerCase();

  for (let i = 1; i < data.length; i++) {
    const rowEmail = (data[i][emailColIdx] || '').toString().trim().toLowerCase();
    if (rowEmail === targetEmail) {
      if (visaColIdx !== -1) {
        sheet.getRange(i + 1, visaColIdx + 1).setValue('Si');
      }
      if (fechaColIdx !== -1) {
        sheet.getRange(i + 1, fechaColIdx + 1).setValue(fechaStr || Utilities.formatDate(new Date(), 'America/Santiago', 'dd-MM-yyyy'));
      }
      return true;
    }
  }

  return false;
}

/**
 * Calcula los subordinados directos e indirectos transitivos para un email.
 */
function getSubordinatesTransitiveGS(email, allUsers) {
  if (!email || !allUsers) return [];
  const target = email.trim().toLowerCase();

  const direct = allUsers.filter(u => 
    (u['Capitan a Cargo'] || '').trim().toLowerCase() === target && 
    (u.Email || '').trim().toLowerCase() !== target
  );

  const result = [...direct];

  direct.forEach(sub => {
    // Si el subordinado tiene rango que pueda tener a su vez subordinados
    if (sub['Rango'] !== 'Tripulante') {
      result.push(...getSubordinatesTransitiveGS(sub.Email, allUsers));
    }
  });

  // Eliminar duplicados
  const unique = [];
  const seen = new Set();
  result.forEach(u => {
    const em = (u.Email || '').trim().toLowerCase();
    if (em && !seen.has(em)) {
      seen.add(em);
      unique.push(u);
    }
  });

  return unique;
}

/**
 * Calcula los últimos 5 logros de visas completadas para una tripulación o flota.
 */
function getLatestAchievementsGS(allUsers, filterCaptainEmail) {
  const visas = [
    'Visa de Zarpe', 
    'Visa de Navegacion', 
    'Visa de Aduanas', 
    'Visa de Descarga', 
    'Visa de Transito'
  ];

  const badgeNames = {
    'Visa de Zarpe': 'Insignia Argonauta',
    'Visa de Navegacion': 'Insignia Navegante',
    'Visa de Aduanas': 'Insignia Estratega',
    'Visa de Descarga': 'Insignia Timonel',
    'Visa de Transito': 'Insignia Ulises'
  };

  const capFilter = filterCaptainEmail ? filterCaptainEmail.trim().toLowerCase() : null;
  const achievements = [];

  allUsers.forEach(user => {
    if (capFilter && (user['Capitan a Cargo'] || '').trim().toLowerCase() !== capFilter) {
      return;
    }

    visas.forEach(visa => {
      const val = (user[visa] || '').toString().trim();
      let isDone = false;
      if (val.toLowerCase() === 'si') {
        isDone = true;
      } else if (!isNaN(parseInt(val)) && parseInt(val) >= 100) {
        isDone = true;
      }

      if (isDone) {
        const dateKey = `Fecha ${visa}`;
        achievements.push({
          name: user['Nombre Tripulante'] || user['Nombre Tripultante'] || user.Email,
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
 * Función Administrativa: Crea y estiliza la pestaña "Usuarios" en la planilla actual.
 * Ejecutable directamente desde el editor de Google Apps Script.
 */
function crearPestanaUsuarios() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_USUARIOS);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_USUARIOS);
  }

  // Si está vacía, agregar encabezados
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS_USUARIOS);
  }

  // Estilo visual Portland (Azul Marino + Dorado)
  const headerRange = sheet.getRange(1, 1, 1, HEADERS_USUARIOS.length);
  headerRange.setBackground('#0F2035');
  headerRange.setFontColor('#E6C875');
  headerRange.setFontWeight('bold');
  headerRange.setFontFamily('Arial');
  headerRange.setHorizontalAlignment('center');
  sheet.setFrozenRows(1);

  // Autoajuste de anchos de columna
  for (let c = 1; c <= HEADERS_USUARIOS.length; c++) {
    sheet.autoResizeColumn(c);
  }

  SpreadsheetApp.getUi().alert(
    '✅ Pestaña "Usuarios" lista',
    'La pestaña "Usuarios" ha sido creada y formateada con los 20 encabezados oficiales. Ahora puedes pegar los registros de usuarios debajo de los encabezados.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}
