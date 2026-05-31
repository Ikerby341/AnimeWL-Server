import supabase from '../config/db.js';
import axios from 'axios';

const KEYS_TO_COMPARE = ['titol', 'sinopsi', 'estat', 'imatge_portada', 'dataAfegit'];
let lastJikanRequestAt = 0;

async function waitForJikanRateLimit() {
    const minIntervalMs = 1100;
    const elapsed = Date.now() - lastJikanRequestAt;
    if (elapsed < minIntervalMs) {
        await new Promise((r) => setTimeout(r, minIntervalMs - elapsed));
    }
    lastJikanRequestAt = Date.now();
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function findAnimeById(id_anime) {
    // aprovechamos la capacidad de PostgREST para hacer un join y
    // traer también los géneros asociados; esto simplifica la respuesta
    const { data, error } = await supabase
        .from('anime')
        .select(`
            *,
            anime_genere(id_genere)
        `)
        .eq('id_anime', id_anime)
        .single();
    if (error && error.code !== 'PGRST116') {
        throw error;
    }
    if (!data) return null;
    // transformar la lista de enlaces a un array simple de strings
    if (data.anime_genere) {
        data.genres = data.anime_genere.map((g) => g.id_genere);
        delete data.anime_genere;
    }

    data.episodeCount = await getEpisodeCountByAnime(id_anime);

    return data;
}

export async function getEpisodeCountByAnime(id_anime) {
    return Number(await getMaxStoredEpisode(id_anime));
}

export async function getMaxStoredEpisode(id_anime) {
    if (!id_anime) return 0;

    try {
        const { data: maxRow, error } = await supabase
            .from('capitol')
            .select('numero')
            .eq('id_anime', id_anime)
            .order('numero', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (!error && maxRow) return maxRow.numero || 0;
    } catch (err) {
        console.error('getMaxStoredEpisode error', err.message);
    }

    return 0;
}

export async function getFirstMissingEpisode(id_anime, episodeCount) {
    if (!id_anime || !Number.isFinite(episodeCount) || episodeCount <= 0) {
        return null;
    }

    const storedNumbers = new Set();
    const pageSize = 1000;

    for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
            .from('capitol')
            .select('numero')
            .eq('id_anime', id_anime)
            .order('numero', { ascending: true })
            .range(from, from + pageSize - 1);

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
}

export async function listGenres() {
    const { data, error } = await supabase
        .from('genere')
        .select('id_genere, nom')
        .order('nom', { ascending: true });

    if (error) {
        throw error;
    }

    return data || [];
}

export async function findAnimesByTitle(query, limit = 10) {
    try {
        const { data, error } = await supabase
            .from('anime')
            .select('*')
            .ilike('titol', `%${query}%`)
            .order('lastupdate', { ascending: false })
            .limit(limit);

        if (error) {
            console.error('findAnimesByTitle error', error);
            return [];
        }

        return data || [];
    } catch (err) {
        console.error('findAnimesByTitle thrown error', err);
        return [];
    }
}

export async function insertAnime(record) {
    const { error } = await supabase.from('anime').insert(record);
    if (error) throw error;
    return record;
}

export async function updateAnime(id_anime, record) {
    const { error } = await supabase
        .from('anime')
        .update(record)
        .eq('id_anime', id_anime);
    if (error) throw error;
    return record;
}

export async function touchAnimeLastUpdate(id_anime) {
    if (!id_anime) return;
    try {
        await updateAnime(id_anime, { lastupdate: new Date().toISOString() });
    } catch (err) {
        console.error('touchAnimeLastUpdate error', err);
    }
}

export async function upsertAnime(record) {
    // the 'anime' table does not include a genres column; genres are
    // stored in the join table. strip them off before touching the main
    // row so we don't trigger insert errors.
    const { genres, ...data } = record;

    let existing;
    try {
        existing = await findAnimeById(data.id_anime);
    } catch (err) {
        console.error('select anime error', err);
        return false;
    }

    if (!existing) {
        try {
            await insertAnime(data);
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
            await updateAnime(data.id_anime, data);
            return true;
        } catch (err) {
            console.error('update error', err);
            return false;
        }
    }

    return false;
}

async function ensureGenre(name) {
    if (!name) return;
    const id_genere = name.toLowerCase().replace(/\s+/g, '_');
    const { error } = await supabase
        .from('genere')
        .upsert({ id_genere, nom: name }, { onConflict: 'id_genere' });
    if (error) console.error('ensure genre error', error);
    return id_genere;
}

export async function upsertAnimeGenres(id_anime, genreList = []) {
    if (!id_anime) return;
    try {
        // eliminar enlaces existentes para poder reinser<|...|>
        await supabase.from('anime_genere').delete().eq('id_anime', id_anime);
        for (const g of genreList) {
            const genId = await ensureGenre(g);
            if (genId) {
                const { error } = await supabase
                    .from('anime_genere')
                    .insert({ id_anime, id_genere: genId });
                if (error) console.error('link anime_genere error', error);
            }
        }
    } catch (err) {
        console.error('upsertAnimeGenres error', err);
    }
}

function parseDuration(val) {
    if (val == null) return null;
    if (typeof val === 'number') {
        // el endpoint de detalle devuelve segundos; convertir a minutos
        return Math.round(val / 60);
    }
    const text = val.toString().toLowerCase();
    const hours = text.match(/(\d+)\s*(?:hr|hrs|hour|hours|h)/);
    const minutes = text.match(/(\d+)\s*(?:min|mins|minute|minutes|m)/);
    const totalMinutes =
        (hours ? parseInt(hours[1], 10) * 60 : 0) +
        (minutes ? parseInt(minutes[1], 10) : 0);

    return totalMinutes > 0 ? totalMinutes : null;
}


// obtener información detallada de un solo episodio
export function hasUsableEpisodeDetail(episode) {
    if (!episode) return false;

    return Boolean(
        episode.aired ||
        episode.duration ||
        episode.synopsis ||
        episode.title?.trim() ||
        episode.title_japanese?.trim() ||
        episode.title_romanji?.trim()
    );
}

async function fetchEpisodeDetail(animeId, epId) {
    const url = `https://api.jikan.moe/v4/anime/${animeId}/episodes/${epId}`;
    let attempts = 0;
    while (true) {
        try {
            await waitForJikanRateLimit();
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
                await wait(delay);
                continue;
            }
            throw err;
        }
    }
}

async function fetchUsableEpisodeDetail(animeId, epId, maxAttempts = 6) {
    let lastDetail = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        lastDetail = await fetchEpisodeDetail(animeId, epId);

        if (hasUsableEpisodeDetail(lastDetail)) {
            return lastDetail;
        }

        if (attempt < maxAttempts) {
            const delay = Math.min(3000 * 2 ** (attempt - 1), 30000);
            console.warn(`episode detail placeholder retry ${attempt} for anime ${animeId} episode ${epId}, waiting ${delay}ms`);
            await wait(delay);
        }
    }

    return lastDetail;
}

