import axios from 'axios';
import { findAnimeById, upsertAnime, upsertAnimeGenres, upsertChapters, touchAnimeLastUpdate, hasUsableEpisodeDetail, getMaxStoredEpisode, getFirstMissingEpisode } from '../models/anime_model.js';

let lastJikanRequestAt = 0;

async function waitForJikanRateLimit() {
    const minIntervalMs = 1100;
    const elapsed = Date.now() - lastJikanRequestAt;
    if (elapsed < minIntervalMs) {
        await new Promise((r) => setTimeout(r, minIntervalMs - elapsed));
    }
    lastJikanRequestAt = Date.now();
}

async function fetchAnimePage(page = 1) {
    const url = `https://api.jikan.moe/v4/anime?page=${page}`;
    let attempts = 0;
    while (true) {
        try {
            await waitForJikanRateLimit();
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

function normalizeText(value = '') {
    return value
        .toString()
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();
}

function looksLikeEnglishSynopsis(value = '') {
    const text = normalizeText(value);
    if (!text) return false;

    const englishMatches = text.match(/\b(the|and|with|that|this|from|into|their|they|when|where|who|one|has|have|after|before|world|life|story)\b/g) || [];
    const spanishMatches = text.match(/\b(el|la|los|las|un|una|unos|unas|que|con|para|por|del|esta|este|cuando|donde|historia|vida|mundo)\b/g) || [];
    return englishMatches.length >= 3 && englishMatches.length > spanishMatches.length;
}

function shouldTranslateSynopsis(existingSynopsis, sourceSynopsis) {
    if (!sourceSynopsis) return false;
    if (!existingSynopsis) return true;
    if (normalizeText(existingSynopsis) === normalizeText(sourceSynopsis)) return true;
    return looksLikeEnglishSynopsis(existingSynopsis);
}

async function translateText(text, source = 'en', target = 'es') {
    if (!text) return '';
    const maxLen = 500;
    let translated = '';

    for (let index = 0; index < text.length; index += maxLen) {
        const chunk = text.slice(index, index + maxLen);
        try {
            const response = await axios.get('https://api.mymemory.translated.net/get', {
                params: {
                    q: chunk,
                    langpair: `${source}|${target}`
                },
                timeout: 15000
            });
            translated += response.data?.responseData?.translatedText || chunk;
        } catch (err) {
            console.error('translateText error', err.message);
            translated += chunk;
        }
    }

    return translated;
}

async function buildAnimeRecord(anime) {
    const record = mapJikanToDb(anime);
    const sourceSynopsis = anime.synopsis || '';

    if (!sourceSynopsis) {
        return record;
    }

    let existing = null;
    try {
        existing = await findAnimeById(record.id_anime);
    } catch (err) {
        console.error('buildAnimeRecord existing anime error', err.message);
    }

    if (shouldTranslateSynopsis(existing?.sinopsi, sourceSynopsis)) {
        record.sinopsi = await translateText(sourceSynopsis);
    } else {
        record.sinopsi = existing.sinopsi;
    }

    return record;
}

async function fetchJikanJson(url) {
    let attempts = 0;
    while (true) {
        try {
            await waitForJikanRateLimit();
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
async function fetchNewEpisodeNumbers(animeId, maxStoredEpisode = 0, firstJson = null, episodeDetailsByNumber = null) {
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
                if (episodeDetailsByNumber && hasUsableEpisodeDetail(ep)) {
                    episodeDetailsByNumber[num] = ep;
                }
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

    const record = await buildAnimeRecord(data);
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

    const record = await buildAnimeRecord(data);
    await upsertAnime(record);
    if (record.genres && record.genres.length > 0) {
        await upsertAnimeGenres(record.id_anime, record.genres);
    }

    let apiEpisodeCount = Number.isFinite(Number(data.episodes)) ? Number(data.episodes) : null;
    let firstEpisodeListJson = null;
    let shouldProbeNextEpisodes = false;
    const episodeDetailsByNumber = {};
    const skipEpisodeDetailForNumbers = [];

    if (data.type === 'Movie' && apiEpisodeCount === 1) {
        episodeDetailsByNumber[1] = {
            title: data.title,
            duration: data.duration,
            aired: data.aired?.from,
            synopsis: data.synopsis
        };
        skipEpisodeDetailForNumbers.push(1);
    }


    // número del último episodio almacenado (no conteo de filas, para evitar
    // fallos si hay huecos) — es la referencia correcta para saber qué falta
    const maxStoredEpisode = await getMaxStoredEpisode(record.id_anime);

    try {
        if (apiEpisodeCount === 0) {
            const episodeListInfo = await fetchEpisodeListInfo(record.id_anime);
            firstEpisodeListJson = episodeListInfo.json;

            if (episodeListInfo.total !== null || episodeListInfo.hasEpisodes) {
                const verifiedEpisodeCount = episodeListInfo.total;
                apiEpisodeCount = verifiedEpisodeCount;
                shouldProbeNextEpisodes = verifiedEpisodeCount === null;
            }
        }

        const firstMissingEpisode = await getFirstMissingEpisode(record.id_anime, apiEpisodeCount);
        const needsSync =
            shouldProbeNextEpisodes ||
            firstMissingEpisode !== null ||
            (apiEpisodeCount !== null && apiEpisodeCount > maxStoredEpisode) ||
            (apiEpisodeCount === null && maxStoredEpisode === 0);


        if (needsSync) {
            let syncFromEpisode = maxStoredEpisode;
            if (firstMissingEpisode !== null && firstMissingEpisode <= maxStoredEpisode) {
                syncFromEpisode = firstMissingEpisode - 1;
            }

            // solo pedimos los números que nos faltan, empezando desde la página correcta;
            // upsertChapters llama al endpoint individual /episodes/{num} para cada uno
            const newNumbers = await fetchNewEpisodeNumbers(record.id_anime, syncFromEpisode, firstEpisodeListJson, episodeDetailsByNumber);
            let numbersToSync = newNumbers.length
                ? newNumbers
                : getMissingEpisodeNumbersFromCount(apiEpisodeCount, syncFromEpisode);

            if (!newNumbers.length && !numbersToSync.length && shouldProbeNextEpisodes) {
                numbersToSync = await fetchExistingNextEpisodeNumbers(record.id_anime, syncFromEpisode);
            }

            if (!newNumbers.length && numbersToSync.length) {
                console.warn(
                    `syncAnimeById [${idAnime}]: episodes list did not return new numbers; ` +
                    `using fallback =`,
                    numbersToSync
                );
            }

            if (numbersToSync.length) {
                await upsertChapters(record.id_anime, numbersToSync, {
                    replaceExisting: false,
                    episodeDetailsByNumber,
                    skipEpisodeDetailForNumbers
                });
                await touchAnimeLastUpdate(record.id_anime);
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
    let page = 1;

    while (true) {
        try {
            const data = await fetchAnimePage(page);
            if (!data || !data.data || data.data.length === 0) break;

            const concurrency = 2;
            for (let i = 0; i < data.data.length; i += concurrency) {
                const chunk = data.data.slice(i, i + concurrency);
                await Promise.all(
                    chunk.map(async (anime) => {
                        const record = await buildAnimeRecord(anime);
                        await upsertAnime(record);

                        if (record.genres && record.genres.length > 0) {
                            await upsertAnimeGenres(record.id_anime, record.genres);
                        }

                        try {
                            const maxStored = await getMaxStoredEpisode(record.id_anime);
                            const episodeDetailsByNumber = {};
                            const newNumbers = await fetchNewEpisodeNumbers(record.id_anime, maxStored, null, episodeDetailsByNumber);
                            if (newNumbers.length) {
                                await upsertChapters(record.id_anime, newNumbers, { replaceExisting: false, episodeDetailsByNumber });
                            }
                        } catch (err) {
                            console.error('episode fetch error', err.message);
                        }
                    })
                );
                await new Promise((r) => setTimeout(r, 2000));
            }

            if (!data.pagination.has_next_page) break;
            page += 1;
        } catch (err) {
            console.error('fetch page error', err.message);
            break;
        }
    }
}

export default syncAllAnime;
