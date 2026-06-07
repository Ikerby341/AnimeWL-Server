import { Router } from 'express';
import { obtenirEstadistiquesUsuari } from '../models/progress_model.js';
import { actualitzarAnimeUsuari } from '../models/users_model.js';
import { obtenirPerfilPublic, assegurarAnimeExisteix, actualitzarUsuariSessio } from '../helpers/userHelpers.js';

function crearRouterEstatistiquesIPerfil() {
  const router = Router();

  /**
   * GET /api/user/stats
   * Obté les estadístiques de l'usuari autenticat
   */
  router.get('/api/user/stats', async (req, res) => {
    if (!req.session.user) {
      return res.status(401).json({ success: false, error: 'No hay sesión activa' });
    }

    try {
      const stats = await obtenirEstadistiquesUsuari(req.session.user.id_usuari);
      return res.json({ success: true, stats });
    } catch (err) {
      console.error('GET /api/user/stats error', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/user/:id/public (i rutes alternatives)
   * Obté el perfil públic d'un usuari
   */
  router.get([
    '/api/user/:id/public',
    '/api/users/:id/public',
    '/api/profile/:id',
    '/api/user/:id'
  ], async (req, res) => {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ success: false, error: 'User ID is required' });
    }

    const user = await obtenirPerfilPublic(id);

    if (!user) {
      return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
    }

    return res.json({ success: true, user, profile: user });
  });

  /**
   * POST /api/user/anime
   * Estableix l'anime preferit o recomanat de l'usuari
   */
  router.post('/api/user/anime', async (req, res) => {
    const { type, id_anime } = req.body;
    if (!req.session.user) {
      return res.status(401).json({ success: false, error: 'No hay sesión activa' });
    }
    if (!['favorite', 'recommended'].includes(type)) {
      return res.status(400).json({ success: false, error: 'Tipo inválido. Usa favorite o recommended.' });
    }
    if (!id_anime) {
      return res.status(400).json({ success: false, error: 'Falta el id del anime.' });
    }

    const field = type === 'favorite' ? 'id_anime_preferit' : 'id_anime_recomanat';
    try {
      const anime = await assegurarAnimeExisteix(id_anime);
      if (!anime) {
        return res.status(500).json({ success: false, error: 'No se pudo sincronizar el anime seleccionado.' });
      }

      const { data, error } = await actualitzarAnimeUsuari(req.session.user.id_usuari, field, id_anime);
      if (error) {
        console.error('Error updating user anime choice:', error);
        return res.status(500).json({ success: false, error: 'Error al actualizar el anime del usuario' });
      }
      if (!data) {
        return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
      }

      actualitzarUsuariSessio(req, data);
      return res.json({ success: true, user: req.session.user });
    } catch (error) {
      console.error('POST /api/user/anime error', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
}

export { crearRouterEstatistiquesIPerfil };