export async function upsertChapters(id_anime, episodeNumbers = [], options = { replaceExisting: false }) {
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
                    const det = await fetchUsableEpisodeDetail(id_anime, num, fallbackDetail ? 3 : 6);
                    if (hasUsableEpisodeDetail(det)) {
                        episodeDetail = det;
                    }
                } catch (err) {
                    fetchFailed = true;
                    console.error(`episode detail fetch error (ep ${num})`, err.message);
                }
            }

            if (!hasUsableEpisodeDetail(episodeDetail)) {
                if (fetchFailed && !fallbackDetail) {
                    console.warn(`upsertChapters: stopping at episode ${num} for anime ${id_anime} after detail fetch error`);
                    break;
                }
                console.warn(`upsertChapters: skipping placeholder episode ${num} for anime ${id_anime}`);
                break;
            }

            title = episodeDetail.title || '';
            duration = parseDuration(episodeDetail.duration);

            const id_capitol = `${id_anime}-${num}`;
            const rec = {
                id_capitol,
                id_anime,
                titol: title,
                numero: num,
                duracio_minuts: duration || null,
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
async function attachEpisodeCounts(animes) {
    for (let i = 0; i < animes.length; i += 8) {
        const chunk = animes.slice(i, i + 8);
        await Promise.all(
            chunk.map(async (anime) => {
                anime.episodeCount = await getEpisodeCountByAnime(anime.id_anime);
            })
        );
    }

    return animes;
}

export async function listAiringAnimes(limit = 7) {
    const numericLimit = Number(limit);
    let query = supabase
        .from('anime')
        .select('*')
        .eq('estat', 'Currently Airing')
        .order('lastupdate', { ascending: false });

    if (Number.isFinite(numericLimit) && numericLimit > 0) {
        query = query.limit(numericLimit);
    }

    const { data, error } = await query;

    if (error) {
        console.error('listAiringAnimes error', error);
        throw error;
    }

    return attachEpisodeCounts(data || []);
}

export async function listAnimes(genre = null, limit = null, offset = 0) {
    const numericLimit = Number(limit);
    const numericOffset = Number(offset);
    const hasPagination = Number.isFinite(numericLimit) && numericLimit > 0;

    let query = supabase
        .from('anime')
        .select(genre ? '*, anime_genere!inner(id_genere)' : '*')
        .order('lastupdate', { ascending: false });

    if (hasPagination) {
        const from = Number.isFinite(numericOffset) && numericOffset > 0 ? numericOffset : 0;
        query = query.range(from, from + numericLimit - 1);
    } else if (limit) {
        query = query.limit(limit);
    }

    if (genre) {
        query = query.eq('anime_genere.id_genere', genre);
    }

    const { data: animeData, error } = await query;

    if (error) {
        console.error('listAnimes error', error);
        throw error;
    }

    return attachEpisodeCounts(animeData || []);
}
