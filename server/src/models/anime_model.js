import supabase from '../config/db.js';
import axios from 'axios';

const KEYS_TO_COMPARE = ['titol', 'sinopsi', 'estat', 'imatge_portada', 'dataAfegit'];
let lastJikanRequestAt = 0;

async function esperarLimitRitmeJikan() {
  const minIntervalMs = 1100;
  const elapsed = Date.now() - lastJikanRequestAt;
  if (elapsed < minIntervalMs) {
    await new Promise((r) => setTimeout(r, minIntervalMs - elapsed));
  }
  lastJikanRequestAt = Date.now();
}

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function trobarAnimePerId(id_anime) {
  // aprovechamos la capacidad de PostgREST para hacer un join y
  // traer también los géneros asociados; esto simplifica la respuesta
  const { data, error } = await supabase.
  from('anime').
  select(`
            *,
            anime_genere(id_genere)
        `).
  eq('id_anime', id_anime).
  single();
  if (error && error.code !== 'PGRST116') {
    throw error;
  }
  if (!data) return null;
  // transformar la lista de enlaces a un array simple de strings
  if (data.anime_genere) {
    data.genres = data.anime_genere.map((g) => g.id_genere);
    delete data.anime_genere;
  }

  data.episodeCount = await obtenirNombreEpisodisPerAnime(id_anime);

  return data;
}export { trobarAnimePerId };

async function obtenirNombreEpisodisPerAnime(id_anime) {
  return Number(await obtenirMaxEpisodiDesat(id_anime));
}export { obtenirNombreEpisodisPerAnime };

async function obtenirMaxEpisodiDesat(id_anime) {
  if (!id_anime) return 0;

  try {
    const { data: maxRow, error } = await supabase.
    from('capitol').
    select('numero').
    eq('id_anime', id_anime).
    order('numero', { ascending: false }).
    limit(1).
    maybeSingle();

    if (!error && maxRow) return maxRow.numero || 0;
  } catch (err) {
    console.error('getMaxStoredEpisode error', err.message);
  }

  return 0;
}export { obtenirMaxEpisodiDesat };

async function obtenirPrimerEpisodiFaltant(id_anime, episodeCount) {
  if (!id_anime || !Number.isFinite(episodeCount) || episodeCount <= 0) {
    return null;
  }

  const storedNumbers = new Set();
  const pageSize = 1000;

  for (let from = 0;; from += pageSize) {
    const { data, error } = await supabase.
    from('capitol').
    select('numero').
    eq('id_anime', id_anime).
    order('numero', { ascending: true }).
    range(from, from + pageSize - 1);

    if (error) {
      console.error('getFirstMissingEpisode error', error);
      return null;
    }

    for (const row of data || []) {
      const numero = Number(row.numero);
      if (Number.isFinite(numero)) {
        storedNumbers.add(numero);
      }
    }

    if (!data || data.length < pageSize) break;
  }

  for (let episode = 1; episode <= episodeCount; episode++) {
    if (!storedNumbers.has(episode)) {
      return episode;
    }
  }

  return null;
}export { obtenirPrimerEpisodiFaltant };

async function llistarGeneres() {
  const { data, error } = await supabase.
  from('genere').
  select('id_genere, nom').
  order('nom', { ascending: true });

  if (error) {
    throw error;
  }

  return data || [];
}export { llistarGeneres };

async function trobarAnimesPerTitol(query, limit = 10) {
  try {
    const { data, error } = await supabase.
    from('anime').
    select('*').
    ilike('titol', `%${query}%`).
    order('lastupdate', { ascending: false }).
    limit(limit);

    if (error) {
      console.error('findAnimesByTitle error', error);
      return [];
    }

    return data || [];
  } catch (err) {
    console.error('findAnimesByTitle thrown error', err);
    return [];
  }
}export { trobarAnimesPerTitol };

async function inserirAnime(record) {
  const { error } = await supabase.from('anime').insert(record);
  if (error) throw error;
  return record;
}export { inserirAnime };

async function actualitzarAnime(id_anime, record) {
  const { error } = await supabase.
  from('anime').
  update(record).
  eq('id_anime', id_anime);
  if (error) throw error;
  return record;
}export { actualitzarAnime };

