import { randomUUID } from 'crypto';
import supabase from '../config/db.js';
import { getEpisodeCountByAnime } from './anime_model.js';

export async function calculateWatchedMinutesForAnime(id_anime, capitols_vistos) {
    const chaptersWatched = Number(capitols_vistos);

    if (!id_anime || !Number.isFinite(chaptersWatched) || chaptersWatched <= 0) {
        return 0;
    }

    const { data: chapterRows, error: capErr } = await supabase
        .from('capitol')
        .select('numero, duracio_minuts')
        .eq('id_anime', id_anime)
        .order('numero', { ascending: true })
        .limit(chaptersWatched);

    if (capErr) {
        console.error('calculateWatchedMinutesForAnime error', capErr);
        throw capErr;
    }

    return (chapterRows || []).reduce((sum, row) => {
        const minutes = Number(row.duracio_minuts);
        return sum + (Number.isFinite(minutes) ? minutes : 0);
    }, 0);
}

export async function findProgressByAnimeAndUser(id_anime, id_usuari) {
    if (!id_anime || !id_usuari) return null;

    const { data, error } = await supabase
        .from('progres')
        .select('id_progres, id_usuari, id_anime, capitols_vistos, minuts_totals')
        .eq('id_anime', id_anime)
        .eq('id_usuari', id_usuari)
        .maybeSingle();

    if (error) {
        console.error('findProgressByAnimeAndUser error', error);
        throw error;
    }

    return data || null;
}

export async function saveProgress(progress) {
    const { id_usuari, id_anime, capitols_vistos, minuts_totals } = progress;
    if (!id_usuari || !id_anime || capitols_vistos == null) {
        throw new Error('Faltan datos de progreso');
    }

    const existing = await supabase
        .from('progres')
        .select('id_progres')
        .eq('id_usuari', id_usuari)
        .eq('id_anime', id_anime)
        .maybeSingle();

    if (existing.error) {
        console.error('saveProgress existing lookup error', existing.error);
        throw existing.error;
    }

    if (existing.data) {
        const { data: updated, error } = await supabase
            .from('progres')
            .update({ capitols_vistos, minuts_totals })
            .eq('id_progres', existing.data.id_progres)
            .select()
            .maybeSingle();

        if (error) {
            console.error('saveProgress update error', error);
            throw error;
        }

        return updated;
    }

    const id_progres = progress.id_progres || randomUUID();
    const { data: inserted, error } = await supabase
        .from('progres')
        .insert({
            id_progres,
            id_usuari,
            id_anime,
            capitols_vistos,
            minuts_totals: minuts_totals || 0
        })
        .select()
        .maybeSingle();

    if (error) {
        console.error('saveProgress insert error', error);
        throw error;
    }

    return inserted;
}

