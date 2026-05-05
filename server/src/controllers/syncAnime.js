import axios from 'axios';
import { upsertAnime, upsertAnimeGenres, upsertChapters, touchAnimeLastUpdate, hasUsableEpisodeDetail } from '../models/anime_model.js';
import supabase from '../config/db.js';

async function fetchAnimePage(page = 1) {
    const url = `https://api.jikan.moe/v4/anime?page=${page}`;
    let attempts = 0;
    while (true) {
        try {
            const res = await axios.get(url);
            return res.data;
        } catch (err) {
            if (err.response && err.response.status === 429) {
                attempts++;
                const delay = Math.min(1000 * 2 ** attempts, 30000);
                console.warn(`rate limit hit, waiting ${delay}ms`);
                await new Promise((r) => setTimeout(r, delay));
                continue;
            }
            throw err;
        }
    }
}

export function mapJikanToDb(anime) {
    return {
        id_anime: anime.mal_id.toString(),
        titol: anime.title,
        sinopsi: anime.synopsis,
        estat: anime.status,
        imatge_portada: anime.images?.jpg?.image_url || anime.image_url,
        dataafegit: anime.aired?.from || null,
        lastupdate: anime.updated_at || new Date().toISOString(),
        genres: anime.genres ? anime.genres.map((g) => g.name) : [],
    };
}

async function fetchJikanJson(url) {
    let attempts = 0;
    while (true) {
        try {
            const res = await axios.get(url);
            return res.data;
        } catch (err) {
            const status = err.response?.status;
            if (status === 429) {
                attempts += 1;
                const delay = Math.min(1000 * 2 ** attempts, 30000);
                console.warn(`rate limit hit when fetching ${url}, waiting ${delay}ms`);
                await new Promise((r) => setTimeout(r, delay));
                continue;
            }
            if (status >= 500) {
                console.error(`Jikan server error ${status} for ${url}`);
                return null;
            }
            throw err;
        }
    }
}

