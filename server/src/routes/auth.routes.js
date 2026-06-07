import { Router } from 'express';
import { scryptSync } from 'crypto';
import { trobarUsuariPerNom } from '../models/users_model.js';
import { trobarUsuariSessio, actualitzarUsuariSessio } from '../helpers/userHelpers.js';

function crearRouterAutenticacio() {
  const router = Router();

  /**
   * POST /api/login
   * Inicia sessió amb usuari i contrasenya
   */
  router.post('/api/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Faltan datos de inicio de sesión.' });
    }

    const result = await trobarUsuariPerNom(username);

    if (result.error) {
      console.error('Supabase login error:', result.error);
      return res.status(500).json({ success: false, error: 'Error al iniciar sesión.' });
    }

    if (!result.data) {
      return res.status(401).json({ success: false, error: 'Usuario o contraseña incorrectos.' });
    }

    const storedPassword = result.data.contrasenya;
    const [salt, hashed] = storedPassword.split(':');
    const attemptHash = scryptSync(password, salt, 64).toString('hex');

    if (attemptHash !== hashed) {
      return res.status(401).json({ success: false, error: 'Usuario o contraseña incorrectos.' });
    }

    req.session.user = {
      id_usuari: result.data.id_usuari,
      nom: result.data.nom,
      email: result.data.email,
      id_anime_preferit: result.data.id_anime_preferit,
      id_anime_recomanat: result.data.id_anime_recomanat,
      img_url: result.data.img_url,
      isAdmin: Boolean(result.data.isAdmin)
    };

    return res.json({
      success: true,
      user: req.session.user
    });
  });

  /**
   * GET /api/session
   * Obté la sessió actual de l'usuari
   */
  router.get('/api/session', async (req, res) => {
    try {
      if (!req.session.user) {
        return res.json({ success: true, user: null });
      }

      const refreshedUser = await trobarUsuariSessio(req.session.user);
      if (refreshedUser.error) {
        console.error('Error fetching user session info:', refreshedUser.error);
        return res.status(500).json({ success: false, error: 'Error al comprobar la sesion' });
      }

      if (refreshedUser.data) {
        actualitzarUsuariSessio(req, refreshedUser.data);
        return res.json({ success: true, user: req.session.user });
      }

      req.session = null;
      return res.json({ success: true, user: null });
    } catch (error) {
      console.error('Error in /api/session:', error);
      return res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
  });

  /**
   * GET /api/check-session
   * Verifica si hi ha una sessió activa
   */
  router.get('/api/check-session', async (req, res) => {
    if (!req.session.user) {
      return res.status(401).json({ success: false, error: 'No hay sesión activa' });
    }
    try {
      const result = await trobarUsuariSessio(req.session.user);
      if (result.error) {
        console.error('Error fetching session user info:', result.error);
        return res.status(500).json({ success: false, error: 'Error al comprobar la sesión' });
      }
      if (result.data) {
        req.session.user = {
          id_usuari: result.data.id_usuari,
          nom: result.data.nom,
          email: result.data.email,
          id_anime_preferit: result.data.id_anime_preferit,
          id_anime_recomanat: result.data.id_anime_recomanat,
          img_url: result.data.img_url,
          isAdmin: Boolean(result.data.isAdmin)
        };
        return res.json({ success: true, user: req.session.user });
      }
    } catch (error) {
      console.error('Error fetching session user info:', error);
      return res.status(500).json({ success: false, error: 'Error al comprobar la sesión' });
    }

    return res.json({ success: true, user: req.session.user });
  });

  /**
   * POST /api/logout
   * Tanca la sessió
   */
  router.post('/api/logout', (req, res) => {
    req.session = null;
    return res.json({ success: true, message: 'Sesión cerrada correctamente' });
  });

  return router;
}

export { crearRouterAutenticacio };
