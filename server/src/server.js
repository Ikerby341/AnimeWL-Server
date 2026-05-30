import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import { randomUUID, randomBytes, scryptSync, createHmac } from 'crypto';
import session from 'express-session';
import cookieSession from 'cookie-session';
import nodemailer from 'nodemailer';
import supabase from './config/db.js';
import { syncAnimeById, syncAnimeMetadataById, mapJikanToDb } from './controllers/syncAnime.js';
import { findAnimeById, listAnimes, testDbConnection, getEpisodeCountByAnime } from './models/anime_model.js';
import { findCommentsByAnimeId, insertComment, deleteCommentById } from './models/comment_model.js';
import { registerUser, findUserByNom, findUserByEmail, updateUserProfilePicture, updateUserAnimeChoice, updateUsername, updateUserPassword, updateUserEmail, updateResetPasswordToken, findUserByResetToken, clearResetPasswordToken, findPublicUserById } from './models/users_model.js';
import { findRatingSummaryByAnimeId, findRatingByAnimeAndUser, saveRating } from './models/rating_model.js';
import { findProgressByAnimeAndUser, saveProgress, getUserStats, calculateWatchedMinutesForAnime } from './models/progress_model.js';
import { findFavoritesByUser, findFavoriteById, addFavorite, removeFavorite, updateFavoriteStatus, findPublicFavoritesByUser } from './models/favorites_model.js';

function hashPassword(password) {
	const salt = randomBytes(16).toString('hex');
	const hashed = scryptSync(password, salt, 64).toString('hex');
	return `${salt}:${hashed}`;
}