async function actualitzarDarreraActualitzacioAnime(id_anime) {
  if (!id_anime) return;
  try {
    await actualitzarAnime(id_anime, { lastupdate: new Date().toISOString() });
  } catch (err) {
    console.error('touchAnimeLastUpdate error', err);
  }
}export { actualitzarDarreraActualitzacioAnime };

async function inserirOActualitzarAnime(record) {
  // the 'anime' table does not include a genres column; genres are
  // stored in the join table. strip them off before touching the main
  // row so we don't trigger insert errors.
  const { genres, ...data } = record;

  let existing;
  try {
    existing = await trobarAnimePerId(data.id_anime);
  } catch (err) {
    console.error('select anime error', err);
    return false;
  }

  if (!existing) {
    try {
      await inserirAnime(data);
      return true;
    } catch (err) {
      console.error('insert error', err);
      return false;
    }
  }

  // comparar campos para determinar si es necesario actualizar
  let changed = false;
  for (const k of KEYS_TO_COMPARE) {
    if ((existing[k] || '') !== (data[k] || '')) {
      changed = true;
      break;
    }
  }
  if (changed) {
    data.lastupdate = new Date().toISOString();
    try {
      await actualitzarAnime(data.id_anime, data);
      return true;
    } catch (err) {
      console.error('update error', err);
      return false;
    }
  }

  return false;
}export { inserirOActualitzarAnime };

async function assegurarGenere(name) {
  if (!name) return;
  const id_genere = name.toLowerCase().replace(/\s+/g, '_');
  const { error } = await supabase.
  from('genere').
  upsert({ id_genere, nom: name }, { onConflict: 'id_genere' });
  if (error) console.error('ensure genre error', error);
  return id_genere;
}

async function inserirOActualitzarGeneresAnime(id_anime, genreList = []) {
  if (!id_anime) return;
  try {
    // eliminar enlaces existentes para poder reinser<|...|>
    await supabase.from('anime_genere').delete().eq('id_anime', id_anime);
    for (const g of genreList) {
      const genId = await assegurarGenere(g);
      if (genId) {
        const { error } = await supabase.
        from('anime_genere').
        insert({ id_anime, id_genere: genId });
        if (error) console.error('link anime_genere error', error);
      }
    }
  } catch (err) {
    console.error('upsertAnimeGenres error', err);
  }
}export { inserirOActualitzarGeneresAnime };

function analitzarDurada(val) {
  if (val == null) return null;
  if (typeof val === 'number') {
    // el endpoint de detalle devuelve segundos; convertir a minutos
    return Math.round(val / 60);
  }
  const text = val.toString().toLowerCase();
  const hours = text.match(/(\d+)\s*(?:hr|hrs|hour|hours|h)/);
  const minutes = text.match(/(\d+)\s*(?:min|mins|minute|minutes|m)/);
  const totalMinutes =
  (hours ? parseInt(hours[1], 10) * 60 : 0) + (
  minutes ? parseInt(minutes[1], 10) : 0);

  return totalMinutes > 0 ? totalMinutes : null;
}


// obtener información detallada de un solo episodio
function teDetallEpisodiAprofitable(episode) {
  if (!episode) return false;

  return Boolean(
    episode.aired ||
    episode.duration ||
    episode.synopsis ||
    episode.title?.trim() ||
    episode.title_japanese?.trim() ||
    episode.title_romanji?.trim()
  );
}export { teDetallEpisodiAprofitable };

async function obtenirDetallEpisodi(animeId, epId) {
  const url = `https://api.jikan.moe/v4/anime/${animeId}/episodes/${epId}`;
  let attempts = 0;
  while (true) {
    try {
      await esperarLimitRitmeJikan();
      const res = await axios.get(url);
      return res.data.data;
    } catch (err) {
      const status = err.response?.status;
      if (status === 429 || status >= 500 || !err.response) {
        attempts++;
        if (attempts > 5) {
          throw err;
        }

        const delay = Math.min(1500 * 2 ** attempts, 30000);
        console.warn(`episode detail fetch retry ${attempts} for anime ${animeId} episode ${epId}, waiting ${delay}ms`);
        await esperar(delay);
        continue;
      }
      throw err;
    }
  }
}