// obtener el número del último episodio almacenado en BBDD para un anime
async function getMaxStoredEpisode(id_anime) {
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

function getEpisodeListTotal(json) {
    const total = Number(json?.pagination?.items?.total);
    return Number.isFinite(total) ? total : null;
}

function getEpisodeListPerPage(json) {
    const perPage = Number(json?.pagination?.items?.per_page);
    return Number.isFinite(perPage) && perPage > 0 ? perPage : 25;
}

function getEpisodeListLastPage(json) {
    const lastPage = Number(json?.pagination?.last_visible_page);
    return Number.isFinite(lastPage) && lastPage > 0 ? lastPage : null;
}

function getMissingEpisodeNumbersFromCount(apiEpisodeCount, maxStoredEpisode, maxEpisodes = 5) {
    if (!Number.isFinite(apiEpisodeCount) || apiEpisodeCount <= maxStoredEpisode) {
        return [];
    }

    const firstMissingEpisode = maxStoredEpisode + 1;
    const lastMissingEpisode = apiEpisodeCount;
    const firstEpisodeToFetch = Math.max(firstMissingEpisode, lastMissingEpisode - maxEpisodes + 1);
    const numbers = [];

    for (let num = firstEpisodeToFetch; num <= lastMissingEpisode; num++) {
        numbers.push(num);
    }

    return numbers;
}

async function fetchExistingNextEpisodeNumbers(animeId, maxStoredEpisode, maxEpisodes = 5) {
    const numbers = [];

    for (let offset = 1; offset <= maxEpisodes; offset++) {
        const episodeNumber = maxStoredEpisode + offset;

        try {
            if (offset > 1) {
                await new Promise((r) => setTimeout(r, 500));
            }

            const json = await fetchJikanJson(`https://api.jikan.moe/v4/anime/${animeId}/episodes/${episodeNumber}`);
            if (hasUsableEpisodeDetail(json?.data)) {
                numbers.push(episodeNumber);
                continue;
            }
        } catch (err) {
            if (err.response?.status === 404) {
                break;
            }
            throw err;
        }

        break;
    }

    return numbers;
}

async function fetchEpisodeListInfo(animeId) {
    const json = await fetchJikanJson(`https://api.jikan.moe/v4/anime/${animeId}/episodes?page=1`);
    if (!json || !json.data) {
        return { json: null, total: null, hasEpisodes: false };
    }

    return {
        json,
        total: getEpisodeListTotal(json),
        hasEpisodes: json.data.length > 0
    };
}

// consulta el endpoint de lista paginado (datos ligeros) solo para obtener
// los números de episodio que aún no tenemos, saltando a la página correcta
// para evitar peticiones innecesarias a Jikan
async function fetchNewEpisodeNumbers(animeId, maxStoredEpisode = 0, firstJson = null) {
    const numbers = [];

    // primera petición para conocer per_page y calcular la página de inicio
    firstJson = firstJson || await fetchJikanJson(`https://api.jikan.moe/v4/anime/${animeId}/episodes?page=1`);
    if (!firstJson || !firstJson.data) return numbers;

    const perPage = getEpisodeListPerPage(firstJson);
    const lastPage = getEpisodeListLastPage(firstJson);

    // saltar directamente a la página donde está el primer episodio que nos falta
    let page = maxStoredEpisode > 0 ? Math.floor(maxStoredEpisode / perPage) + 1 : 1;
    if (lastPage !== null && page > lastPage) {
        page = lastPage;
    }

    // si la página de inicio es 1 ya tenemos los datos, si no hay que pedirla
    let json = page === 1
        ? firstJson
        : await fetchJikanJson(`https://api.jikan.moe/v4/anime/${animeId}/episodes?page=${page}`);

    while (json && json.data) {
        for (const ep of json.data) {
            const num = ep.episode ?? ep.mal_id ?? null;
            if (num != null && num > maxStoredEpisode) {
                numbers.push(num);
            }
        }
        if (!json.pagination?.has_next_page) break;
        page++;
        json = await fetchJikanJson(`https://api.jikan.moe/v4/anime/${animeId}/episodes?page=${page}`);
    }

    return numbers.sort((a, b) => a - b);
}

// helper que sincroniza sólo la información básica (sin capítulos)
export async function syncAnimeMetadataById(idAnime) {
    if (!idAnime) return;
    const url = `https://api.jikan.moe/v4/anime/${idAnime}/full`;
    const json = await fetchJikanJson(url);
    const data = json?.data;
    if (!data) return null;

    const record = mapJikanToDb(data);
    await upsertAnime(record);
    if (record.genres && record.genres.length > 0) {
        await upsertAnimeGenres(record.id_anime, record.genres);
    }
    return record;
}

// sincronizar un anime por id: metadatos + episodios nuevos
export async function syncAnimeById(idAnime) {
    if (!idAnime) return;
    const url = `https://api.jikan.moe/v4/anime/${idAnime}/full`;
    const json = await fetchJikanJson(url);
    const data = json?.data;
    if (!data) return null;

    const record = mapJikanToDb(data);
    await upsertAnime(record);
    if (record.genres && record.genres.length > 0) {
        await upsertAnimeGenres(record.id_anime, record.genres);
    }

    let apiEpisodeCount = Number.isFinite(Number(data.episodes)) ? Number(data.episodes) : null;
    let firstEpisodeListJson = null;
    let shouldProbeNextEpisodes = false;

    console.log(`syncAnimeById [${idAnime}]: API reports ${apiEpisodeCount} episodes`);

    // número del último episodio almacenado (no conteo de filas, para evitar
    // fallos si hay huecos) — es la referencia correcta para saber qué falta
    const maxStoredEpisode = await getMaxStoredEpisode(record.id_anime);
    console.log(`syncAnimeById [${idAnime}]: max stored episode = ${maxStoredEpisode}`);

    try {
        if (apiEpisodeCount === 0) {
            const episodeListInfo = await fetchEpisodeListInfo(record.id_anime);
            firstEpisodeListJson = episodeListInfo.json;

            if (episodeListInfo.total !== null || episodeListInfo.hasEpisodes) {
                const verifiedEpisodeCount = episodeListInfo.total;
                console.log(
                    `syncAnimeById [${idAnime}]: API general view reports 0 episodes, ` +
                    `episodes view reports ${verifiedEpisodeCount ?? 'unknown total'}`
                );
                apiEpisodeCount = verifiedEpisodeCount;
                shouldProbeNextEpisodes = verifiedEpisodeCount === null;
            }
        }

        const needsSync =
            shouldProbeNextEpisodes ||
            (apiEpisodeCount !== null && apiEpisodeCount > maxStoredEpisode) ||
            (apiEpisodeCount === null && maxStoredEpisode === 0);

        console.log(`syncAnimeById [${idAnime}]: needsSync = ${needsSync}`);

        if (needsSync) {
            // solo pedimos los números que nos faltan, empezando desde la página correcta;
            // upsertChapters llama al endpoint individual /episodes/{num} para cada uno
            const newNumbers = await fetchNewEpisodeNumbers(record.id_anime, maxStoredEpisode, firstEpisodeListJson);
            let numbersToSync = newNumbers.length
                ? newNumbers
                : getMissingEpisodeNumbersFromCount(apiEpisodeCount, maxStoredEpisode);

            if (!newNumbers.length && !numbersToSync.length && shouldProbeNextEpisodes) {
                numbersToSync = await fetchExistingNextEpisodeNumbers(record.id_anime, maxStoredEpisode);
            }

            if (!newNumbers.length && numbersToSync.length) {
                console.warn(
                    `syncAnimeById [${idAnime}]: episodes list did not return new numbers; ` +
                    `using fallback =`,
                    numbersToSync
                );
            }

            console.log(`syncAnimeById [${idAnime}]: new episode numbers =`, numbersToSync);
            if (numbersToSync.length) {
                await upsertChapters(record.id_anime, numbersToSync, { replaceExisting: false });
                await touchAnimeLastUpdate(record.id_anime);
                console.log(`syncAnimeById [${idAnime}]: chapters saved successfully`);
            }
        } else if (apiEpisodeCount !== null && apiEpisodeCount < maxStoredEpisode) {
            console.warn(
                `Episode count mismatch for anime ${record.id_anime}: ` +
                `API reports ${apiEpisodeCount} but DB has up to episode ${maxStoredEpisode}.`
            );
        }
    } catch (err) {
        console.error('episode fetch error', err.message);
    }
    return record;
}

// función principal de sincronización
export async function syncAllAnime() {
    console.log('Starting anime synchronization');
    let page = 1;
    let pagesTotales = null;

    while (true) {
        const t0 = Date.now();
        try {
            const data = await fetchAnimePage(page);
            if (!data || !data.data || data.data.length === 0) break;

            if (pagesTotales === null && data.pagination?.last_visible_page) {
                pagesTotales = data.pagination.last_visible_page;
            }

            const concurrency = 2;
            for (let i = 0; i < data.data.length; i += concurrency) {
                const chunk = data.data.slice(i, i + concurrency);
                await Promise.all(
                    chunk.map(async (anime) => {
                        const record = mapJikanToDb(anime);
                        await upsertAnime(record);

                        if (record.genres && record.genres.length > 0) {
                            await upsertAnimeGenres(record.id_anime, record.genres);
                        }

                        try {
                            const maxStored = await getMaxStoredEpisode(record.id_anime);
                            const newNumbers = await fetchNewEpisodeNumbers(record.id_anime, maxStored);
                            if (newNumbers.length) {
                                await upsertChapters(record.id_anime, newNumbers, { replaceExisting: false });
                            }
                        } catch (err) {
                            console.error('episode fetch error', err.message);
                        }
                    })
                );
                await new Promise((r) => setTimeout(r, 2000));
            }

            const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
            if (pagesTotales) {
                const remainingSec = (pagesTotales - page) * Number(elapsed);
                console.log(`page ${page} processed in ${elapsed}s; ~${(remainingSec / 60).toFixed(1)}m remaining`);
            } else {
                console.log(`page ${page} processed in ${elapsed}s`);
            }

            if (!data.pagination.has_next_page) break;
            page += 1;
        } catch (err) {
            console.error('fetch page error', err.message);
            break;
        }
    }
    console.log('Anime synchronization finished');
}

export default syncAllAnime;
