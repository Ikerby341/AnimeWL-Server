import { Router } from 'express';
import {
  llistarUsuarisAdmin,
  trobarUsuariPerId,
  actualitzarNomUsuari,
  actualitzarRolAdminUsuari
} from '../models/users_model.js';
import { obtenirIdUsuari } from '../utils/auth.js';
import { enviarCorreuCanviNomUsuariAdmin } from '../services/emailService.js';
import { requerirAdmin, actualitzarUsuariSessio } from '../helpers/userHelpers.js';

function crearRouterAdmin() {
  const router = Router();

  /**
   * GET /api/admin/users
   * Obté la llista de tots els usuaris (només per administradors)
   */
  router.get('/api/admin/users', async (req, res) => {
    const adminUser = await requerirAdmin(req, res);
    if (!adminUser) return;

    try {
      const { data, error } = await llistarUsuarisAdmin();
      if (error) {
        console.error('GET /api/admin/users error:', error);
        return res.status(500).json({ success: false, error: 'Error al cargar usuarios.' });
      }

      return res.json({ success: true, users: data || [] });
    } catch (err) {
      console.error('GET /api/admin/users error:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * PATCH /api/admin/users/:userId
   * Actualitza les dades d'un usuari (només per administradors)
   */
  router.patch('/api/admin/users/:userId', async (req, res) => {
    const adminUser = await requerirAdmin(req, res);
    if (!adminUser) return;

    const { userId } = req.params;
    const { nom, isAdmin } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, error: 'Falta el id del usuario.' });
    }

    if (nom !== undefined && (typeof nom !== 'string' || nom.trim() === '')) {
      return res.status(400).json({ success: false, error: 'El nombre de usuario no puede estar vacio.' });
    }

    if (nom !== undefined && nom.trim().length > 30) {
      return res.status(400).json({ success: false, error: 'El nombre de usuario no puede superar 30 caracteres.' });
    }

    if (isAdmin !== undefined && typeof isAdmin !== 'boolean') {
      return res.status(400).json({ success: false, error: 'El rol de administrador debe ser booleano.' });
    }

    try {
      const currentUser = await trobarUsuariPerId(userId);
      if (currentUser.error) {
        console.error('Admin user lookup error:', currentUser.error);
        return res.status(500).json({ success: false, error: 'Error al buscar el usuario.' });
      }

      if (!currentUser.data) {
        return res.status(404).json({ success: false, error: 'Usuario no encontrado.' });
      }

      let updatedUser = currentUser.data;
      let emailWarning = null;
      const trimmedUsername = nom?.trim();
      const usernameChanged = trimmedUsername !== undefined && trimmedUsername !== currentUser.data.nom;

      if (usernameChanged) {
        const { data, error } = await actualitzarNomUsuari(userId, trimmedUsername);
        if (error) {
          const errorMessage = error.message || 'Error al actualizar el nombre de usuario.';
          const statusCode = errorMessage.includes('registrado') ? 400 : 500;
          return res.status(statusCode).json({ success: false, error: errorMessage });
        }
        updatedUser = data || { ...updatedUser, nom: trimmedUsername };
      }

      if (isAdmin !== undefined && isAdmin !== Boolean(updatedUser.isAdmin)) {
        const { data, error } = await actualitzarRolAdminUsuari(userId, isAdmin);
        if (error) {
          console.error('Admin role update error:', error);
          return res.status(500).json({ success: false, error: 'Error al actualizar el rol del usuario.' });
        }
        updatedUser = data || { ...updatedUser, isAdmin };
      }

      if (usernameChanged) {
        try {
          await enviarCorreuCanviNomUsuariAdmin(updatedUser.email || currentUser.data.email, updatedUser.nom);
        } catch (emailError) {
          console.error('Admin username change email error:', emailError);
          emailWarning = 'Usuario actualizado, pero no se pudo enviar el correo informativo.';
        }
      }

      if (String(userId) === String(obtenirIdUsuari(req.session.user))) {
        actualitzarUsuariSessio(req, updatedUser);
      }

      return res.json({
        success: true,
        user: {
          id_usuari: updatedUser.id_usuari,
          nom: updatedUser.nom,
          email: updatedUser.email,
          isAdmin: Boolean(updatedUser.isAdmin)
        },
        warning: emailWarning
      });
    } catch (err) {
      console.error('PATCH /api/admin/users/:userId error:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}

export { crearRouterAdmin };
