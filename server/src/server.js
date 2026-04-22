import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import { randomUUID, randomBytes, scryptSync } from 'crypto';
import session from 'express-session';
import nodemailer from 'nodemailer';
import supabase from './config/db.js';
import { syncAnimeById, syncAnimeMetadataById, mapJikanToDb } from './controllers/syncAnime.js';
import { findAnimeById, listAnimes, testDbConnection } from './models/anime_model.js';
import { findCommentsByAnimeId, insertComment } from './models/comment_model.js';
import { registerUser, findUserByNom, findUserByEmail, updateUserProfilePicture, updateUserAnimeChoice, updateUsername, updateUserPassword, updateUserEmail } from './models/users_model.js';
import { findRatingSummaryByAnimeId, findRatingByAnimeAndUser, saveRating } from './models/rating_model.js';
import { findProgressByAnimeAndUser, saveProgress, getUserStats } from './models/progress_model.js';
import { findFavoritesByUser, findFavoriteById, addFavorite, removeFavorite, updateFavoriteStatus } from './models/favorites_model.js';

function hashPassword(password) {
	const salt = randomBytes(16).toString('hex');
	const hashed = scryptSync(password, salt, 64).toString('hex');
	return `${salt}:${hashed}`;
}

function validateEmail(email) {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getMailTransporter() {
	const host = process.env.EMAIL_SMTP_HOST;
	const port = process.env.EMAIL_SMTP_PORT;
	const user = process.env.EMAIL_SMTP_USER;
	const pass = process.env.EMAIL_SMTP_PASS;
	const secure = process.env.EMAIL_SMTP_SECURE === 'true';

	if (!host || !port || !user || !pass) {
		throw new Error('Faltan variables de entorno de correo electrónico (EMAIL_SMTP_HOST, EMAIL_SMTP_PORT, EMAIL_SMTP_USER, EMAIL_SMTP_PASS)');
	}

	return nodemailer.createTransport({
		host,
		port: Number(port),
		secure,
		auth: {
			user,
			pass
		}
	});
}

async function sendVerificationEmail(to, code) {
	const transporter = getMailTransporter();
	const from = process.env.EMAIL_FROM || process.env.EMAIL_SMTP_USER;
	const mailOptions = {
		from,
		to,
		subject: 'Código de verificación para cambio de correo',
		text: `Tu código de verificación es: ${code}. Introduce este código en la sección de configuración para cambiar tu correo electrónico.`,
		html: `<p>Tu código de verificación es: <strong>${code}</strong></p><p>Introduce este código en la sección de configuración para cambiar tu correo electrónico.</p>`
	};
	return transporter.sendMail(mailOptions);
}

const __filename = fileURLToPath(import.meta.url);	// Ruta d'aquest arxiu (servidor.js)
const __dirname = path.dirname(__filename);			// Ruta de la carpeta on es troba aquest arxiu

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware para convertir JSON
app.use(express.json());
// permitir peticiones desde el cliente React en desarrollo
app.use(cors({
	origin: [
		'http://localhost:5173',
		process.env.FRONTEND_URL || 'http://localhost:5173'
	],
	credentials: true
}));

// Configuración de sesiones
app.use(session({
	secret: process.env.SESSION_SECRET || 'tu_secreto_super_seguro',
	resave: false,
	saveUninitialized: false,
	cookie: {
		secure: false, // false para desarrollo (HTTP), true para producción (HTTPS)
		httpOnly: true,
		maxAge: 60 * 60 * 1000 // 1 hora por defecto
	}
}));

// programar / inicializar la sincronización diaria de datos de anime
// import syncAllAnime from './controllers/syncAnime.js';
// ejecutar una vez al iniciar el servidor
// syncAllAnime().catch(console.error);

// Servir archivos estáticos desde la carpeta 'public'
app.use(express.static(path.join(__dirname, '../public')));

// Carpeta donde se encuentran las plantillas (archivos .ejs)
//	y el motor que se utilizará para generar las páginas html
app.set('views', path.join(__dirname, '../plantilles'));
app.set('view engine', 'ejs');

app.get('/test-db', async (req, res) => {
	const { data, error } = await testDbConnection();

	if (error) {
		console.error('Supabase error:', error);
		return res.status(500).json({ success: false, error });
	}
	res.json({ success: true, rows: data });
});

// helper sencillo que utiliza la API pública de MyMemory para traducir.
// divide el texto en trozos de 500 caracteres para evitar límites del servicio.
async function translateText(text, source = 'en', target = 'es') {
	if (!text) return '';
	const maxLen = 500;
	let translated = '';
	for (let i = 0; i < text.length; i += maxLen) {
		const chunk = text.slice(i, i + maxLen);
		try {
			const res = await axios.get('https://api.mymemory.translated.net/get', {
				params: {
					q: chunk,
					langpair: `${source}|${target}`,
				},
			});
			const part = (res.data && res.data.responseData && res.data.responseData.translatedText) || chunk;
			console.log('translateText chunk', chunk.slice(0, 50).replace(/\n/g, ' '), '=>', part.slice(0, 50).replace(/\n/g, ' '));
			translated += part;
		} catch (err) {
			console.error('translateText chunk error', err.message);
			translated += chunk; // fallback al original
		}
	}
	return translated;
}

// endpoint que devuelve todos los animes almacenados
app.get('/api/anime', async (req, res) => {
	try {
		const anime = await listAnimes();
		res.json({ success: true, anime });
	} catch (err) {
		console.error('GET /api/anime error', err);
		res.status(500).json({ success: false, error: err.message });
	}
});

// endpoint que devuelve animes recientes con límite
app.get('/api/anime/recent/:limit', async (req, res) => {
	const { limit } = req.params;
	try {
		const anime = await listAnimes(null, parseInt(limit));
		res.json({ success: true, anime });
	} catch (err) {
		console.error('GET /api/anime/recent/:limit error', err);
		res.status(500).json({ success: false, error: err.message });
	}
});

// endpoint que devuelve todos los animes de un género específico
app.get('/api/anime/genre/:genreId', async (req, res) => {
	const { genreId } = req.params;
	try {
		const anime = await listAnimes(genreId);
		res.json({ success: true, anime });
	} catch (err) {
		console.error('GET /api/anime/genre/:genreId error', err);
		res.status(500).json({ success: false, error: err.message });
	}
});

// endpoint que devuelve animes con limite de un genero específico
app.get('/api/anime/genre/:genreId/:limit', async (req, res) => {
	const { genreId, limit } = req.params;
	try {
		const anime = await listAnimes(genreId, limit);
		res.json({ success: true, anime });
	} catch (err) {
		console.error('GET /api/anime/genre/:genreId/:limit error', err);
		res.status(500).json({ success: false, error: err.message });
	}
});

async function fetchAnimeFromDb(query) {
	try {
		const { data, error } = await supabase
			.from('anime')
			.select('*')
			.ilike('titol', `%${query}%`)
			.order('lastupdate', { ascending: false })
			.limit(10);
		if (error) {
			console.error('fetchAnimeFromDb error', error);
			return [];
		}
		return data || [];
	} catch (err) {
		console.error('fetchAnimeFromDb thrown error', err);
		return [];
	}
}

async function fetchJikanSearch(query) {
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
			return response.data?.data || [];
		} catch (err) {
			const status = err.response?.status;
			if (status === 429 && attempts < 3) {
				attempts += 1;
				const delay = Math.min(1000 * 2 ** attempts, 30000);
				console.warn(`Jikan rate limit for search, retrying in ${delay}ms`);
				await new Promise((r) => setTimeout(r, delay));
				continue;
			}
			console.error('fetchJikanSearch error', {
				status,
				message: err.message,
				url: err.config?.url,
				data: err.response?.data,
				headers: err.response?.headers,
			});
			throw err;
		}
	}
}

