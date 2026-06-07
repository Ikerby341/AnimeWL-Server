import { Router } from 'express';
import {
  trobarFavoritsPerUsuari,
  afegirFavorit,
  eliminarFavorit,
  actualitzarEstatFavorit,
  trobarFavoritsPublicsPerUsuari
} from '../models/favorites_model.js';
import {
  enriquirFavoritsAmbAnime,
  assegurarAnimeExisteix
} from '../helpers/userHelpers.js';

function crearRouterFavorits() {
  const router = Router();

  /**
   * GET /api/user/favorites
   * Obté els favorits de l'usuari autenticat
   */
  router.get('/api/user/favorites', async (req, res) => {
    if (!req.session.user) {
      return res.status(401).json({ success: false, error: 'No hay sesión activa' });
    }

    try {
      const favorites = await trobarFavoritsPerUsuari(req.session.user.id_usuari);
      const enrichedFavorites = await enriquirFavoritsAmbAnime(favorites);

      return res.json({ success: true, favorites: enrichedFavorites });
    } catch (err) {
      console.error('GET /api/user/favorites error', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/user/:userId/favorites
   * Obté els favorits d'un usuari (públic o privat segons permisos)
   */
  router.get('/api/user/:userId/favorites', async (req, res) => {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ success: false, error: 'User ID is required' });
    }

    const isOwnProfile = req.session.user && String(req.session.user.id_usuari) === String(userId);

    try {
      if (isOwnProfile) {
        const favorites = await trobarFavoritsPerUsuari(userId);
        const enrichedFavorites = await enriquirFavoritsAmbAnime(favorites);
        return res.json({ success: true, favorites: enrichedFavorites });
      }

      const favorites = await trobarFavoritsPublicsPerUsuari(userId);
      return res.json({ success: true, favorites });
    } catch (err) {
      console.error('GET /api/user/:userId/favorites error', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/user/:userId/favorites/public (i rutes alternatives)
   * Obté els favorits públics d'un usuari
   */
  router.get([
    '/api/user/:userId/favorites/public',
    '/api/users/:userId/favorites/public',
    '/api/profile/:userId/favorites'
  ], async (req, res) => {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ success: false, error: 'User ID is required' });
    }

    try {
      const favorites = await trobarFavoritsPublicsPerUsuari(userId);
      return res.json({ success: true, favorites });
    } catch (err) {
      console.error('GET public user favorites error', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * POST /api/user/favorites/:id_anime
   * Afegeix un anime als favorits
   */
  router.post('/api/user/favorites/:id_anime', async (req, res) => {
    if (!req.session.user) {
      return res.status(401).json({ success: false, error: 'No hay sesión activa' });
    }

    const { id_anime } = req.params;
    if (!id_anime) {
      return res.status(400).json({ success: false, error: 'Falta el id del anime' });
    }

    try {
      const anime = await assegurarAnimeExisteix(id_anime);
      if (!anime) {
        return res.status(500).json({ success: false, error: 'No se pudo sincronizar el anime seleccionado.' });
      }

      const favorite = await afegirFavorit(req.session.user.id_usuari, id_anime);
      return res.json({ success: true, favorite: { ...favorite, anime } });
    } catch (err) {
      console.error('POST /api/user/favorites/:id_anime error', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * DELETE /api/user/favorites/:id_anime
   * Elimina un anime dels favorits
   */
  router.delete('/api/user/favorites/:id_anime', async (req, res) => {
    if (!req.session.user) {
      return res.status(401).json({ success: false, error: 'No hay sesión activa' });
    }

    const { id_anime } = req.params;
    if (!id_anime) {
      return res.status(400).json({ success: false, error: 'Falta el id del anime' });
    }

    try {
      const removed = await eliminarFavorit(req.session.user.id_usuari, id_anime);
      return res.json({ success: true, removed });
    } catch (err) {
      console.error('DELETE /api/user/favorites/:id_anime error', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * PUT /api/user/favorites/:id_anime
   * Actualitza l'estat d'un favorit
   */
  router.put('/api/user/favorites/:id_anime', async (req, res) => {
    if (!req.session.user) {
      return res.status(401).json({ success: false, error: 'No hay sesión activa' });
    }

    const { id_anime } = req.params;
    const { estat } = req.body;

    if (!id_anime || !estat) {
      return res.status(400).json({ success: false, error: 'Falta el id del anime o el estado' });
    }

    try {
      const updated = await actualitzarEstatFavorit(req.session.user.id_usuari, id_anime, estat);
      return res.json({ success: true, updated });
    } catch (err) {
      console.error('PUT /api/user/favorites/:id_anime error', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}

export { crearRouterFavorits };
