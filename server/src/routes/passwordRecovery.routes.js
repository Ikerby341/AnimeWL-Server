import { Router } from 'express';
import { scryptSync } from 'crypto';
import {
  trobarUsuariPerCorreu,
  actualitzarContrasenyaUsuari,
  actualitzarTokenRestablimentContrasenya,
  trobarUsuariPerTokenRestabliment,
  netejarTokenRestablimentContrasenya
} from '../models/users_model.js';
import {
  crearHashContrasenya,
  validarCorreuElectronic,
  crearTokenRestablimentContrasenya,
  crearHashTokenRestablimentContrasenya
} from '../utils/auth.js';
import { enviarCorreuRestablimentContrasenya } from '../services/emailService.js';

function crearRouterRecuperacioContrasenya() {
  const router = Router();

  /**
   * POST /api/forgot-password
   * Inicia el procés de recuperació de contrasenya
   */
  router.post('/api/forgot-password', async (req, res) => {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, error: 'El correo electrónico es requerido.' });
    }

    if (!validarCorreuElectronic(email)) {
      return res.status(400).json({ success: false, error: 'El correo electrónico no es válido.' });
    }

    try {
      const result = await trobarUsuariPerCorreu(email.trim());

      if (result.error) {
        console.error('Error finding user by email:', result.error);
        return res.status(500).json({ success: false, error: 'Error al buscar el usuario.' });
      }

      if (!result.data) {
        return res.json({ success: true, message: 'Si el correo existe, recibirás un enlace para restablecer tu contraseña.' });
      }

      const resetToken = crearTokenRestablimentContrasenya();
      const resetTokenHash = crearHashTokenRestablimentContrasenya(resetToken);
      const updateResult = await actualitzarTokenRestablimentContrasenya(email.trim(), resetTokenHash);

      if (updateResult.error) {
        console.error('Error saving reset token:', updateResult.error);
        return res.status(500).json({ success: false, error: 'Error al generar el token de recuperación.' });
      }

      await enviarCorreuRestablimentContrasenya(email.trim(), resetToken);

      return res.json({ success: true, message: 'Si el correo existe, recibirás un enlace para restablecer tu contraseña.' });
    } catch (error) {
      console.error('Error in forgot-password:', error);
      return res.status(500).json({ success: false, error: 'Error al procesar la solicitud.' });
    }
  });

  /**
   * GET /api/verify-reset-token
   * Verifica si un token de recuperació és vàlid
   */
  router.get('/api/verify-reset-token', async (req, res) => {
    const { token } = req.query;

    if (typeof token !== 'string' || !token) {
      return res.status(400).json({ success: false, error: 'Token requerido.' });
    }

    try {
      const resetTokenHash = crearHashTokenRestablimentContrasenya(token);
      const result = await trobarUsuariPerTokenRestabliment(resetTokenHash);

      if (result.error) {
        console.error('Error verifying reset token:', result.error);
        return res.status(500).json({ success: false, error: 'Error al verificar el token.' });
      }

      if (!result.data) {
        return res.status(400).json({ success: false, error: 'Token inválido o expirado.' });
      }

      if (result.data.reset_password_token_expiredate) {
        const expirationDate = new Date(result.data.reset_password_token_expiredate);
        if (new Date() > expirationDate) {
          return res.status(400).json({ success: false, error: 'Token inválido o expirado.' });
        }
      }

      return res.json({ success: true, message: 'Token válido.' });
    } catch (error) {
      console.error('Error in verify-reset-token:', error);
      return res.status(500).json({ success: false, error: 'Error al verificar el token.' });
    }
  });

  /**
   * POST /api/reset-password
   * Restableix la contrasenya amb un token vàlid
   */
  router.post('/api/reset-password', async (req, res) => {
    const { token, newPassword, confirmPassword } = req.body;

    if (typeof token !== 'string' || !token || !newPassword || !confirmPassword) {
      return res.status(400).json({ success: false, error: 'Todos los campos son requeridos.' });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ success: false, error: 'Las contraseñas no coinciden.' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, error: 'La contraseña debe tener al menos 6 caracteres.' });
    }

    try {
      const resetTokenHash = crearHashTokenRestablimentContrasenya(token);
      const result = await trobarUsuariPerTokenRestabliment(resetTokenHash);

      if (result.error) {
        console.error('Error finding user by reset token:', result.error);
        return res.status(500).json({ success: false, error: 'Error al buscar el usuario.' });
      }

      if (!result.data) {
        return res.status(400).json({ success: false, error: 'Token inválido o expirado.' });
      }

      if (result.data.reset_password_token_expiredate) {
        const expirationDate = new Date(result.data.reset_password_token_expiredate);
        if (new Date() > expirationDate) {
          return res.status(400).json({ success: false, error: 'Token inválido o expirado.' });
        }
      }

      const newHashedPassword = crearHashContrasenya(newPassword);
      const updateResult = await actualitzarContrasenyaUsuari(result.data.id_usuari, newHashedPassword);

      if (updateResult.error) {
        console.error('Error updating password:', updateResult.error);
        return res.status(500).json({ success: false, error: 'Error al actualizar la contraseña.' });
      }

      await netejarTokenRestablimentContrasenya(result.data.id_usuari);

      return res.json({ success: true, message: 'Contraseña actualizada correctamente. Ya puedes iniciar sesión con tu nueva contraseña.' });
    } catch (error) {
      console.error('Error in reset-password:', error);
      return res.status(500).json({ success: false, error: 'Error al restablecer la contraseña.' });
    }
  });

  return router;
}

export { crearRouterRecuperacioContrasenya };
