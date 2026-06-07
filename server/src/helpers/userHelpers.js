import { trobarAnimePerId } from '../models/anime_model.js';
import { trobarResumValoracionsPerIdAnime } from '../models/rating_model.js';
import { sincronitzarMetadadesAnimePerId } from '../controllers/syncAnime.js';
import { trobarUsuariPerId, trobarUsuariPerNom, trobarUsuariPublicPerId } from '../models/users_model.js';
import { obtenirIdUsuari } from '../utils/auth.js';

/**
 * Enriqueix els favorits amb dades del anime
 */
async function enriquirFavoritsAmbAnime(favorites) {
  return Promise.all(
    favorites.map(async (fav) => {
      try {
        const anime = await trobarAnimePerId(fav.id_anime);
        let ratingData = { average: 0, count: 0 };
        try {
          ratingData = await trobarResumValoracionsPerIdAnime(fav.id_anime);
        } catch (err) {
          console.error(`Error loading rating for anime ${fav.id_anime}:`, err);
        }
        return {
          ...fav,
          anime: anime ? { ...anime, rating: ratingData } : null
        };
      } catch (err) {
        console.error(`Error loading anime ${fav.id_anime}:`, err);
        return {
          ...fav,
          anime: null
        };
      }
    })
  );
}

/**
 * Obté el perfil públic d'un usuari
 */
async function obtenirPerfilPublic(userId) {
  if (!userId) {
    return null;
  }

  try {
    const { data: user, error } = await trobarUsuariPublicPerId(userId);

    if (error || !user) {
      return null;
    }

    return {
      id_usuari: user.id_usuari,
      nom: user.nom,
      img_url: user.img_url,
      id_anime_preferit: user.id_anime_preferit,
      id_anime_recomanat: user.id_anime_recomanat
    };
  } catch (err) {
    console.error('getPublicProfile error', err);
    return null;
  }
}

/**
 * Assegura que un anime existeix, sinó el sincronitza
 */
async function assegurarAnimeExisteix(idAnime) {
  let anime = await trobarAnimePerId(idAnime);
  if (!anime) {
    await sincronitzarMetadadesAnimePerId(idAnime);
    anime = await trobarAnimePerId(idAnime);
  }
  return anime;
}

/**
 * Actualitza les dades de l'usuari a la sessió
 */
function actualitzarUsuariSessio(req, user) {
  req.session.user = {
    ...req.session.user,
    id_usuari: user.id_usuari,
    nom: user.nom,
    email: user.email,
    id_anime_preferit: user.id_anime_preferit,
    id_anime_recomanat: user.id_anime_recomanat,
    img_url: user.img_url,
    isAdmin: Boolean(user.isAdmin)
  };
}

/**
 * Busca un usuari a partir de les dades de sessió
 */
async function trobarUsuariSessio(sessionUser) {
  const userId = obtenirIdUsuari(sessionUser);

  if (userId) {
    const result = await trobarUsuariPerId(userId);
    if (!result.error && result.data) {
      return result;
    }
    if (result.error) {
      return result;
    }
  }

  if (sessionUser?.nom) {
    return trobarUsuariPerNom(sessionUser.nom);
  }

  return { data: null, error: null };
}

/**
 * Verifica que l'usuari és administrador
 */
async function requerirAdmin(req, res) {
  if (!req.session.user) {
    res.status(401).json({ success: false, error: 'No hay sesión activa' });
    return null;
  }

  const result = await trobarUsuariSessio(req.session.user);
  if (result.error) {
    console.error('Error checking admin session:', result.error);
    res.status(500).json({ success: false, error: 'Error al comprobar permisos de administrador.' });
    return null;
  }

  if (!result.data || result.data.isAdmin !== true) {
    res.status(403).json({ success: false, error: 'No tienes permisos de administrador.' });
    return null;
  }

  actualitzarUsuariSessio(req, result.data);
  return result.data;
}

export {
  enriquirFavoritsAmbAnime,
  obtenirPerfilPublic,
  assegurarAnimeExisteix,
  actualitzarUsuariSessio,
  trobarUsuariSessio,
  requerirAdmin
};