function validateEmail(email) {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function base64UrlEncode(value) {
	return Buffer.from(value).toString('base64url');
}

function base64UrlDecode(value) {
	return Buffer.from(value, 'base64url').toString('utf8');
}

function signTokenPayload(payload) {
	return createHmac('sha256', process.env.SESSION_SECRET).update(payload).digest('base64url');
}

function createAuthToken(user) {
	if (!process.env.SESSION_SECRET) return null;

	const payload = base64UrlEncode(JSON.stringify({
		user,
		exp: Date.now() + 30 * 24 * 60 * 60 * 1000
	}));
	const signature = signTokenPayload(payload);
	return `${payload}.${signature}`;
}

function verifyAuthToken(token) {
	if (!process.env.SESSION_SECRET || !token || !token.includes('.')) return null;

	const [payload, signature] = token.split('.');
	const expectedSignature = signTokenPayload(payload);
	if (signature !== expectedSignature) return null;

	try {
		const data = JSON.parse(base64UrlDecode(payload));
		if (!data.exp || Date.now() > data.exp || !data.user) return null;
		return data.user;
	} catch {
		return null;
	}
}

function getBearerToken(req) {
	const authHeader = req.headers.authorization || '';
	return authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
}

function getUserId(user) {
	return user?.id_usuari || user?.id_usuario || user?.id_user || user?.id || null;
}

function getAuthenticatedTokenUser(req) {
	return verifyAuthToken(getBearerToken(req));
}

function isSameAuthenticatedUser(sessionUser, tokenUser) {
	const sessionUserId = getUserId(sessionUser);
	const tokenUserId = getUserId(tokenUser);

	if (sessionUserId && tokenUserId) {
		return sessionUserId === tokenUserId;
	}

	if (sessionUser?.email && tokenUser?.email) {
		return sessionUser.email === tokenUser.email;
	}

	if (sessionUser?.nom && tokenUser?.nom) {
		return sessionUser.nom === tokenUser.nom;
	}

	return false;
}

function getMailTransporter() {
	const host = process.env.EMAIL_SMTP_HOST;
	const port = Number(process.env.EMAIL_SMTP_PORT);
	const user = process.env.EMAIL_SMTP_USER;
	const pass = process.env.EMAIL_SMTP_PASS;
	const secure = process.env.EMAIL_SMTP_SECURE === 'true';

	if (!host || !user || !pass || !process.env.EMAIL_SMTP_PORT) {
		throw new Error('Faltan variables de entorno de correo electrónico (EMAIL_SMTP_HOST, EMAIL_SMTP_PORT, EMAIL_SMTP_USER, EMAIL_SMTP_PASS)');
	}

	if (!Number.isInteger(port)) {
		throw new Error('EMAIL_SMTP_PORT debe ser un numero. Usa un solo puerto, por ejemplo 465 o 587.');
	}

	if (process.env.RENDER && [25, 465, 587].includes(port)) {
		console.warn(`Render puede bloquear el puerto SMTP ${port} en servicios gratuitos. Usa un plan de pago, una API HTTP de email o un proveedor SMTP con puerto alternativo como 2525.`);
	}

	return nodemailer.createTransport({
		host,
		port,
		secure,
		auth: {
			user,
			pass
		},
		connectionTimeout: 15000,
		greetingTimeout: 15000,
		socketTimeout: 15000
	});
}

async function sendVerificationEmailSmtpLegacy(to, code) {
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

async function sendPasswordResetEmailSmtpLegacy(to, resetToken) {
	const transporter = getMailTransporter();
	const from = process.env.EMAIL_FROM || process.env.EMAIL_SMTP_USER;
	const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`;

	const mailOptions = {
		from,
		to,
		subject: 'Restablecer tu contraseña de AnimeWL',
		text: `Has solicitado restablecer tu contraseña. Haz clic en el siguiente enlace para crear una nueva contraseña: ${resetUrl}\n\nSi no solicitaste esto, ignora este correo.`,
		html: `<p>Has solicitado restablecer tu contraseña.</p>
			<p>Haz clic en el siguiente enlace para crear una nueva contraseña:</p>
			<p><a href="${resetUrl}">${resetUrl}</a></p>
			<p>Si no solicitaste esto, ignora este correo.</p>`
	};
	return transporter.sendMail(mailOptions);
}

const __filename = fileURLToPath(import.meta.url);	// Ruta d'aquest arxiu (servidor.js)
const __dirname = path.dirname(__filename);			// Ruta de la carpeta on es troba aquest arxiu

const app = express();
const PORT = process.env.PORT || 3000;
const COMMENT_MAX_LENGTH = 255;

const isProduction = process.env.NODE_ENV === 'production' || Boolean(process.env.RENDER);
const frontendUrl = 'https://animewl.cat';

function appUsesEmailRelay() {
	return Boolean(process.env.EMAIL_RELAY_URL && process.env.EMAIL_RELAY_SECRET);
}

async function sendMailThroughRelay({ to, subject, text, html }) {
	const relayUrl = process.env.EMAIL_RELAY_URL;
	const relaySecret = process.env.EMAIL_RELAY_SECRET;
	const from = process.env.EMAIL_FROM || process.env.EMAIL_SMTP_USER;

	if (!relayUrl || !relaySecret) {
		throw new Error('Faltan variables de entorno del relay de correo (EMAIL_RELAY_URL, EMAIL_RELAY_SECRET)');
	}

	const response = await axios.post(relayUrl, {
		secret: relaySecret,
		from,
		to,
		subject,
		text,
		html
	}, {
		headers: {
			'Content-Type': 'application/json'
		},
		timeout: 15000
	});

	if (response.data && response.data.success === false) {
		throw new Error(response.data.error || 'El relay de correo devolvio un error');
	}
}

async function dispatchAppEmail({ to, subject, text, html }) {
	if (appUsesEmailRelay()) {
		return sendMailThroughRelay({ to, subject, text, html });
	}

	const transporter = getMailTransporter();
	const from = process.env.EMAIL_FROM || process.env.EMAIL_SMTP_USER;
	return transporter.sendMail({ from, to, subject, text, html });
}

function renderAnimeWlEmail({ title, intro, bodyHtml, buttonLabel = null, buttonUrl = null, footer }) {
	return `
		<div style="margin:0;padding:32px 16px;background-color:#0b0b0b;font-family:Arial,sans-serif;color:#ffffff;">
			<div style="max-width:620px;margin:0 auto;background-color:#111111;border:1px solid #222222;border-radius:20px;overflow:hidden;">
				<div style="padding:28px 32px;border-bottom:1px solid #1f1f1f;background-color:#000000;">
					<div style="font-size:30px;font-weight:800;line-height:1;color:#ffffff;">
						Anime<span style="color:#18c443;">WL</span>
					</div>
				</div>
				<div style="padding:32px;">
					<h1 style="margin:0 0 16px;font-size:28px;line-height:1.2;color:#ffffff;">${title}</h1>
					<p style="margin:0 0 20px;font-size:16px;line-height:1.7;color:#f3f3f3;">${intro}</p>
					${bodyHtml}
					${buttonLabel && buttonUrl ? `
						<div style="margin:28px 0 12px;">
							<a
								href="${buttonUrl}"
								style="display:inline-block;padding:14px 22px;border-radius:12px;background-color:#209F36;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;"
							>${buttonLabel}</a>
						</div>
					` : ''}
					<p style="margin:28px 0 0;font-size:13px;line-height:1.6;color:#b0b0b0;">${footer}</p>
				</div>
			</div>
		</div>
	`;
}

async function sendVerificationEmail(to, code) {
	const intro = 'Has solicitado verificar tu identidad para cambiar el correo electronico asociado a tu cuenta.';
	const bodyHtml = `
		<p style="margin:0 0 12px;font-size:15px;line-height:1.7;color:#f3f3f3;">Introduce este codigo en la seccion de configuracion de AnimeWL:</p>
		<div style="display:inline-block;margin:8px 0 4px;padding:14px 20px;border-radius:14px;background-color:#000000;border:1px solid #2a2a2a;color:#18c443;font-size:32px;font-weight:800;letter-spacing:4px;">
			${code}
		</div>
	`;

	return dispatchAppEmail({
		to,
		subject: 'Codigo de verificacion para cambio de correo',
		text: `Tu codigo de verificacion es: ${code}. Introduce este codigo en la seccion de configuracion para cambiar tu correo electronico.`,
		html: renderAnimeWlEmail({
			title: 'Cambio de correo',
			intro,
			bodyHtml,
			footer: 'Si no has solicitado este cambio, puedes ignorar este correo sin hacer nada.'
		})
	});
}

async function sendPasswordResetEmail(to, resetToken) {
	const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`;
	const intro = 'Hemos recibido una solicitud para restablecer la contraseña de tu cuenta de AnimeWL.';
	const bodyHtml = `
		<p style="margin:0 0 12px;font-size:15px;line-height:1.7;color:#f3f3f3;">Pulsa el boton para crear una nueva contraseña de forma segura.</p>
		<p style="margin:0;font-size:14px;line-height:1.7;color:#b0b0b0;">Si el boton no funciona, copia y pega este enlace en tu navegador:</p>
		<p style="margin:10px 0 0;word-break:break-word;font-size:14px;line-height:1.7;color:#18c443;">${resetUrl}</p>
	`;

	return dispatchAppEmail({
		to,
		subject: 'Restablecer tu contraseña de AnimeWL',
		text: `Has solicitado restablecer tu contraseña. Haz clic en el siguiente enlace para crear una nueva contraseña: ${resetUrl}\n\nSi no solicitaste esto, ignora este correo.`,
		html: renderAnimeWlEmail({
			title: 'Restablecer contraseña',
			intro,
			bodyHtml,
			buttonLabel: 'Restablecer contraseña',
			buttonUrl: resetUrl,
			footer: 'Si no has solicitado este cambio, ignora este correo y tu contraseña seguirá igual.'
		})
	});
}

// Middleware JSON
app.use(express.json());

app.set('trust proxy', 1);

app.use(cors({
	origin: [
		'https://animewl.cat',
		'http://localhost:5173'
	],
	credentials: true
}));

app.use(cookieSession({
	name: 'session',
	keys: [process.env.SESSION_SECRET],
	maxAge: 30 * 24 * 60 * 60 * 1000,

	secure: isProduction,
	httpOnly: true,
	sameSite: isProduction ? 'none' : 'lax'
}));

app.use((req, res, next) => {
	const authHeader = req.headers.authorization || '';
	const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
	const tokenUser = verifyAuthToken(token);

	if (tokenUser && !req.session.user) {
		req.session.user = tokenUser;
	}

	const originalJson = res.json.bind(res);
	res.json = (body) => {
		if (body && typeof body === 'object' && req.session?.user && !body.token) {
			const refreshedToken = createAuthToken(req.session.user);
			if (refreshedToken) {
				body.token = refreshedToken;
			}
		}

		return originalJson(body);
	};

	next();
});

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

// Endpoint de debug para verificar cookies y sesión
app.get('/api/debug-session', (req, res) => {
	res.json({
		cookies: req.headers.cookie,
		session: req.session,
		isProduction,
		envKeys: Object.keys(process.env).filter(k => k.includes('SESSION') || k.includes('FRONTEND') || k.includes('COOKIE'))
	});
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
		const limit = Number(req.query.limit);
		const offset = Number(req.query.offset || 0);
		const genre = typeof req.query.genre === 'string' && req.query.genre.trim() !== '' ? req.query.genre.trim() : null;
		const hasPagination = Number.isFinite(limit) && limit > 0;
		const fetchLimit = hasPagination ? limit + 1 : null;
		const anime = await listAnimes(genre, fetchLimit, offset);
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

app.get('/api/genres', async (req, res) => {
	try {
		const { data, error } = await supabase
			.from('genere')
			.select('id_genere, nom')
			.order('nom', { ascending: true });

		if (error) {
			throw error;
		}

		return res.json({ success: true, genres: data || [] });
	} catch (err) {
		console.error('GET /api/genres error', err);
		return res.status(500).json({ success: false, error: err.message });
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

const EXCLUDED_GENRE_IDS = new Set([9, 49]);

function hasExcludedGenreEntry(entries = []) {
	return Array.isArray(entries) && entries.some((entry) => EXCLUDED_GENRE_IDS.has(Number(entry?.mal_id)));
}

function filterSafeAnimeSearchResults(animes = []) {
	return (animes || []).filter((anime) => (
		!hasExcludedGenreEntry(anime?.genres) &&
		!hasExcludedGenreEntry(anime?.explicit_genres) &&
		!hasExcludedGenreEntry(anime?.themes)
	));
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
			return filterSafeAnimeSearchResults(response.data?.data || []);
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

async function deleteCommentHandler(req, res) {
	const { commentId } = req.params;
	if (!req.session.user) {
		return res.status(401).json({ success: false, error: 'No hay sesión activa' });
	}
	try {
		const deleted = await deleteCommentById(commentId, req.session.user.id_usuari);
		if (!deleted) {
			return res.status(404).json({ success: false, error: 'Comentario no encontrado' });
		}
		return res.json({ success: true, id_comentari: deleted.id_comentari });
	} catch (err) {
		console.error('DELETE comment error', err);
		return res.status(500).json({ success: false, error: err.message });
	}
}

app.delete('/api/anime/:id/comments/:commentId', deleteCommentHandler);
app.delete('/api/comments/:commentId', deleteCommentHandler);

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
		const episodeCount = await getEpisodeCountByAnime(id);
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

// Obtener favoritos del usuario (privado, requiere sesión)
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

// Función auxiliar para obtener el perfil público de un usuario
async function getPublicProfile(userId) {
	if (!userId) {
		return null;
	}

	try {
		const { data: user, error } = await findPublicUserById(userId);

		if (error || !user) {
			return null;
		}

		// Devolver datos públicos del usuario
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

// Endpoint para obtener el perfil público de un usuario
async function handlePublicProfileRequest(req, res) {
	const { id } = req.params;

	if (!id) {
		return res.status(400).json({ success: false, error: 'User ID is required' });
	}

	const user = await getPublicProfile(id);

	if (!user) {
		return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
	}

	return res.json({ success: true, user, profile: user });
}

app.get([
	'/api/user/:id/public',
	'/api/users/:id/public',
	'/api/profile/:id',
	'/api/user/:id'
], handlePublicProfileRequest);

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

// Obtener favoritos públicos del usuario (solo "Viendo")
async function handlePublicFavoritesRequest(req, res) {
	const { userId } = req.params;

	if (!userId) {
		return res.status(400).json({ success: false, error: 'User ID is required' });
	}

	try {
		const favorites = await findPublicFavoritesByUser(userId);
		return res.json({ success: true, favorites });
	} catch (err) {
		console.error('GET public user favorites error', err);
		return res.status(500).json({ success: false, error: err.message });
	}
}

app.get([
	'/api/user/:userId/favorites/public',
	'/api/users/:userId/favorites/public',
	'/api/profile/:userId/favorites'
], handlePublicFavoritesRequest);

// Obtener todos los favoritos de un usuario (privado y público)
// IMPORTANTE: Este debe ir DESPUÉS de los endpoints más específicos (/public, /profile, etc)
app.get('/api/user/:userId/favorites', async (req, res) => {
	const { userId } = req.params;

	if (!userId) {
		return res.status(400).json({ success: false, error: 'User ID is required' });
	}

	// Si el usuario está logueado y es su propio ID, devolver todos los favoritos
	// Si no, devolver solo los públicos
	const isOwnProfile = req.session.user && String(req.session.user.id_usuari) === String(userId);

	try {
		let favorites;
		if (isOwnProfile) {
			// Usar la función completa para devolver todos los favoritos con datos del anime
			favorites = await findFavoritesByUser(userId);

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
		} else {
			// Devolver solo favoritos públicos
			favorites = await findPublicFavoritesByUser(userId);
			return res.json({ success: true, favorites });
		}
	} catch (err) {
		console.error('GET /api/user/:userId/favorites error', err);
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
	const trimmedContent = typeof contingut === 'string' ? contingut.trim() : '';
	if (!req.session.user) {
		return res.status(401).json({ success: false, error: 'No hay sesión activa' });
	}
	if (!trimmedContent) {
		return res.status(400).json({ success: false, error: 'El comentario no puede estar vacío' });
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

// ruta para forzar la sincronización manualmente
app.delete('/api/comments/:commentId', async (req, res) => {
	const { commentId } = req.params;
	if (!req.session.user) {
		return res.status(401).json({ success: false, error: 'No hay sesión activa' });
	}
	try {
		const deleted = await deleteCommentById(commentId, req.session.user.id_usuari);
		if (!deleted) {
			return res.status(404).json({ success: false, error: 'Comentario no encontrado' });
		}
		return res.json({ success: true, id_comentari: deleted.id_comentari });
	} catch (err) {
		console.error('DELETE /api/comments/:commentId error', err);
		return res.status(500).json({ success: false, error: err.message });
	}
});

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

app.get('/api/settings/update-username', (req, res) => {
	res.set('Allow', 'POST');
	return res.status(405).json({ success: false, error: 'Usa POST para actualizar el nombre de usuario.' });
});

app.post('/api/settings/update-username', async (req, res) => {
	if (!req.session.user) {
		return res.status(401).json({ success: false, error: 'No hay sesión activa' });
	}
	const tokenUser = getAuthenticatedTokenUser(req);
	if (!tokenUser) {
		return res.status(401).json({ success: false, error: 'Token de autenticacion requerido.' });
	}
	if (!isSameAuthenticatedUser(req.session.user, tokenUser)) {
		return res.status(403).json({ success: false, error: 'El token no coincide con la sesion activa.' });
	}

	const { newUsername } = req.body;
	if (typeof newUsername !== 'string' || newUsername.trim() === '') {
		return res.status(400).json({ success: false, error: 'El nombre de usuario no puede estar vacío' });
	}
	try {
		const trimmedUsername = newUsername.trim();
		if (trimmedUsername.length > 30) {
			return res.status(400).json({ success: false, error: 'El nombre de usuario no puede superar 30 caracteres.' });
		}

		const userId = getUserId(req.session.user);
		let currentUser = null;

		if (req.session.user.email) {
			const result = await findUserByEmail(req.session.user.email);
			if (result.error) {
				console.error('Error fetching user by session email:', result.error);
				return res.status(500).json({ success: false, error: 'Error al comprobar el usuario de la sesion.' });
			}
			currentUser = result.data;
		}

		if (!currentUser && req.session.user.nom) {
			const result = await findUserByNom(req.session.user.nom);
			if (result.error) {
				console.error('Error fetching user by session username:', result.error);
				return res.status(500).json({ success: false, error: 'Error al comprobar el usuario de la sesion.' });
			}
			currentUser = result.data;
		}

		if (!currentUser && !userId) {
			return res.status(401).json({ success: false, error: 'La sesion no contiene datos suficientes para identificar al usuario.' });
		}

		const updateUserId = currentUser?.id_usuari || userId;
		if (!updateUserId) {
			return res.status(404).json({ success: false, error: 'Usuario de sesion no encontrado.' });
		}

		const { data, error } = await updateUsername(updateUserId, trimmedUsername);
		if (error) {
			console.error('Error updating username:', error);
			const errorMessage = error.message || 'Error al actualizar el nombre de usuario';
			const statusCode = errorMessage.includes('registrado') ? 400 : 500;
			return res.status(statusCode).json({ success: false, error: errorMessage });
		}
		let updatedUsernameUser = data;
		if (!updatedUsernameUser) {
			const refreshed = await findUserByNom(trimmedUsername);
			if (refreshed.error) {
				console.error('Error fetching updated username:', refreshed.error);
				return res.status(500).json({ success: false, error: 'Error al comprobar el usuario actualizado' });
			}
			updatedUsernameUser = refreshed.data;
		}

		if (!updatedUsernameUser) {
			return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
		}
		// actualizar el nombre de usuario en la sesión para que el cambio se refleje inmediatamente
		req.session.user = {
			...req.session.user,
			id_usuari: updatedUsernameUser.id_usuari,
			nom: updatedUsernameUser.nom,
			email: updatedUsernameUser.email,
			id_anime_preferit: updatedUsernameUser.id_anime_preferit,
			id_anime_recomanat: updatedUsernameUser.id_anime_recomanat,
			img_url: updatedUsernameUser.img_url
		};
		return res.json({ success: true, user: req.session.user });
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

	// Responder (cookie-session guarda automáticamente)
	return res.json({
		success: true,
		user: req.session.user
	});
});

// Verificar sesión actual
app.get('/api/session', async (req, res) => {
	try {
		// Si no hay sesión, devolver 200 con user: null (no es un error)
		if (!req.session.user) {
			return res.json({ success: true, user: null });
		}

		const sessionUser = req.session.user;

		if (sessionUser.id_anime_preferit == null || sessionUser.id_anime_recomanat == null || sessionUser.img_url == null) {
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
		}

		return res.json({ success: true, user: sessionUser });
	} catch (error) {
		console.error('Error in /api/session:', error);
		return res.status(500).json({ success: false, error: 'Error interno del servidor' });
	}
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
			return res.json({ success: true, user: req.session.user });
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

		req.session.user = {
			...req.session.user,
			id_usuari: data.id_usuari,
			nom: data.nom,
			email: data.email,
			id_anime_preferit: data.id_anime_preferit,
			id_anime_recomanat: data.id_anime_recomanat,
			img_url: data.img_url
		};

		return res.json({ success: true, user: req.session.user });
	} catch (error) {
		console.error('POST /api/user/anime error', error);
		return res.status(500).json({ success: false, error: error.message });
	}
});

// Logout
app.post('/api/logout', (req, res) => {
	req.session = null;
	return res.json({ success: true, message: 'Sesión cerrada correctamente' });
});

// Solicitar recuperación de contraseña
app.post('/api/forgot-password', async (req, res) => {
	const { email } = req.body;

	if (!email) {
		return res.status(400).json({ success: false, error: 'El correo electrónico es requerido.' });
	}

	if (!validateEmail(email)) {
		return res.status(400).json({ success: false, error: 'El correo electrónico no es válido.' });
	}

	try {
		// Buscar usuario por email
		const result = await findUserByEmail(email.trim());

		if (result.error) {
			console.error('Error finding user by email:', result.error);
			return res.status(500).json({ success: false, error: 'Error al buscar el usuario.' });
		}

		// No revelar si el usuario existe o no por seguridad
		if (!result.data) {
			return res.json({ success: true, message: 'Si el correo existe, recibirás un enlace para restablecer tu contraseña.' });
		}

		// Generar token de recuperación
		const resetToken = randomUUID();

		// Guardar token en la base de datos
		const updateResult = await updateResetPasswordToken(email.trim(), resetToken);

		if (updateResult.error) {
			console.error('Error saving reset token:', updateResult.error);
			return res.status(500).json({ success: false, error: 'Error al generar el token de recuperación.' });
		}

		// Enviar correo con el enlace
		await sendPasswordResetEmail(email.trim(), resetToken);

		return res.json({ success: true, message: 'Si el correo existe, recibirás un enlace para restablecer tu contraseña.' });
	} catch (error) {
		console.error('Error in forgot-password:', error);
		return res.status(500).json({ success: false, error: 'Error al procesar la solicitud.' });
	}
});

// Verificar token de recuperación
app.get('/api/verify-reset-token', async (req, res) => {
	const { token } = req.query;

	if (!token) {
		return res.status(400).json({ success: false, error: 'Token requerido.' });
	}

	try {
		const result = await findUserByResetToken(token);

		if (result.error) {
			console.error('Error verifying reset token:', result.error);
			return res.status(500).json({ success: false, error: 'Error al verificar el token.' });
		}

		if (!result.data) {
			return res.status(400).json({ success: false, error: 'Token inválido o expirado.' });
		}

		// Verificar si el token ha expirado
		if (result.data.reset_password_token_expiredate) {
			const expirationDate = new Date(result.data.reset_password_token_expiredate);
			if (new Date() > expirationDate) {
				return res.status(400).json({ success: false, error: 'Token inválido o expirado.' });
			}
		}

		return res.json({ success: true, message: 'Token válido.' });
	} catch (error) {
		console.error('Error in verify-reset-token:', error);
		return res.status(500).json({ success: false, error: 'Error al verificar el token.' });
	}
});

// Restablecer contraseña
app.post('/api/reset-password', async (req, res) => {
	const { token, newPassword, confirmPassword } = req.body;

	if (!token || !newPassword || !confirmPassword) {
		return res.status(400).json({ success: false, error: 'Todos los campos son requeridos.' });
	}

	if (newPassword !== confirmPassword) {
		return res.status(400).json({ success: false, error: 'Las contraseñas no coinciden.' });
	}

	if (newPassword.length < 6) {
		return res.status(400).json({ success: false, error: 'La contraseña debe tener al menos 6 caracteres.' });
	}

	try {
		// Buscar usuario por token
		const result = await findUserByResetToken(token);

		if (result.error) {
			console.error('Error finding user by reset token:', result.error);
			return res.status(500).json({ success: false, error: 'Error al buscar el usuario.' });
		}

		if (!result.data) {
			return res.status(400).json({ success: false, error: 'Token inválido o expirado.' });
		}

		// Verificar si el token ha expirado
		if (result.data.reset_password_token_expiredate) {
			const expirationDate = new Date(result.data.reset_password_token_expiredate);
			if (new Date() > expirationDate) {
				return res.status(400).json({ success: false, error: 'Token inválido o expirado.' });
			}
		}

		// Hashear la nueva contraseña
		const newHashedPassword = hashPassword(newPassword);

		// Actualizar la contraseña
		const updateResult = await updateUserPassword(result.data.id_usuari, newHashedPassword);

		if (updateResult.error) {
			console.error('Error updating password:', updateResult.error);
			return res.status(500).json({ success: false, error: 'Error al actualizar la contraseña.' });
		}

		// Limpiar el token de recuperación
		await clearResetPasswordToken(result.data.id_usuari);

		return res.json({ success: true, message: 'Contraseña actualizada correctamente. Ya puedes iniciar sesión con tu nueva contraseña.' });
	} catch (error) {
		console.error('Error in reset-password:', error);
		return res.status(500).json({ success: false, error: 'Error al restablecer la contraseña.' });
	}
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