export async function getUserStats(id_usuari) {
    if (!id_usuari) return {
        totalMinutes: 0,
        totalChapters: 0,
        totalFinishedAnimes: 0,
        topGenre: null,
        topAnimes: []
    };

    const { data: progresRows, error: progressErr } = await supabase
        .from('progres')
        .select('id_usuari, id_anime, capitols_vistos, minuts_totals')
        .eq('id_usuari', id_usuari);

    if (progressErr) {
        console.error('getUserStats progress error', progressErr);
        throw progressErr;
    }

    if (!progresRows || progresRows.length === 0) {
        return {
            totalMinutes: 0,
            totalChapters: 0,
            totalFinishedAnimes: 0,
            topGenre: null,
            topAnimes: []
        };
    }

    const animeIds = [...new Set(progresRows.map((row) => String(row.id_anime)))]
        .filter(Boolean);

    const progressByAnime = {};
    progresRows.forEach((row) => {
        const id = String(row.id_anime);
        progressByAnime[id] = {
            capitols_vistos: Number(row.capitols_vistos || 0),
            minuts_totals: Number(row.minuts_totals || 0)
        };
    });

    const episodeCounts = {};
    await Promise.all(
        animeIds.map(async (animeId) => {
            try {
                episodeCounts[animeId] = await getEpisodeCountByAnime(animeId);
            } catch (err) {
                console.error(`getUserStats episode count error for anime ${animeId}`, err);
                episodeCounts[animeId] = 0;
            }
        })
    );

    const totalMinutes = progresRows.reduce(
        (sum, row) => sum + Number(row.minuts_totals || 0),
        0
    );
    const totalChapters = progresRows.reduce(
        (sum, row) => sum + Number(row.capitols_vistos || 0),
        0
    );

    const { data: genreRows, error: genreErr } = await supabase
        .from('anime_genere')
        .select('id_anime, id_genere')
        .in('id_anime', animeIds);

    if (genreErr) {
        console.error('getUserStats genreRows error', genreErr);
        throw genreErr;
    }

    const genreTotals = {};
    const countedAnimeByGenre = {};

    (genreRows || []).forEach((row) => {
        const animeId = String(row.id_anime);
        const progress = progressByAnime[animeId];
        if (!progress || Number(progress.capitols_vistos) <= 0) return;

        const genreKey = row.id_genere || 'Sin género';
        const genreAnimeKey = `${genreKey}:${animeId}`;
        if (countedAnimeByGenre[genreAnimeKey]) return;

        countedAnimeByGenre[genreAnimeKey] = true;
        genreTotals[genreKey] = (genreTotals[genreKey] || 0) + 1;
    });

    const genreKeys = Object.entries(genreTotals).sort((a, b) => b[1] - a[1]);
    const topGenres = genreKeys.slice(0, 3).map(([genre, value]) => ({ genre, value }));
    let topGenre = topGenres.length ? topGenres[0].genre : null;

    if (topGenre && topGenre !== 'Sin género') {
        const genreIds = [...new Set(genreRows.map((row) => row.id_genere))].filter(Boolean);
        let genreNames = [];

        if (genreIds.length) {
            const { data, error: genreNameErr } = await supabase
                .from('genere')
                .select('id_genere, nom')
                .in('id_genere', genreIds);

            if (!genreNameErr && data) {
                genreNames = data;
            } else if (genreNameErr) {
                console.error('getUserStats genreNames error', genreNameErr);
            }
        }

        if (genreNames.length) {
            const genreNameMap = Object.fromEntries(
                genreNames.map((genre) => [genre.id_genere, genre.nom])
            );
            topGenres.forEach((entry) => {
                if (genreNameMap[entry.genre]) {
                    entry.genre = genreNameMap[entry.genre];
                }
            });
            topGenre = genreNameMap[topGenre] || topGenre;
        }
    }

    let animeRows = [];

    try {
        const { data, error: animeErr } = await supabase
            .from('anime')
            .select('id_anime, titol')
            .in('id_anime', animeIds);

        if (animeErr) {
            console.error('getUserStats animeRows error', animeErr);
        } else {
            animeRows = data || [];
        }
    } catch (err) {
        console.error('getUserStats animeRows exception', err);
    }

    const titleMap = {};
    (animeRows || []).forEach((anime) => {
        titleMap[String(anime.id_anime)] = anime.titol || 'Anime desconocido';
    });

    const topAnimes = progresRows
        .map((row) => ({
            id_anime: String(row.id_anime),
            title: titleMap[String(row.id_anime)] || 'Anime desconocido',
            minutes: Number(row.minuts_totals || 0)
        }))
        .sort((a, b) => b.minutes - a.minutes)
        .slice(0, 3);

    const finishedAnimeCount = progresRows.reduce((count, row) => {
        const animeId = String(row.id_anime);
        const chapterCount = episodeCounts[animeId] || 0;
        return count + (chapterCount > 0 && Number(row.capitols_vistos || 0) >= chapterCount ? 1 : 0);
    }, 0);

    return {
        totalMinutes,
        totalChapters,
        totalFinishedAnimes: finishedAnimeCount,
        topGenre,
        topGenres,
        topAnimes
    };
}
