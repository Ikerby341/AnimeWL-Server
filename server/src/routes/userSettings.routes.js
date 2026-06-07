import { Router } from 'express';
import { scryptSync } from 'crypto';
import {
  trobarUsuariPerCorreu,
  trobarUsuariPerNom,
  actualitzarNomUsuari,
  actualitzarContrasenyaUsuari,
  actualitzarCorreuUsuari,
  actualitzarFotoPerfilUsuari
} from '../models/users_model.js';
import {
  crearHashContrasenya,
  validarCorreuElectronic,
  obtenirUsuariTokenAutenticat,
  obtenirIdUsuari,
  esMateixUsuariAutenticat
} from '../utils/auth.js';
import { enviarCorreuCanviNomUsuariAdmin, enviarCorreuVerificacio } from '../services/emailService.js';
import { trobarUsuariSessio, actualitzarUsuariSessio } from '../helpers/userHelpers.js';

function crearRouterConfiguracio() {
  const router = Router();

  /**
   * GET /api/settings/update-username
   * Ruta GET deshabilitada per a actualització de nom
   */
  router.get('/api/settings/update-username', (req, res) => {
    res.set('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Usa POST para actualizar el nombre de usuario.' });
  });

  /**
   * POST /api/settings/update-username
   * Actualitza el nom de l'usuari
   */
  router.post('/api/settings/update-username', async (req, res) => {
    if (!req.session.user) {
      return res.status(401).json({ success: false, error: 'No hay sesión activa' });
    }
    const tokenUser = obtenirUsuariTokenAutenticat(req);
    if (!tokenUser) {
      return res.status(401).json({ success: false, error: 'Token de autenticacion requerido.' });
    }
    if (!esMateixUsuariAutenticat(req.session.user, tokenUser)) {
      return res.status(403).json({ success: false, error: 'El token no coincide con la sesion activa.' });
    }

    const { newUsername } = req.body;
    if (typeof newUsername !== 'string' || newUsername.trim() === '') {
      return res.status(400).json({ success: false, error: 'El nombre de usuario no puede estar vacío' });
    }
    try {
      const trimmedUsername = newUsername.trim();
      if (trimmedUsername.length > 30) {
        return res.status(400).json({ success: false, error: 'El nombre de usuario no puede superar 30 caracteres.' });
      }

      const userId = obtenirIdUsuari(req.session.user);
      let currentUser = null;

      if (req.session.user.email) {
        const result = await trobarUsuariPerCorreu(req.session.user.email);
        if (result.error) {
          console.error('Error fetching user by session email:', result.error);
          return res.status(500).json({ success: false, error: 'Error al comprobar el usuario de la sesion.' });
        }
        currentUser = result.data;
      }

      if (!currentUser && req.session.user.nom) {
        const result = await trobarUsuariPerNom(req.session.user.nom);
        if (result.error) {
          console.error('Error fetching user by session username:', result.error);
          return res.status(500).json({ success: false, error: 'Error al comprobar el usuario de la sesion.' });
        }
        currentUser = result.data;
      }

      if (!currentUser && !userId) {
        return res.status(401).json({ success: false, error: 'La sesion no contiene datos suficientes para identificar al usuario.' });
      }

      const updateUserId = currentUser?.id_usuari || userId;
      if (!updateUserId) {
        return res.status(404).json({ success: false, error: 'Usuario de sesion no encontrado.' });
      }

      const { data, error } = await actualitzarNomUsuari(updateUserId, trimmedUsername);
      if (error) {
        console.error('Error updating username:', error);
        const errorMessage = error.message || 'Error al actualizar el nombre de usuario';
        const statusCode = errorMessage.includes('registrado') ? 400 : 500;
        return res.status(statusCode).json({ success: false, error: errorMessage });
      }
      let updatedUsernameUser = data;
      if (!updatedUsernameUser) {
        const refreshed = await trobarUsuariPerNom(trimmedUsername);
        if (refreshed.error) {
          console.error('Error fetching updated username:', refreshed.error);
          return res.status(500).json({ success: false, error: 'Error al comprobar el usuario actualizado' });
        }
        updatedUsernameUser = refreshed.data;
      }

      if (!updatedUsernameUser) {
        return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
      }
      actualitzarUsuariSessio(req, updatedUsernameUser);
      return res.json({ success: true, user: req.session.user });
    } catch (error) {
      console.error('Error updating username:', error);
      return res.status(500).json({ success: false, error: 'Error al actualizar el nombre de usuario' });
    }
  });

  /**
   * POST /api/user/update-password
   * Actualitza la contrasenya de l'usuari
   */
  router.post('/api/user/update-password', async (req, res) => {
    if (!req.session.user) {
      return res.status(401).json({ success: false, error: 'No hay sesión activa' });
    }
    const { currentPassword, newPassword, confirmPassword } = req.body;
    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ success: false, error: 'Faltan datos para cambiar la contraseña.' });
    }
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ success: false, error: 'La nueva contraseña y su confirmación no coinciden.' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, error: 'La nueva contraseña debe tener al menos 6 caracteres.' });
    }
    try {
      const result = await trobarUsuariSessio(req.session.user);
      if (result.error) {
        console.error('Error fetching session user info:', result.error);
        return res.status(500).json({ success: false, error: 'Error al comprobar la sesión.' });
      }
      if (!result.data) {
        return res.status(404).json({ success: false, error: 'Usuario no encontrado.' });
      }

      const storedPassword = result.data.contrasenya;
      const [salt, hashed] = storedPassword.split(':');
      const attemptHash = scryptSync(currentPassword, salt, 64).toString('hex');
      if (attemptHash !== hashed) {
        return res.status(400).json({ success: false, error: 'La contraseña actual es incorrecta.' });
      }

      const newHashedPassword = crearHashContrasenya(newPassword);
      const { data, error } = await actualitzarContrasenyaUsuari(req.session.user.id_usuari, newHashedPassword);
      if (error) {
        console.error('Error updating password:', error);
        return res.status(500).json({ success: false, error: 'Error al actualizar la contraseña.' });
      }
      if (!data) {
        return res.status(404).json({ success: false, error: 'Usuario no encontrado.' });
      }

      return res.json({ success: true, message: 'Contraseña actualizada correctamente.' });
    } catch (error) {
      console.error('Error updating password:', error);
      return res.status(500).json({ success: false, error: 'Error al actualizar la contraseña.' });
    }
  });

  /**
   * POST /api/user/send-email-code
   * Envia un codi de verificació al correu de l'usuari
   */
  router.post('/api/user/send-email-code', async (req, res) => {
    if (!req.session.user) {
      return res.status(401).json({ success: false, error: 'No hay sesión activa' });
    }

    const currentEmail = req.session.user.email;
    if (!currentEmail) {
      return res.status(400).json({ success: false, error: 'No se encontró el correo electrónico asociado.' });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    req.session.emailChange = {
      code,
      expiresAt: Date.now() + 10 * 60 * 1000
    };

    try {
      await enviarCorreuVerificacio(currentEmail, code);
      return res.json({ success: true, message: 'Código enviado al correo electrónico actual.' });
    } catch (error) {
      console.error('Error sending email verification code:', error);
      return res.status(500).json({ success: false, error: 'Error al enviar el código de verificación.' });
    }
  });

  /**
   * POST /api/user/update-email
   * Actualitza el correu electrònic de l'usuari
   */
  router.post('/api/user/update-email', async (req, res) => {
    if (!req.session.user) {
      return res.status(401).json({ success: false, error: 'No hay sesión activa' });
    }

    const { code, newEmail } = req.body;
    if (!code || !newEmail) {
      return res.status(400).json({ success: false, error: 'Faltan datos para cambiar el correo electrónico.' });
    }

    if (!validarCorreuElectronic(newEmail)) {
      return res.status(400).json({ success: false, error: 'El nuevo correo electrónico no es válido.' });
    }

    const sessionCode = req.session.emailChange?.code;
    const expiresAt = req.session.emailChange?.expiresAt;

    if (!sessionCode || !expiresAt || Date.now() > expiresAt) {
      return res.status(400).json({ success: false, error: 'El código de verificación ha caducado. Vuelve a solicitar uno nuevo.' });
    }

    if (String(code).trim() !== String(sessionCode).trim()) {
      return res.status(400).json({ success: false, error: 'El código de verificación no es correcto.' });
    }

    if (newEmail.trim().toLowerCase() === req.session.user.email?.trim().toLowerCase()) {
      return res.status(400).json({ success: false, error: 'El nuevo correo debe ser diferente al actual.' });
    }

    try {
      const existingEmail = await trobarUsuariPerCorreu(newEmail.trim());
      if (existingEmail.error) {
        console.error('Error checking email uniqueness:', existingEmail.error);
        return res.status(500).json({ success: false, error: 'Error al comprobar el correo electrónico.' });
      }
      if (existingEmail.data) {
        return res.status(400).json({ success: false, error: 'Ese correo electrónico ya está registrado.' });
      }

      const { data, error } = await actualitzarCorreuUsuari(req.session.user.id_usuari, newEmail.trim());
      if (error) {
        console.error('Error updating email:', error);
        return res.status(500).json({ success: false, error: 'Error al actualizar el correo electrónico.' });
      }
      if (!data) {
        return res.status(404).json({ success: false, error: 'Usuario no encontrado.' });
      }

      req.session.user.email = newEmail.trim();
      delete req.session.emailChange;
      return res.json({ success: true, message: 'Correo electrónico actualizado correctamente.' });
    } catch (error) {
      console.error('Error updating email:', error);
      return res.status(500).json({ success: false, error: 'Error al actualizar el correo electrónico.' });
    }
  });

  /**
   * POST /api/update-profile-picture
   * Actualitza la foto de perfil de l'usuari
   */
  router.post('/api/update-profile-picture', async (req, res) => {
    const { img_url } = req.body;
    if (!req.session.user) {
      return res.status(401).json({ success: false, error: 'No hay sesión activa' });
    }
    if (!img_url || typeof img_url !== 'string' || !/^https?:\/\/.+\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(img_url)) {
      return res.status(400).json({ success: false, error: 'URL de imagen no válida' });
    }
    try {
      const { data, error } = await actualitzarFotoPerfilUsuari(req.session.user.id_usuari, img_url);

      if (error) {
        console.error('Error updating profile picture:', error);
        return res.status(500).json({ success: false, error: 'Error al actualizar la foto de perfil' });
      }

      if (!data) {
        return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
      }

      return res.json({ success: true, user: data });
    } catch (error) {
      console.error('Error updating profile picture:', error);
      return res.status(500).json({ success: false, error: 'Error al actualizar la foto de perfil' });
    }
  });

  return router;
}

export { crearRouterConfiguracio };
