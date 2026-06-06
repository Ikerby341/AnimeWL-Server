import axios from 'axios';
import { trobarAnimesPerTitol } from '../models/anime_model.js';

const EXCLUDED_GENRE_IDS = new Set([9, 49]);

function teEntradaGenereExclosa(entries = []) {
  return Array.isArray(entries) && entries.some((entry) => EXCLUDED_GENRE_IDS.has(Number(entry?.mal_id)));
}

function filtrarResultatsAnimeSegurs(animes = []) {
  return (animes || []).filter((anime) =>
  !teEntradaGenereExclosa(anime?.genres) &&
  !teEntradaGenereExclosa(anime?.explicit_genres) &&
  !teEntradaGenereExclosa(anime?.themes)
  );
}

async function obtenirAnimeDeBaseDades(query) {
  return trobarAnimesPerTitol(query);
}export { obtenirAnimeDeBaseDades };

async function cercarJikan(query) {
  const url = `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&limit=10&sfw=true`;
  let attempts = 0;
  while (true) {
    try {
      const response = await axios.get(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'AnimeWL/1.0'
        }
      });
      return filtrarResultatsAnimeSegurs(response.data?.data || []);
    } catch (err) {
      const status = err.response?.status;
      if (status === 429 && attempts < 3) {
        attempts += 1;
        const delay = Math.min(1000 * 2 ** attempts, 30000);
        console.warn(`Jikan rate limit for search, retrying in ${delay}ms`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      console.error('fetchJikanSearch error', {
        status,
        message: err.message,
        url: err.config?.url,
        data: err.response?.data,
        headers: err.response?.headers
      });
      throw err;
    }
  }
}export { cercarJikan };