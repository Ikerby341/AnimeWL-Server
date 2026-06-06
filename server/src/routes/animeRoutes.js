import { Router } from 'express';
import axios from 'axios';
import { randomUUID } from 'crypto';
import { syncAnimeById, syncAnimeMetadataById, mapJikanToDb } from '../controllers/syncAnime.js';
import { findAnimeById, listAiringAnimes, listAnimes, listRandomUserRecommendedAnimes, getEpisodeCountByAnime, listGenres } from '../models/anime_model.js';
import { findCommentsByAnimeId, insertComment, deleteCommentById } from '../models/comment_model.js';
import { findRatingSummaryByAnimeId, findRatingByAnimeAndUser, saveRating } from '../models/rating_model.js';
import { findProgressByAnimeAndUser, saveProgress, calculateWatchedMinutesForAnime } from '../models/progress_model.js';
import { findUserById } from '../models/users_model.js';
import { fetchAnimeFromDb, fetchJikanSearch } from '../services/jikanService.js';
import { getUserId } from '../utils/auth.js';

const COMMENT_MAX_LENGTH = 255;

export function createAnimeRouter() {
	const router = Router();

	router.get('/api/anime', async (req, res) => {
		try {
			const limit = Number(req.query.limit);
			const offset = Number(req.query.offset || 0);
			const genre = typeof req.query.genre === 'string' && req.query.genre.trim() !== '' ? req.query.genre.trim() : null;
			const minRating = Number(req.query.minRating);
			const maxRating = Number(req.query.maxRating);
			const hasPagination = Number.isFinite(limit) && limit > 0;
			const fetchLimit = hasPagination ? limit + 1 : null;
			const anime = await listAnimes(genre, fetchLimit, offset, {
				minRating: Number.isFinite(minRating) ? minRating : null,
				maxRating: Number.isFinite(maxRating) ? maxRating : null
			});
			const hasMore = hasPagination && anime.length > limit;

			res.json({
				success: true,
				anime: hasPagination ? anime.slice(0, limit) : anime,
				hasMore,
				nextOffset: hasMore ? offset + limit : null
			});
		} catch (err) {
			console.error('GET /api/anime error', err);
			res.status(500).json({ success: false, error: err.message });
		}
	});

	router.get('/api/genres', async (req, res) => {
		try {
			const genres = await listGenres();
			return res.json({ success: true, genres });
		} catch (err) {
			console.error('GET /api/genres error', err);
			return res.status(500).json({ success: false, error: err.message });
		}
	});

	router.get('/api/anime/recent/:limit', async (req, res) => {
		const { limit } = req.params;
		try {
			const anime = await listAnimes(null, parseInt(limit));
			res.json({ success: true, anime });
		} catch (err) {
			console.error('GET /api/anime/recent/:limit error', err);
			res.status(500).json({ success: false, error: err.message });
		}
	});

	router.get('/api/anime/recommended-random/:limit', async (req, res) => {
		const { limit } = req.params;
		try {
			const anime = await listRandomUserRecommendedAnimes(parseInt(limit));
			res.json({ success: true, anime });
		} catch (err) {
			console.error('GET /api/anime/recommended-random/:limit error', err);
			res.status(500).json({ success: false, error: err.message });
		}
	});

	router.get('/api/anime/airing/:limit', async (req, res) => {
		const { limit } = req.params;
		try {
			const anime = await listAiringAnimes(limit);
			res.json({ success: true, anime });
		} catch (err) {
			console.error('GET /api/anime/airing/:limit error', err);
			res.status(500).json({ success: false, error: err.message });
		}
	});

	router.get('/api/anime/genre/:genreId', async (req, res) => {
		const { genreId } = req.params;
		try {
			const anime = await listAnimes(genreId);
			res.json({ success: true, anime });
		} catch (err) {
			console.error('GET /api/anime/genre/:genreId error', err);
			res.status(500).json({ success: false, error: err.message });
		}
	});

	router.get('/api/anime/genre/:genreId/:limit', async (req, res) => {
		const { genreId, limit } = req.params;
		try {
			const anime = await listAnimes(genreId, limit);
			res.json({ success: true, anime });
		} catch (err) {
			console.error('GET /api/anime/genre/:genreId/:limit error', err);
			res.status(500).json({ success: false, error: err.message });
		}
	});

	router.get('/api/jikan/search', async (req, res) => {
		const query = req.query.q;
		if (!query || typeof query !== 'string' || query.trim() === '') {
			return res.status(400).json({ success: false, error: 'Query parameter is required' });
		}

		const trimmedQuery = query.trim();
		let data = [];
		let jikanError = null;

		try {
			data = await fetchJikanSearch(trimmedQuery);
			if (data.length > 0) {
				return res.json({ success: true, data });
			}
		} catch (err) {
			jikanError = err;
			console.warn('Jikan search failed, falling back to DB', err.message || err);
		}

		data = await fetchAnimeFromDb(trimmedQuery);
		if (data.length > 0) {
			return res.json({ success: true, data });
		}

		if (jikanError) {
			const status = jikanError.response?.status || 500;
			return res.status(status).json({
				success: false,
				error: jikanError.response?.data?.message || 'Error searching anime on Jikan',
				status
			});
		}

		return res.json({ success: true, data: [] });
	});

	router.get('/api/anime/:id', async (req, res) => {
		const { id } = req.params;
		const cacheOnly = req.query.cacheOnly === 'true';
		try {
			let anime = await findAnimeById(id);
			if (anime) {
				anime = await findAnimeById(id);
				res.json({ success: true, anime });
				if (!cacheOnly) {
					syncAnimeById(id).catch((error) => console.error('background sync error', error));
				}
				return;
			}

			if (cacheOnly) {
				return res.status(404).json({ success: false, error: 'not found' });
			}

			let rec;
			try {
				rec = await syncAnimeMetadataById(id);
			} catch (error) {
				console.error('metadata sync error', error);
				try {
					const response = await axios.get(`https://api.jikan.moe/v4/anime/${id}/full`);
					if (response.data && response.data.data) {
						rec = mapJikanToDb(response.data.data);
					}
				} catch (jikanError) {
					console.error('direct Jikan fetch also failed', jikanError.message);
				}
			}
			anime = await findAnimeById(id);
			if (!anime && rec) {
				anime = rec;
			}
			if (!anime) {
				return res.status(404).json({
					success: false,
					error: 'not found'
				});
			}
			res.json({ success: true, anime });
			syncAnimeById(id).catch((error) => console.error('background sync error', error));
		} catch (err) {
			console.error('GET /api/anime/:id error', err);
			res.status(500).json({ success: false, error: err.message });
		}
	});

	router.get('/api/anime/:id/comments', async (req, res) => {
		const { id } = req.params;
		try {
			const comments = await findCommentsByAnimeId(id);
			return res.json({ success: true, comments });
		} catch (err) {
			console.error('GET /api/anime/:id/comments error', err);
			return res.status(500).json({ success: false, error: err.message });
		}
	});

	async function deleteCommentHandler(req, res) {
		const { commentId } = req.params;
		if (!req.session.user) {
			return res.status(401).json({ success: false, error: 'No hay sesiÃ³n activa' });
		}
		try {
			const userId = getUserId(req.session.user);
			if (!userId) {
				return res.status(401).json({ success: false, error: 'No hay sesión activa' });
			}

			const currentUser = await findUserById(userId);
			if (currentUser.error) {
				console.error('Error checking comment delete permissions:', currentUser.error);
				return res.status(500).json({ success: false, error: 'Error al comprobar permisos.' });
			}

			const isAdmin = currentUser.data?.isAdmin === true;
			const deleted = await deleteCommentById(commentId, userId, isAdmin);
			if (!deleted) {
				return res.status(404).json({ success: false, error: 'Comentario no encontrado' });
			}
			return res.json({ success: true, id_comentari: deleted.id_comentari });
		} catch (err) {
			console.error('DELETE comment error', err);
			return res.status(500).json({ success: false, error: err.message });
		}
	}

	router.delete('/api/anime/:id/comments/:commentId', deleteCommentHandler);
	router.delete('/api/comments/:commentId', deleteCommentHandler);

	router.get('/api/anime/:id/rating', async (req, res) => {
		const { id } = req.params;
		try {
			const rating = await findRatingSummaryByAnimeId(id);
			let userRating = null;
			if (req.session.user) {
				const userRatingRecord = await findRatingByAnimeAndUser(id, req.session.user.id_usuari);
				userRating = userRatingRecord?.puntuacio ?? null;
			}
			return res.json({ success: true, rating, userRating });
		} catch (err) {
			console.error('GET /api/anime/:id/rating error', err);
			return res.status(500).json({ success: false, error: err.message });
		}
	});

	router.get('/api/anime/:id/progress', async (req, res) => {
		const { id } = req.params;
		try {
			let progress = null;
			if (req.session.user) {
				progress = await findProgressByAnimeAndUser(id, req.session.user.id_usuari);
			}
			const episodeCount = await getEpisodeCountByAnime(id);
			return res.json({ success: true, progress, episodeCount });
		} catch (err) {
			console.error('GET /api/anime/:id/progress error', err);
			return res.status(500).json({ success: false, error: err.message });
		}
	});

	router.post('/api/anime/:id/progress', async (req, res) => {
		const { id } = req.params;
		const { capitols_vistos } = req.body;
		if (!req.session.user) {
			return res.status(401).json({ success: false, error: 'No hay sesiÃ³n activa' });
		}
		const chaptersWatched = Number(capitols_vistos);
		if (Number.isNaN(chaptersWatched) || chaptersWatched < 0) {
			return res.status(400).json({ success: false, error: 'El nÃºmero de capÃ­tulos visto no es vÃ¡lido.' });
		}

		try {
			const totalMinutes = await calculateWatchedMinutesForAnime(id, chaptersWatched);
			const savedProgress = await saveProgress({
				id_usuari: req.session.user.id_usuari,
				id_anime: id,
				capitols_vistos: chaptersWatched,
				minuts_totals: totalMinutes
			});
			return res.json({ success: true, progress: savedProgress });
		} catch (err) {
			console.error('POST /api/anime/:id/progress error', err);
			return res.status(500).json({ success: false, error: err.message });
		}
	});

	router.post('/api/anime/:id/rating', async (req, res) => {
		const { id } = req.params;
		const { puntuacio, id_capitol } = req.body;
		if (!req.session.user) {
			return res.status(401).json({ success: false, error: 'No hay sesiÃ³n activa' });
		}
		const ratingValue = Number(puntuacio);
		if (!ratingValue || ratingValue < 1 || ratingValue > 5) {
			return res.status(400).json({ success: false, error: 'La valoraciÃ³n debe ser un nÃºmero entre 1 y 5.' });
		}
		try {
			const savedRating = await saveRating({
				id_valoracio: randomUUID(),
				id_usuari: req.session.user.id_usuari,
				id_anime: id,
				id_capitol: id_capitol || null,
				puntuacio: ratingValue,
				data: new Date().toISOString().split('T')[0]
			});
			const rating = await findRatingSummaryByAnimeId(id);
			return res.json({ success: true, rating, userRating: savedRating.puntuacio });
		} catch (err) {
			console.error('POST /api/anime/:id/rating error', err);
			return res.status(500).json({ success: false, error: err.message });
		}
	});

	router.post('/api/anime/:id/comments', async (req, res) => {
		const { id } = req.params;
		const { contingut, id_capitol } = req.body;
		const trimmedContent = typeof contingut === 'string' ? contingut.trim() : '';
		if (!req.session.user) {
			return res.status(401).json({ success: false, error: 'No hay sesiÃ³n activa' });
		}
		if (!trimmedContent) {
			return res.status(400).json({ success: false, error: 'El comentario no puede estar vacÃ­o' });
		}
		if (trimmedContent.length > COMMENT_MAX_LENGTH) {
			return res.status(400).json({ success: false, error: `El comentario no puede superar los ${COMMENT_MAX_LENGTH} caracteres.` });
		}
		try {
			const newComment = {
				id_comentari: randomUUID(),
				id_usuari: req.session.user.id_usuari,
				id_anime: id,
				id_capitol: id_capitol || null,
				contingut: trimmedContent,
				data_hora: new Date().toISOString()
			};
			const inserted = await insertComment(newComment);
			return res.json({ success: true, comment: inserted });
		} catch (err) {
			console.error('POST /api/anime/:id/comments error', err);
			return res.status(500).json({ success: false, error: err.message });
		}
	});

	router.post('/api/anime/sync/:id', async (req, res) => {
		const { id } = req.params;
		try {
			const rec = await syncAnimeById(id);
			res.json({ success: true, anime: rec });
		} catch (err) {
			console.error('POST /api/anime/sync/:id error', err);
			res.status(500).json({ success: false, error: err.message });
		}
	});

	return router;
}
