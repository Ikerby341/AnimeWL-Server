import supabase from '../config/db.js';
import axios from 'axios';

const KEYS_TO_COMPARE = ['titol', 'sinopsi', 'estat', 'imatge_portada', 'dataAfegit'];

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
    if (!id_anime) return 0;

    try {
        const { data, error } = await supabase
            .from('capitol')
            .select('numero')
            .eq('id_anime', id_anime)
            .order('numero', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (!error && data) {
            return Number(data.numero || 0);
        }
    } catch (err) {
        console.error('episode count query error', err);
    }

    return 0;
}

export async function testDbConnection() {
    return await supabase
        .from('anime')
        .select('*')
        .limit(1);
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
    const m = val.toString().match(/(\d+)\s*min/);
    return m ? parseInt(m[1], 10) : null;
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
            const res = await axios.get(url);
            return res.data.data;
        } catch (err) {
            if (err.response && err.response.status === 429) {
                attempts++;
                const delay = Math.min(1000 * 2 ** attempts, 30000);
                console.warn(`rate limit hit on episode detail, waiting ${delay}ms`);
                await new Promise((r) => setTimeout(r, delay));
                continue;
            }
            throw err;
        }
    }
}

export async function upsertChapters(id_anime, episodeNumbers = [], options = { replaceExisting: false }) {
    if (!id_anime) return;
    try {
        if (options.replaceExisting) {
            await supabase.from('capitol').delete().eq('id_anime', id_anime);
        }

        if (episodeNumbers.length === 0) {
            console.log(`upsertChapters [${id_anime}]: no hay episodios nuevos`);
            return;
        }

        // los números ya vienen ordenados de forma ascendente desde fetchNewEpisodeNumbers,
        // así que empezamos exactamente por el primero que falta
        console.log(
            `upsertChapters [${id_anime}]: ${episodeNumbers.length} episodios nuevos` +
            ` a partir del ${episodeNumbers[0]}`
        );

        for (const num of episodeNumbers) {
            let title = '';
            let duration = null;
            let hasEpisodeData = false;

            // llamar directamente al endpoint individual para obtener título y duración
            try {
                await new Promise((r) => setTimeout(r, 2000));
                const det = await fetchEpisodeDetail(id_anime, num);
                hasEpisodeData = hasUsableEpisodeDetail(det);
                if (hasEpisodeData) {
                    title = det.title || '';
                    duration = parseDuration(det.duration);
                }
            } catch (err) {
                console.error(`episode detail fetch error (ep ${num})`, err.message);
            }

            if (!hasEpisodeData) {
                console.warn(`upsertChapters: skipping placeholder episode ${num} for anime ${id_anime}`);
                break;
            }

            const id_capitol = `${id_anime}-${num}`;
            const rec = {
                id_capitol,
                id_anime,
                titol: title,
                numero: num,
                duracio_minuts: duration || null,
            };
            console.log(`upsertChapters: inserting episode ${num} for anime ${id_anime}`, rec);
            const { error } = await supabase.from('capitol').upsert(rec, { onConflict: 'id_capitol' });
            if (error) {
                console.error('upsert chapter error', error, 'num:', num);
            } else {
                console.log(`upsertChapters: episode ${num} saved successfully`);
            }
        }
    } catch (err) {
        console.error('upsertChapters error', err);
    }
}

// retornar la lista completa de animes (sin paginar), incluyendo recuento de capítulos
export async function listAnimes(genre = null, limit = null) {
    let query = supabase
        .from('anime')
        .select(genre ? '*, anime_genere!inner(id_genere)' : '*')
        .order('lastupdate', { ascending: false })
        .limit(limit || null);

    if (genre) {
        query = query.eq('anime_genere.id_genere', genre);
    }

    const { data: animeData, error } = await query;

    if (error) {
        console.error('listAnimes error', error);
        throw error;
    }

    const animes = animeData || [];

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