async function obtenirDetallEpisodiAprofitable(animeId, epId, maxAttempts = 6) {
  let lastDetail = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    lastDetail = await obtenirDetallEpisodi(animeId, epId);

    if (teDetallEpisodiAprofitable(lastDetail)) {
      return lastDetail;
    }

    if (attempt < maxAttempts) {
      const delay = Math.min(3000 * 2 ** (attempt - 1), 30000);
      console.warn(`episode detail placeholder retry ${attempt} for anime ${animeId} episode ${epId}, waiting ${delay}ms`);
      await esperar(delay);
    }
  }

  return lastDetail;
}

async function inserirOActualitzarCapitols(id_anime, episodeNumbers = [], options = { replaceExisting: false }) {
  if (!id_anime) return;
  try {
    if (options.replaceExisting) {
      await supabase.from('capitol').delete().eq('id_anime', id_anime);
    }

    if (episodeNumbers.length === 0) {
      return;
    }

    // los números ya vienen ordenados de forma ascendente desde fetchNewEpisodeNumbers,
    // así que empezamos exactamente por el primero que falta
    for (const num of episodeNumbers) {
      let title = '';
      let duration = null;
      const fallbackDetail = options.episodeDetailsByNumber?.[num];
      let episodeDetail = fallbackDetail;
      const shouldFetchEpisodeDetail = !options.skipEpisodeDetailForNumbers?.includes(num);
      let fetchFailed = false;

      // llamar directamente al endpoint individual para obtener título y duración
      if (shouldFetchEpisodeDetail) {
        try {
          const det = await obtenirDetallEpisodiAprofitable(id_anime, num, fallbackDetail ? 3 : 6);
          if (teDetallEpisodiAprofitable(det)) {
            episodeDetail = det;
          }
        } catch (err) {
          fetchFailed = true;
          console.error(`episode detail fetch error (ep ${num})`, err.message);
        }
      }

      if (!teDetallEpisodiAprofitable(episodeDetail)) {
        if (fetchFailed && !fallbackDetail) {
          console.warn(`upsertChapters: stopping at episode ${num} for anime ${id_anime} after detail fetch error`);
          break;
        }
        console.warn(`upsertChapters: skipping placeholder episode ${num} for anime ${id_anime}`);
        break;
      }

      title = episodeDetail.title || '';
      duration = analitzarDurada(episodeDetail.duration);

      const id_capitol = `${id_anime}-${num}`;
      const rec = {
        id_capitol,
        id_anime,
        titol: title,
        numero: num,
        duracio_minuts: duration || null
      };
      const { error } = await supabase.from('capitol').upsert(rec, { onConflict: 'id_capitol' });
      if (error) {
        console.error('upsert chapter error', error, 'num:', num);
      }
    }
  } catch (err) {
    console.error('upsertChapters error', err);
  }
}

// retornar la lista completa de animes (sin paginar), incluyendo recuento de capítulos
export { inserirOActualitzarCapitols };async function adjuntarComptadorsEpisodis(animes) {
  for (let i = 0; i < animes.length; i += 8) {
    const chunk = animes.slice(i, i + 8);
    await Promise.all(
      chunk.map(async (anime) => {
        anime.episodeCount = await obtenirNombreEpisodisPerAnime(anime.id_anime);
      })
    );
  }

  return animes;
}

function normalitzarRangValoracio({ minRating = null, maxRating = null } = {}) {
  const min = Number(minRating);
  const max = Number(maxRating);
  const normalizedMin = Number.isFinite(min) ? Math.min(Math.max(min, 0), 5) : 0;
  const normalizedMax = Number.isFinite(max) ? Math.min(Math.max(max, 0), 5) : 5;

  return {
    minRating: Math.min(normalizedMin, normalizedMax),
    maxRating: Math.max(normalizedMin, normalizedMax)
  };
}

async function obtenirIdsAnimePerRangValoracio(ratingRange = {}) {
  const { minRating, maxRating } = normalitzarRangValoracio(ratingRange);
  const isFullRange = minRating <= 0 && maxRating >= 5;

  if (isFullRange) {
    return null;
  }

  const { data, error } = await supabase.
  from('valoracio').
  select('id_anime, puntuacio');

  if (error) {
    console.error('getAnimeIdsByRatingRange error', error);
    throw error;
  }

  const ratingsByAnime = new Map();
  for (const rating of data || []) {
    if (!rating.id_anime) {
      continue;
    }

    const current = ratingsByAnime.get(rating.id_anime) || { sum: 0, count: 0 };
    current.sum += Number(rating.puntuacio) || 0;
    current.count += 1;
    ratingsByAnime.set(rating.id_anime, current);
  }

  return Array.from(ratingsByAnime.entries()).
  filter(([, rating]) => {
    const average = rating.count > 0 ? rating.sum / rating.count : 0;
    return average >= minRating && average <= maxRating;
  }).
  map(([animeId]) => animeId);
}