app.get('/api/jikan/search', async (req, res) => {
	const query = req.query.q;
	if (!query || typeof query !== 'string' || query.trim() === '') {
		return res.status(400).json({ success: false, error: 'Query parameter is required' });
	}

	const trimmedQuery = query.trim();
	let data = [];
	let jikanError = null;

	try {
		data = await fetchJikanSearch(trimmedQuery);
		console.log('/api/jikan/search jikan', trimmedQuery, 'results', data.length);
		if (data.length > 0) {
			return res.json({ success: true, data });
		}
	} catch (err) {
		jikanError = err;
		console.warn('Jikan search failed, falling back to DB', err.message || err);
	}

	data = await fetchAnimeFromDb(trimmedQuery);
	if (data.length > 0) {
		console.log('/api/jikan/search db fallback', trimmedQuery, 'results', data.length);
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

// devolver un anime de la BBDD; si existe devolvemos inmediatamente
// y lanzamos la sincronización en segundo plano. solo esperamos si
// no está presente todavía.
app.get('/api/anime/:id', async (req, res) => {
	const { id } = req.params;
	const cacheOnly = req.query.cacheOnly === 'true';
	try {
		console.log('GET /api/anime/:id', id, 'cacheOnly=', cacheOnly);
		// always start by reading whatever is currently in the database
		let anime = await findAnimeById(id);
		console.log('  initial db read:', !!anime);
		if (anime) {
			anime = await findAnimeById(id);
			res.json({ success: true, anime });
			if (!cacheOnly) {
				syncAnimeById(id).catch((e) => console.error('background sync error', e));
			}
			return;
		}

		if (cacheOnly) {
			console.log('  cacheOnly requested and anime not in DB. returning 404 without sync.');
			return res.status(404).json({ success: false, error: 'not found' });
		}

		// not yet stored: fetch metadata and write it, then read from DB
		let rec;
		try {
			rec = await syncAnimeMetadataById(id);
			console.log('  metadata sync rec:', rec && rec.id_anime);
		} catch (e) {
			console.error('metadata sync error', e);
			// try a direct fetch from Jikan so we at least have some data
			try {
				const r = await axios.get(`https://api.jikan.moe/v4/anime/${id}/full`);
				if (r.data && r.data.data) {
					rec = mapJikanToDb(r.data.data);
				}
			} catch (e2) {
				console.error('direct Jikan fetch also failed', e2.message);
			}
		}
		anime = await findAnimeById(id); // attempt read from DB
		console.log('  post-sync db read:', !!anime);
		// if DB read fails but we do have the returned record, use it
		if (!anime && rec) {
			console.log('  using rec fallback');
			anime = rec;
		}
		if (!anime) {
			console.log('  final result: not found');
			return res.status(404).json({
				success: false,
				error: 'not found'
			});
		}
		res.json({ success: true, anime });
		// afterwards, fetch episodes without delaying the response
		syncAnimeById(id).catch((e) => console.error('background sync error', e));
	} catch (err) {
		console.error('GET /api/anime/:id error', err);
		res.status(500).json({ success: false, error: err.message });
	}
});

app.get('/api/anime/:id/comments', async (req, res) => {
	const { id } = req.params;
	try {
		const comments = await findCommentsByAnimeId(id);
		return res.json({ success: true, comments });
	} catch (err) {
		console.error('GET /api/anime/:id/comments error', err);
		return res.status(500).json({ success: false, error: err.message });
	}
});

app.get('/api/anime/:id/rating', async (req, res) => {
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

app.get('/api/anime/:id/progress', async (req, res) => {
	const { id } = req.params;
	try {
		let progress = null;
		if (req.session.user) {
			progress = await findProgressByAnimeAndUser(id, req.session.user.id_usuari);
		}
		const { count, error: capErr } = await supabase
			.from('capitol')
			.select('id_capitol', { count: 'exact', head: true })
			.eq('id_anime', id);
		const episodeCount = capErr ? 0 : Number(count || 0);
		return res.json({ success: true, progress, episodeCount });
	} catch (err) {
		console.error('GET /api/anime/:id/progress error', err);
		return res.status(500).json({ success: false, error: err.message });
	}
});

app.get('/api/user/stats', async (req, res) => {
	if (!req.session.user) {
		return res.status(401).json({ success: false, error: 'No hay sesión activa' });
	}

	try {
		const stats = await getUserStats(req.session.user.id_usuari);
		return res.json({ success: true, stats });
	} catch (err) {
		console.error('GET /api/user/stats error', err);
		return res.status(500).json({ success: false, error: err.message });
	}
});

app.post('/api/anime/:id/progress', async (req, res) => {
	const { id } = req.params;
	const { capitols_vistos } = req.body;
	if (!req.session.user) {
		return res.status(401).json({ success: false, error: 'No hay sesión activa' });
	}
	const chaptersWatched = Number(capitols_vistos);
	if (Number.isNaN(chaptersWatched) || chaptersWatched < 0) {
		return res.status(400).json({ success: false, error: 'El número de capítulos visto no es válido.' });
	}

	let totalMinutes = 0;
	if (chaptersWatched > 0) {
		const { data: chapterRows, error: capErr } = await supabase
			.from('capitol')
			.select('numero, duracio_minuts')
			.eq('id_anime', id)
			.order('numero', { ascending: true });

		if (capErr) {
			console.error('POST /api/anime/:id/progress capitol lookup error', capErr);
		} else {
			totalMinutes = (chapterRows || []).reduce((sum, row) => {
				const minutes = Number(row.duracio_minuts);
				return sum + (Number.isFinite(minutes) ? minutes : 0);
			}, 0);
		}
	}

	try {
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

// Obtener favoritos del usuario
app.get('/api/user/favorites', async (req, res) => {
	if (!req.session.user) {
		return res.status(401).json({ success: false, error: 'No hay sesión activa' });
	}

	try {
		const favorites = await findFavoritesByUser(req.session.user.id_usuari);

		// Enriquecer con datos del anime y valoración media
		const enrichedFavorites = await Promise.all(
			favorites.map(async (fav) => {
				try {
					const anime = await findAnimeById(fav.id_anime);
					let ratingData = { average: 0, count: 0 };
					try {
						ratingData = await findRatingSummaryByAnimeId(fav.id_anime);
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

		return res.json({ success: true, favorites: enrichedFavorites });
	} catch (err) {
		console.error('GET /api/user/favorites error', err);
		return res.status(500).json({ success: false, error: err.message });
	}
});

// Agregar a favoritos
app.post('/api/user/favorites/:id_anime', async (req, res) => {
	if (!req.session.user) {
		return res.status(401).json({ success: false, error: 'No hay sesión activa' });
	}

	const { id_anime } = req.params;
	if (!id_anime) {
		return res.status(400).json({ success: false, error: 'Falta el id del anime' });
	}

	try {
		let anime = await findAnimeById(id_anime);
		if (!anime) {
			console.log(`Anime ${id_anime} no encontrado en BBDD, sincronizando antes de agregar a favoritos.`);
			await syncAnimeMetadataById(id_anime);
			anime = await findAnimeById(id_anime);
			if (!anime) {
				return res.status(500).json({ success: false, error: 'No se pudo sincronizar el anime seleccionado.' });
			}
		}

		const favorite = await addFavorite(req.session.user.id_usuari, id_anime);
		return res.json({ success: true, favorite: { ...favorite, anime } });
	} catch (err) {
		console.error('POST /api/user/favorites/:id_anime error', err);
		return res.status(500).json({ success: false, error: err.message });
	}
});

// Eliminar de favoritos
app.delete('/api/user/favorites/:id_anime', async (req, res) => {
	if (!req.session.user) {
		return res.status(401).json({ success: false, error: 'No hay sesión activa' });
	}

	const { id_anime } = req.params;
	if (!id_anime) {
		return res.status(400).json({ success: false, error: 'Falta el id del anime' });
	}

	try {
		const removed = await removeFavorite(req.session.user.id_usuari, id_anime);
		return res.json({ success: true, removed });
	} catch (err) {
		console.error('DELETE /api/user/favorites/:id_anime error', err);
		return res.status(500).json({ success: false, error: err.message });
	}
});

// Actualizar estado del favorito
app.put('/api/user/favorites/:id_anime', async (req, res) => {
	if (!req.session.user) {
		return res.status(401).json({ success: false, error: 'No hay sesión activa' });
	}

	const { id_anime } = req.params;
	const { estat } = req.body;

	if (!id_anime || !estat) {
		return res.status(400).json({ success: false, error: 'Falta el id del anime o el estado' });
	}

	try {
		const updated = await updateFavoriteStatus(req.session.user.id_usuari, id_anime, estat);
		return res.json({ success: true, updated });
	} catch (err) {
		console.error('PUT /api/user/favorites/:id_anime error', err);
		return res.status(500).json({ success: false, error: err.message });
	}
});

app.post('/api/anime/:id/rating', async (req, res) => {
	const { id } = req.params;
	const { puntuacio, id_capitol } = req.body;
	if (!req.session.user) {
		return res.status(401).json({ success: false, error: 'No hay sesión activa' });
	}
	const ratingValue = Number(puntuacio);
	if (!ratingValue || ratingValue < 1 || ratingValue > 5) {
		return res.status(400).json({ success: false, error: 'La valoración debe ser un número entre 1 y 5.' });
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

app.post('/api/anime/:id/comments', async (req, res) => {
	const { id } = req.params;
	const { contingut, id_capitol } = req.body;
	if (!req.session.user) {
		return res.status(401).json({ success: false, error: 'No hay sesión activa' });
	}
	if (!contingut || typeof contingut !== 'string' || contingut.trim() === '') {
		return res.status(400).json({ success: false, error: 'El comentario no puede estar vacío' });
	}
	try {
		const newComment = {
			id_comentari: randomUUID(),
			id_usuari: req.session.user.id_usuari,
			id_anime: id,
			id_capitol: id_capitol || null,
			contingut: contingut.trim(),
			data_hora: new Date().toISOString()
		};
		const inserted = await insertComment(newComment);
		return res.json({ success: true, comment: inserted });
	} catch (err) {
		console.error('POST /api/anime/:id/comments error', err);
		return res.status(500).json({ success: false, error: err.message });
	}
});

// ruta para forzar la sincronización manualmente
app.post('/api/anime/sync/:id', async (req, res) => {
	const { id } = req.params;
	try {
		const rec = await syncAnimeById(id);
		res.json({ success: true, anime: rec });
	} catch (err) {
		console.error('POST /api/anime/sync/:id error', err);
		res.status(500).json({ success: false, error: err.message });
	}
});

app.get('/api/user/update-username', async (req, res) => {
	if (!req.session.user) {
		return res.status(401).json({ success: false, error: 'No hay sesión activa' });
	}
	const { newUsername } = req.query;
	if (!newUsername || newUsername.trim() === '') {
		return res.status(400).json({ success: false, error: 'El nombre de usuario no puede estar vacío' });
	}
	try {
		const { data, error } = await updateUsername(req.session.user.id_usuari, newUsername.trim());
		if (error) {
			console.error('Error updating username:', error);
			const errorMessage = error.message || 'Error al actualizar el nombre de usuario';
			const statusCode = errorMessage.includes('registrado') ? 400 : 500;
			return res.status(statusCode).json({ success: false, error: errorMessage });
		}
		if (!data) {
			return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
		}
		// actualizar el nombre de usuario en la sesión para que el cambio se refleje inmediatamente
		req.session.user.nom = newUsername.trim();
		return res.json({ success: true, user: data });
	} catch (error) {
		console.error('Error updating username:', error);
		return res.status(500).json({ success: false, error: 'Error al actualizar el nombre de usuario' });
	}
});

app.post('/api/user/update-password', async (req, res) => {
	if (!req.session.user) {
		return res.status(401).json({ success: false, error: 'No hay sesión activa' });
	}
	const { currentPassword, newPassword, confirmPassword } = req.body;
	if (!currentPassword || !newPassword || !confirmPassword) {
		return res.status(400).json({ success: false, error: 'Faltan datos para cambiar la contraseña.' });
	}
	if (newPassword !== confirmPassword) {
		return res.status(400).json({ success: false, error: 'La nueva contraseña y su confirmación no coinciden.' });
	}
	if (newPassword.length < 6) {
		return res.status(400).json({ success: false, error: 'La nueva contraseña debe tener al menos 6 caracteres.' });
	}
	try {
		const result = await findUserByNom(req.session.user.nom);
		if (result.error) {
			console.error('Error fetching session user info:', result.error);
			return res.status(500).json({ success: false, error: 'Error al comprobar la sesión.' });
		}
		if (!result.data) {
			return res.status(404).json({ success: false, error: 'Usuario no encontrado.' });
		}

		const storedPassword = result.data.contrasenya;
		const [salt, hashed] = storedPassword.split(':');
		const attemptHash = scryptSync(currentPassword, salt, 64).toString('hex');
		if (attemptHash !== hashed) {
			return res.status(400).json({ success: false, error: 'La contraseña actual es incorrecta.' });
		}

		const newHashedPassword = hashPassword(newPassword);
		const { data, error } = await updateUserPassword(req.session.user.id_usuari, newHashedPassword);
		if (error) {
			console.error('Error updating password:', error);
			return res.status(500).json({ success: false, error: 'Error al actualizar la contraseña.' });
		}
		if (!data) {
			return res.status(404).json({ success: false, error: 'Usuario no encontrado.' });
		}

		return res.json({ success: true, message: 'Contraseña actualizada correctamente.' });
	} catch (error) {
		console.error('Error updating password:', error);
		return res.status(500).json({ success: false, error: 'Error al actualizar la contraseña.' });
	}
});

app.post('/api/user/send-email-code', async (req, res) => {
	if (!req.session.user) {
		return res.status(401).json({ success: false, error: 'No hay sesión activa' });
	}

	const currentEmail = req.session.user.email;
	if (!currentEmail) {
		return res.status(400).json({ success: false, error: 'No se encontró el correo electrónico asociado.' });
	}

	const code = Math.floor(100000 + Math.random() * 900000).toString();
	req.session.emailChange = {
		code,
		expiresAt: Date.now() + 10 * 60 * 1000
	};

	try {
		await sendVerificationEmail(currentEmail, code);
		return res.json({ success: true, message: 'Código enviado al correo electrónico actual.' });
	} catch (error) {
		console.error('Error sending email verification code:', error);
		return res.status(500).json({ success: false, error: 'Error al enviar el código de verificación.' });
	}
});

app.post('/api/user/update-email', async (req, res) => {
	if (!req.session.user) {
		return res.status(401).json({ success: false, error: 'No hay sesión activa' });
	}

	const { code, newEmail } = req.body;
	if (!code || !newEmail) {
		return res.status(400).json({ success: false, error: 'Faltan datos para cambiar el correo electrónico.' });
	}

	if (!validateEmail(newEmail)) {
		return res.status(400).json({ success: false, error: 'El nuevo correo electrónico no es válido.' });
	}

	const sessionCode = req.session.emailChange?.code;
	const expiresAt = req.session.emailChange?.expiresAt;

	if (!sessionCode || !expiresAt || Date.now() > expiresAt) {
		return res.status(400).json({ success: false, error: 'El código de verificación ha caducado. Vuelve a solicitar uno nuevo.' });
	}

	if (String(code).trim() !== String(sessionCode).trim()) {
		return res.status(400).json({ success: false, error: 'El código de verificación no es correcto.' });
	}

	if (newEmail.trim().toLowerCase() === req.session.user.email?.trim().toLowerCase()) {
		return res.status(400).json({ success: false, error: 'El nuevo correo debe ser diferente al actual.' });
	}

	try {
		const existingEmail = await findUserByEmail(newEmail.trim());
		if (existingEmail.error) {
			console.error('Error checking email uniqueness:', existingEmail.error);
			return res.status(500).json({ success: false, error: 'Error al comprobar el correo electrónico.' });
		}
		if (existingEmail.data) {
			return res.status(400).json({ success: false, error: 'Ese correo electrónico ya está registrado.' });
		}

		const { data, error } = await updateUserEmail(req.session.user.id_usuari, newEmail.trim());
		if (error) {
			console.error('Error updating email:', error);
			return res.status(500).json({ success: false, error: 'Error al actualizar el correo electrónico.' });
		}
		if (!data) {
			return res.status(404).json({ success: false, error: 'Usuario no encontrado.' });
		}

		req.session.user.email = newEmail.trim();
		delete req.session.emailChange;
		return res.json({ success: true, message: 'Correo electrónico actualizado correctamente.' });
	} catch (error) {
		console.error('Error updating email:', error);
		return res.status(500).json({ success: false, error: 'Error al actualizar el correo electrónico.' });
	}
});

// registro de usuario
app.post('/api/register', async (req, res) => {
	const { nom, email, contrasenya } = req.body;

	if (!nom || !email || !contrasenya) {
		return res.status(400).json({ success: false, error: 'Faltan datos de registro.' });
	}
	if (!validateEmail(email)) {
		return res.status(400).json({ success: false, error: 'El email no es válido.' });
	}
	if (contrasenya.length < 6) {
		return res.status(400).json({ success: false, error: 'La contraseña debe tener al menos 6 caracteres.' });
	}

	const hashedPassword = hashPassword(contrasenya);
	const id_usuari = randomUUID();

	const { data, error } = await registerUser({ id_usuari, nom, email, contrasenya: hashedPassword });

	if (error) {
		console.error('Supabase insert error:', error.message || error);
		const message = error.message || 'Error al registrar el usuario.';
		const status = message.includes('duplicate') || message.includes('unique') ? 409 : 500;
		return res.status(status).json({ success: false, error: message });
	}

	return res.status(201).json({ success: true, user: { id_usuari, nom, email } });
});

app.post('/api/login', async (req, res) => {
	const { username, password, remember } = req.body;

	if (!username || !password) {
		return res.status(400).json({ success: false, error: 'Faltan datos de inicio de sesión.' });
	}

	const result = await findUserByNom(username);

	if (result.error) {
		console.error('Supabase login error:', result.error);
		return res.status(500).json({ success: false, error: 'Error al iniciar sesión.' });
	}

	if (!result.data) {
		return res.status(401).json({ success: false, error: 'Usuario o contraseña incorrectos.' });
	}

	const storedPassword = result.data.contrasenya;
	const [salt, hashed] = storedPassword.split(':');
	const attemptHash = scryptSync(password, salt, 64).toString('hex');

	if (attemptHash !== hashed) {
		return res.status(401).json({ success: false, error: 'Usuario o contraseña incorrectos.' });
	}

	// Guardar usuario en sesión
	req.session.user = {
		id_usuari: result.data.id_usuari,
		nom: result.data.nom,
		email: result.data.email,
		id_anime_preferit: result.data.id_anime_preferit,
		id_anime_recomanat: result.data.id_anime_recomanat,
		img_url: result.data.img_url
	};
	req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 días

	return res.json({
		success: true,
		user: req.session.user
	});
});

// Verificar sesión actual
app.get('/api/session', async (req, res) => {
	if (!req.session.user) {
		return res.status(401).json({ success: false, error: 'No hay sesión activa' });
	}

	const sessionUser = req.session.user;

	if (sessionUser.id_anime_preferit == null || sessionUser.id_anime_recomanat == null || sessionUser.img_url == null) {
		try {
			const result = await findUserByNom(sessionUser.nom);
			if (result.error) {
				console.error('Error fetching user session info:', result.error);
				return res.status(500).json({ success: false, error: 'Error al comprobar la sesión' });
			}

			if (result.data) {
				req.session.user = {
					id_usuari: result.data.id_usuari,
					nom: result.data.nom,
					email: result.data.email,
					id_anime_preferit: result.data.id_anime_preferit,
					id_anime_recomanat: result.data.id_anime_recomanat,
					img_url: result.data.img_url
				};
				return res.json({ success: true, user: req.session.user });
			}
		} catch (error) {
			console.error('Error fetching session user info:', error);
			return res.status(500).json({ success: false, error: 'Error al comprobar la sesión' });
		}
	}

	return res.json({ success: true, user: sessionUser });
});

app.get('/api/check-session', async (req, res) => {
	if (!req.session.user) {
		return res.status(401).json({ success: false, error: 'No hay sesión activa' });
	}
	// refrescar datos de sesión desde la base de datos para asegurarnos de que tenemos la info más reciente
	try {
		const result = await findUserByNom(req.session.user.nom);
		if (result.error) {
			console.error('Error fetching session user info:', result.error);
			return res.status(500).json({ success: false, error: 'Error al comprobar la sesión' });
		}
		if (result.data) {
			req.session.user = {
				id_usuari: result.data.id_usuari,
				nom: result.data.nom,
				email: result.data.email,
				id_anime_preferit: result.data.id_anime_preferit,
				id_anime_recomanat: result.data.id_anime_recomanat,
				img_url: result.data.img_url
			};
		}
	} catch (error) {
		console.error('Error fetching session user info:', error);
		return res.status(500).json({ success: false, error: 'Error al comprobar la sesión' });
	}


	return res.json({ success: true, user: req.session.user });
});

app.post('/api/user/anime', async (req, res) => {
	const { type, id_anime } = req.body;
	if (!req.session.user) {
		return res.status(401).json({ success: false, error: 'No hay sesión activa' });
	}
	if (!['favorite', 'recommended'].includes(type)) {
		return res.status(400).json({ success: false, error: 'Tipo inválido. Usa favorite o recommended.' });
	}
	if (!id_anime) {
		return res.status(400).json({ success: false, error: 'Falta el id del anime.' });
	}

	const field = type === 'favorite' ? 'id_anime_preferit' : 'id_anime_recomanat';
	try {
		let anime = await findAnimeById(id_anime);
		if (!anime) {
			console.log(`Anime ${id_anime} no encontrado en BBDD, sincronizando antes de asignar.`);
			await syncAnimeMetadataById(id_anime);
			anime = await findAnimeById(id_anime);
			if (!anime) {
				return res.status(500).json({ success: false, error: 'No se pudo sincronizar el anime seleccionado.' });
			}
		}

		const { data, error } = await updateUserAnimeChoice(req.session.user.id_usuari, field, id_anime);
		if (error) {
			console.error('Error updating user anime choice:', error);
			return res.status(500).json({ success: false, error: 'Error al actualizar el anime del usuario' });
		}
		if (!data) {
			return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
		}
		return res.json({ success: true, user: data });
	} catch (error) {
		console.error('POST /api/user/anime error', error);
		return res.status(500).json({ success: false, error: error.message });
	}
});

// Logout
app.post('/api/logout', (req, res) => {
	req.session.destroy((err) => {
		if (err) {
			console.error('Error destroying session:', err);
			return res.status(500).json({ success: false, error: 'Error al cerrar sesión' });
		}
		res.clearCookie('connect.sid');
		return res.json({ success: true, message: 'Sesión cerrada correctamente' });
	});
});

app.post('/api/update-profile-picture', async (req, res) => {
	const { img_url } = req.body;
	if (!req.session.user) {
		return res.status(401).json({ success: false, error: 'No hay sesión activa' });
	}
	if (!img_url || typeof img_url !== 'string' || !/^https?:\/\/.+\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(img_url)) {
		return res.status(400).json({ success: false, error: 'URL de imagen no válida' });
	}
	try {
		const { data, error } = await updateUserProfilePicture(req.session.user.id_usuari, img_url);

		if (error) {
			console.error('Error updating profile picture:', error);
			return res.status(500).json({ success: false, error: 'Error al actualizar la foto de perfil' });
		}

		if (!data) {
			return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
		}

		return res.json({ success: true, user: data });
	} catch (error) {
		console.error('Error updating profile picture:', error);
		return res.status(500).json({ success: false, error: 'Error al actualizar la foto de perfil' });
	}
});

// Iniciar el servidor (arrancar la aplicación)
app.listen(PORT, () => {
	console.log(`Servidor escoltant a http://localhost:${PORT}`);
});