async function llistarAnimesEnEmissio(limit = 7) {
  const numericLimit = Number(limit);
  let query = supabase.
  from('anime').
  select('*').
  eq('estat', 'Currently Airing').
  order('lastupdate', { ascending: false });

  if (Number.isFinite(numericLimit) && numericLimit > 0) {
    query = query.limit(numericLimit);
  }

  const { data, error } = await query;

  if (error) {
    console.error('listAiringAnimes error', error);
    throw error;
  }

  return adjuntarComptadorsEpisodis(data || []);
}export { llistarAnimesEnEmissio };

function barrejarElements(items) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
  }
  return shuffled;
}

async function llistarAnimesRecomanatsAleatorisUsuari(limit = 5) {
  const numericLimit = Number(limit);
  const resultLimit = Number.isFinite(numericLimit) && numericLimit > 0 ? numericLimit : 5;

  const { data: recommendationRows, error: recommendationError } = await supabase.
  from('usuari').
  select('id_anime_recomanat').
  not('id_anime_recomanat', 'is', null);

  if (recommendationError) {
    console.error('listRandomUserRecommendedAnimes recommendations error', recommendationError);
    throw recommendationError;
  }

  const recommendedIds = barrejarElements([
  ...new Set((recommendationRows || []).
  map((row) => row.id_anime_recomanat).
  filter(Boolean).
  map((id) => String(id)))]
  ).slice(0, resultLimit);

  let selectedAnimes = [];
  if (recommendedIds.length > 0) {
    const { data: recommendedAnimes, error: animeError } = await supabase.
    from('anime').
    select('*').
    in('id_anime', recommendedIds);

    if (animeError) {
      console.error('listRandomUserRecommendedAnimes anime error', animeError);
      throw animeError;
    }

    const animeById = new Map((recommendedAnimes || []).map((anime) => [String(anime.id_anime), anime]));
    selectedAnimes = recommendedIds.
    map((id) => animeById.get(id)).
    filter(Boolean);
  }

  const selectedIds = new Set(selectedAnimes.map((anime) => String(anime.id_anime)));
  if (selectedAnimes.length < resultLimit) {
    const recentAnimes = await llistarAnimes(null, resultLimit * 3);
    for (const anime of recentAnimes) {
      const animeId = String(anime.id_anime);
      if (!selectedIds.has(animeId)) {
        selectedAnimes.push(anime);
        selectedIds.add(animeId);
      }
      if (selectedAnimes.length >= resultLimit) break;
    }
  }

  return adjuntarComptadorsEpisodis(selectedAnimes.slice(0, resultLimit));
}export { llistarAnimesRecomanatsAleatorisUsuari };

async function llistarAnimes(genre = null, limit = null, offset = 0, filters = {}) {
  const numericLimit = Number(limit);
  const numericOffset = Number(offset);
  const hasPagination = Number.isFinite(numericLimit) && numericLimit > 0;
  const ratingAnimeIds = await obtenirIdsAnimePerRangValoracio(filters);

  if (ratingAnimeIds && ratingAnimeIds.length === 0) {
    return [];
  }

  let query = supabase.
  from('anime').
  select(genre ? '*, anime_genere!inner(id_genere)' : '*').
  order('lastupdate', { ascending: false }).
  order('id_anime', { ascending: true });

  if (hasPagination) {
    const from = Number.isFinite(numericOffset) && numericOffset > 0 ? numericOffset : 0;
    query = query.range(from, from + numericLimit - 1);
  } else if (limit) {
    query = query.limit(limit);
  }

  if (genre) {
    query = query.eq('anime_genere.id_genere', genre);
  }

  if (ratingAnimeIds) {
    query = query.in('id_anime', ratingAnimeIds);
  }

  const { data: animeData, error } = await query;

  if (error) {
    console.error('listAnimes error', error);
    throw error;
  }

  return adjuntarComptadorsEpisodis(animeData || []);
}export { llistarAnimes };
