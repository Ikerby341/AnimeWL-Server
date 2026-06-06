import { Router } from 'express';
import { randomUUID, scryptSync } from 'crypto';
import { syncAnimeMetadataById } from '../controllers/syncAnime.js';
import { findAnimeById } from '../models/anime_model.js';
import { findRatingSummaryByAnimeId } from '../models/rating_model.js';
import { getUserStats } from '../models/progress_model.js';
import { findFavoritesByUser, addFavorite, removeFavorite, updateFavoriteStatus, findPublicFavoritesByUser } from '../models/favorites_model.js';
import {
	registerUser,
	findUserById,
	findUserByNom,
	findUserByEmail,
	listUsersForAdmin,
	updateUserProfilePicture,
	updateUserAnimeChoice,
	updateUsername,
	updateUserAdminRole,
	updateUserPassword,
	updateUserEmail,
	updateResetPasswordToken,
	findUserByResetToken,
	clearResetPasswordToken,
	findPublicUserById
} from '../models/users_model.js';
import {
	createResetPasswordToken,
	getAuthenticatedTokenUser,
	getUserId,
	hashPassword,
	hashResetPasswordToken,
	isSameAuthenticatedUser,
	validateEmail
} from '../utils/auth.js';
import { sendAdminUsernameChangedEmail, sendPasswordResetEmail, sendVerificationEmail } from '../services/emailService.js';

async function enrichFavoritesWithAnime(favorites) {
	return Promise.all(
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
}

async function getPublicProfile(userId) {
	if (!userId) {
		return null;
	}

	try {
		const { data: user, error } = await findPublicUserById(userId);

		if (error || !user) {
			return null;
		}

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

async function ensureAnimeExists(idAnime) {
	let anime = await findAnimeById(idAnime);
	if (!anime) {
		await syncAnimeMetadataById(idAnime);
		anime = await findAnimeById(idAnime);
	}
	return anime;
}

function updateSessionUser(req, user) {
	req.session.user = {
		...req.session.user,
		id_usuari: user.id_usuari,
		nom: user.nom,
		email: user.email,
		id_anime_preferit: user.id_anime_preferit,
		id_anime_recomanat: user.id_anime_recomanat,
		img_url: user.img_url,
		isAdmin: Boolean(user.isAdmin)
	};
}

async function findSessionUser(sessionUser) {
	const userId = getUserId(sessionUser);

	if (userId) {
		const result = await findUserById(userId);
		if (!result.error && result.data) {
			return result;
		}
		if (result.error) {
			return result;
		}
	}

	if (sessionUser?.nom) {
		return findUserByNom(sessionUser.nom);
	}

	return { data: null, error: null };
}

async function requireAdmin(req, res) {
	if (!req.session.user) {
		res.status(401).json({ success: false, error: 'No hay sesión activa' });
		return null;
	}

	const result = await findSessionUser(req.session.user);
	if (result.error) {
		console.error('Error checking admin session:', result.error);
		res.status(500).json({ success: false, error: 'Error al comprobar permisos de administrador.' });
		return null;
	}

	if (!result.data || result.data.isAdmin !== true) {
		res.status(403).json({ success: false, error: 'No tienes permisos de administrador.' });
		return null;
	}

	updateSessionUser(req, result.data);
	return result.data;
}

export function createUserRouter() {
	const router = Router();

	router.get('/api/user/stats', async (req, res) => {
		if (!req.session.user) {
			return res.status(401).json({ success: false, error: 'No hay sesiÃ³n activa' });
		}

		try {
			const stats = await getUserStats(req.session.user.id_usuari);
			return res.json({ success: true, stats });
		} catch (err) {
			console.error('GET /api/user/stats error', err);
			return res.status(500).json({ success: false, error: err.message });
		}
	});

	router.get('/api/user/favorites', async (req, res) => {
		if (!req.session.user) {
			return res.status(401).json({ success: false, error: 'No hay sesiÃ³n activa' });
		}

		try {
			const favorites = await findFavoritesByUser(req.session.user.id_usuari);
			const enrichedFavorites = await enrichFavoritesWithAnime(favorites);

			return res.json({ success: true, favorites: enrichedFavorites });
		} catch (err) {
			console.error('GET /api/user/favorites error', err);
			return res.status(500).json({ success: false, error: err.message });
		}
	});

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

	router.get([
		'/api/user/:id/public',
		'/api/users/:id/public',
		'/api/profile/:id',
		'/api/user/:id'
	], handlePublicProfileRequest);

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

	router.get([
		'/api/user/:userId/favorites/public',
		'/api/users/:userId/favorites/public',
		'/api/profile/:userId/favorites'
	], handlePublicFavoritesRequest);

	router.get('/api/admin/users', async (req, res) => {
		const adminUser = await requireAdmin(req, res);
		if (!adminUser) return;

		try {
			const { data, error } = await listUsersForAdmin();
			if (error) {
				console.error('GET /api/admin/users error:', error);
				return res.status(500).json({ success: false, error: 'Error al cargar usuarios.' });
			}

			return res.json({ success: true, users: data || [] });
		} catch (err) {
			console.error('GET /api/admin/users error:', err);
			return res.status(500).json({ success: false, error: err.message });
		}
	});

	router.patch('/api/admin/users/:userId', async (req, res) => {
		const adminUser = await requireAdmin(req, res);
		if (!adminUser) return;

		const { userId } = req.params;
		const { nom, isAdmin } = req.body;

		if (!userId) {
			return res.status(400).json({ success: false, error: 'Falta el id del usuario.' });
		}

		if (nom !== undefined && (typeof nom !== 'string' || nom.trim() === '')) {
			return res.status(400).json({ success: false, error: 'El nombre de usuario no puede estar vacio.' });
		}

		if (nom !== undefined && nom.trim().length > 30) {
			return res.status(400).json({ success: false, error: 'El nombre de usuario no puede superar 30 caracteres.' });
		}

		if (isAdmin !== undefined && typeof isAdmin !== 'boolean') {
			return res.status(400).json({ success: false, error: 'El rol de administrador debe ser booleano.' });
		}

		try {
			const currentUser = await findUserById(userId);
			if (currentUser.error) {
				console.error('Admin user lookup error:', currentUser.error);
				return res.status(500).json({ success: false, error: 'Error al buscar el usuario.' });
			}

			if (!currentUser.data) {
				return res.status(404).json({ success: false, error: 'Usuario no encontrado.' });
			}

			let updatedUser = currentUser.data;
			let emailWarning = null;
			const trimmedUsername = nom?.trim();
			const usernameChanged = trimmedUsername !== undefined && trimmedUsername !== currentUser.data.nom;

			if (usernameChanged) {
				const { data, error } = await updateUsername(userId, trimmedUsername);
				if (error) {
					const errorMessage = error.message || 'Error al actualizar el nombre de usuario.';
					const statusCode = errorMessage.includes('registrado') ? 400 : 500;
					return res.status(statusCode).json({ success: false, error: errorMessage });
				}
				updatedUser = data || { ...updatedUser, nom: trimmedUsername };
			}

			if (isAdmin !== undefined && isAdmin !== Boolean(updatedUser.isAdmin)) {
				const { data, error } = await updateUserAdminRole(userId, isAdmin);
				if (error) {
					console.error('Admin role update error:', error);
					return res.status(500).json({ success: false, error: 'Error al actualizar el rol del usuario.' });
				}
				updatedUser = data || { ...updatedUser, isAdmin };
			}

			if (usernameChanged) {
				try {
					await sendAdminUsernameChangedEmail(updatedUser.email || currentUser.data.email, updatedUser.nom);
				} catch (emailError) {
					console.error('Admin username change email error:', emailError);
					emailWarning = 'Usuario actualizado, pero no se pudo enviar el correo informativo.';
				}
			}

			if (String(userId) === String(getUserId(req.session.user))) {
				updateSessionUser(req, updatedUser);
			}

			return res.json({
				success: true,
				user: {
					id_usuari: updatedUser.id_usuari,
					nom: updatedUser.nom,
					email: updatedUser.email,
					isAdmin: Boolean(updatedUser.isAdmin)
				},
				warning: emailWarning
			});
		} catch (err) {
			console.error('PATCH /api/admin/users/:userId error:', err);
			return res.status(500).json({ success: false, error: err.message });
		}
	});

	router.get('/api/user/:userId/favorites', async (req, res) => {
		const { userId } = req.params;

		if (!userId) {
			return res.status(400).json({ success: false, error: 'User ID is required' });
		}

		const isOwnProfile = req.session.user && String(req.session.user.id_usuari) === String(userId);

		try {
			if (isOwnProfile) {
				const favorites = await findFavoritesByUser(userId);
				const enrichedFavorites = await enrichFavoritesWithAnime(favorites);
				return res.json({ success: true, favorites: enrichedFavorites });
			}

			const favorites = await findPublicFavoritesByUser(userId);
			return res.json({ success: true, favorites });
		} catch (err) {
			console.error('GET /api/user/:userId/favorites error', err);
			return res.status(500).json({ success: false, error: err.message });
		}
	});

	router.post('/api/user/favorites/:id_anime', async (req, res) => {
		if (!req.session.user) {
			return res.status(401).json({ success: false, error: 'No hay sesiÃ³n activa' });
		}

		const { id_anime } = req.params;
		if (!id_anime) {
			return res.status(400).json({ success: false, error: 'Falta el id del anime' });
		}

		try {
			const anime = await ensureAnimeExists(id_anime);
			if (!anime) {
				return res.status(500).json({ success: false, error: 'No se pudo sincronizar el anime seleccionado.' });
			}

			const favorite = await addFavorite(req.session.user.id_usuari, id_anime);
			return res.json({ success: true, favorite: { ...favorite, anime } });
		} catch (err) {
			console.error('POST /api/user/favorites/:id_anime error', err);
			return res.status(500).json({ success: false, error: err.message });
		}
	});

	router.delete('/api/user/favorites/:id_anime', async (req, res) => {
		if (!req.session.user) {
			return res.status(401).json({ success: false, error: 'No hay sesiÃ³n activa' });
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

	router.put('/api/user/favorites/:id_anime', async (req, res) => {
		if (!req.session.user) {
			return res.status(401).json({ success: false, error: 'No hay sesiÃ³n activa' });
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

	router.get('/api/settings/update-username', (req, res) => {
		res.set('Allow', 'POST');
		return res.status(405).json({ success: false, error: 'Usa POST para actualizar el nombre de usuario.' });
	});

	router.post('/api/settings/update-username', async (req, res) => {
		if (!req.session.user) {
			return res.status(401).json({ success: false, error: 'No hay sesiÃ³n activa' });
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
			return res.status(400).json({ success: false, error: 'El nombre de usuario no puede estar vacÃ­o' });
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
			updateSessionUser(req, updatedUsernameUser);
			return res.json({ success: true, user: req.session.user });
		} catch (error) {
			console.error('Error updating username:', error);
			return res.status(500).json({ success: false, error: 'Error al actualizar el nombre de usuario' });
		}
	});

	router.post('/api/user/update-password', async (req, res) => {
		if (!req.session.user) {
			return res.status(401).json({ success: false, error: 'No hay sesiÃ³n activa' });
		}
		const { currentPassword, newPassword, confirmPassword } = req.body;
		if (!currentPassword || !newPassword || !confirmPassword) {
			return res.status(400).json({ success: false, error: 'Faltan datos para cambiar la contraseÃ±a.' });
		}
		if (newPassword !== confirmPassword) {
			return res.status(400).json({ success: false, error: 'La nueva contraseÃ±a y su confirmaciÃ³n no coinciden.' });
		}
		if (newPassword.length < 6) {
			return res.status(400).json({ success: false, error: 'La nueva contraseÃ±a debe tener al menos 6 caracteres.' });
		}
		try {
			const result = await findSessionUser(req.session.user);
			if (result.error) {
				console.error('Error fetching session user info:', result.error);
				return res.status(500).json({ success: false, error: 'Error al comprobar la sesiÃ³n.' });
			}
			if (!result.data) {
				return res.status(404).json({ success: false, error: 'Usuario no encontrado.' });
			}

			const storedPassword = result.data.contrasenya;
			const [salt, hashed] = storedPassword.split(':');
			const attemptHash = scryptSync(currentPassword, salt, 64).toString('hex');
			if (attemptHash !== hashed) {
				return res.status(400).json({ success: false, error: 'La contraseÃ±a actual es incorrecta.' });
			}

			const newHashedPassword = hashPassword(newPassword);
			const { data, error } = await updateUserPassword(req.session.user.id_usuari, newHashedPassword);
			if (error) {
				console.error('Error updating password:', error);
				return res.status(500).json({ success: false, error: 'Error al actualizar la contraseÃ±a.' });
			}
			if (!data) {
				return res.status(404).json({ success: false, error: 'Usuario no encontrado.' });
			}

			return res.json({ success: true, message: 'ContraseÃ±a actualizada correctamente.' });
		} catch (error) {
			console.error('Error updating password:', error);
			return res.status(500).json({ success: false, error: 'Error al actualizar la contraseÃ±a.' });
		}
	});

	router.post('/api/user/send-email-code', async (req, res) => {
		if (!req.session.user) {
			return res.status(401).json({ success: false, error: 'No hay sesiÃ³n activa' });
		}

		const currentEmail = req.session.user.email;
		if (!currentEmail) {
			return res.status(400).json({ success: false, error: 'No se encontrÃ³ el correo electrÃ³nico asociado.' });
		}

		const code = Math.floor(100000 + Math.random() * 900000).toString();
		req.session.emailChange = {
			code,
			expiresAt: Date.now() + 10 * 60 * 1000
		};

		try {
			await sendVerificationEmail(currentEmail, code);
			return res.json({ success: true, message: 'CÃ³digo enviado al correo electrÃ³nico actual.' });
		} catch (error) {
			console.error('Error sending email verification code:', error);
			return res.status(500).json({ success: false, error: 'Error al enviar el cÃ³digo de verificaciÃ³n.' });
		}
	});

	router.post('/api/user/update-email', async (req, res) => {
		if (!req.session.user) {
			return res.status(401).json({ success: false, error: 'No hay sesiÃ³n activa' });
		}

		const { code, newEmail } = req.body;
		if (!code || !newEmail) {
			return res.status(400).json({ success: false, error: 'Faltan datos para cambiar el correo electrÃ³nico.' });
		}

		if (!validateEmail(newEmail)) {
			return res.status(400).json({ success: false, error: 'El nuevo correo electrÃ³nico no es vÃ¡lido.' });
		}

		const sessionCode = req.session.emailChange?.code;
		const expiresAt = req.session.emailChange?.expiresAt;

		if (!sessionCode || !expiresAt || Date.now() > expiresAt) {
			return res.status(400).json({ success: false, error: 'El cÃ³digo de verificaciÃ³n ha caducado. Vuelve a solicitar uno nuevo.' });
		}

		if (String(code).trim() !== String(sessionCode).trim()) {
			return res.status(400).json({ success: false, error: 'El cÃ³digo de verificaciÃ³n no es correcto.' });
		}

		if (newEmail.trim().toLowerCase() === req.session.user.email?.trim().toLowerCase()) {
			return res.status(400).json({ success: false, error: 'El nuevo correo debe ser diferente al actual.' });
		}

		try {
			const existingEmail = await findUserByEmail(newEmail.trim());
			if (existingEmail.error) {
				console.error('Error checking email uniqueness:', existingEmail.error);
				return res.status(500).json({ success: false, error: 'Error al comprobar el correo electrÃ³nico.' });
			}
			if (existingEmail.data) {
				return res.status(400).json({ success: false, error: 'Ese correo electrÃ³nico ya estÃ¡ registrado.' });
			}

			const { data, error } = await updateUserEmail(req.session.user.id_usuari, newEmail.trim());
			if (error) {
				console.error('Error updating email:', error);
				return res.status(500).json({ success: false, error: 'Error al actualizar el correo electrÃ³nico.' });
			}
			if (!data) {
				return res.status(404).json({ success: false, error: 'Usuario no encontrado.' });
			}

			req.session.user.email = newEmail.trim();
			delete req.session.emailChange;
			return res.json({ success: true, message: 'Correo electrÃ³nico actualizado correctamente.' });
		} catch (error) {
			console.error('Error updating email:', error);
			return res.status(500).json({ success: false, error: 'Error al actualizar el correo electrÃ³nico.' });
		}
	});

	router.post('/api/register', async (req, res) => {
		const { nom, email, contrasenya } = req.body;

		if (!nom || !email || !contrasenya) {
			return res.status(400).json({ success: false, error: 'Faltan datos de registro.' });
		}
		if (!validateEmail(email)) {
			return res.status(400).json({ success: false, error: 'El email no es vÃ¡lido.' });
		}
		if (contrasenya.length < 6) {
			return res.status(400).json({ success: false, error: 'La contraseÃ±a debe tener al menos 6 caracteres.' });
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

	router.post('/api/login', async (req, res) => {
		const { username, password } = req.body;

		if (!username || !password) {
			return res.status(400).json({ success: false, error: 'Faltan datos de inicio de sesiÃ³n.' });
		}

		const result = await findUserByNom(username);

		if (result.error) {
			console.error('Supabase login error:', result.error);
			return res.status(500).json({ success: false, error: 'Error al iniciar sesiÃ³n.' });
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

		req.session.user = {
			id_usuari: result.data.id_usuari,
			nom: result.data.nom,
			email: result.data.email,
			id_anime_preferit: result.data.id_anime_preferit,
			id_anime_recomanat: result.data.id_anime_recomanat,
			img_url: result.data.img_url,
			isAdmin: Boolean(result.data.isAdmin)
		};

		return res.json({
			success: true,
			user: req.session.user
		});
	});

	router.get('/api/session', async (req, res) => {
		try {
			if (!req.session.user) {
				return res.json({ success: true, user: null });
			}

			const refreshedUser = await findSessionUser(req.session.user);
			if (refreshedUser.error) {
				console.error('Error fetching user session info:', refreshedUser.error);
				return res.status(500).json({ success: false, error: 'Error al comprobar la sesion' });
			}

			if (refreshedUser.data) {
				updateSessionUser(req, refreshedUser.data);
				return res.json({ success: true, user: req.session.user });
			}

			req.session = null;
			return res.json({ success: true, user: null });

			const sessionUser = req.session.user;

			if (sessionUser.id_anime_preferit == null || sessionUser.id_anime_recomanat == null || sessionUser.img_url == null || sessionUser.isAdmin == null) {
				const result = await findUserByNom(sessionUser.nom);
				if (result.error) {
					console.error('Error fetching user session info:', result.error);
					return res.status(500).json({ success: false, error: 'Error al comprobar la sesiÃ³n' });
				}

				if (result.data) {
					req.session.user = {
						id_usuari: result.data.id_usuari,
						nom: result.data.nom,
						email: result.data.email,
						id_anime_preferit: result.data.id_anime_preferit,
						id_anime_recomanat: result.data.id_anime_recomanat,
						img_url: result.data.img_url,
						isAdmin: Boolean(result.data.isAdmin)
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

	router.get('/api/check-session', async (req, res) => {
		if (!req.session.user) {
			return res.status(401).json({ success: false, error: 'No hay sesiÃ³n activa' });
		}
		try {
			const result = await findSessionUser(req.session.user);
			if (result.error) {
				console.error('Error fetching session user info:', result.error);
				return res.status(500).json({ success: false, error: 'Error al comprobar la sesiÃ³n' });
			}
			if (result.data) {
				req.session.user = {
					id_usuari: result.data.id_usuari,
					nom: result.data.nom,
					email: result.data.email,
					id_anime_preferit: result.data.id_anime_preferit,
					id_anime_recomanat: result.data.id_anime_recomanat,
					img_url: result.data.img_url,
					isAdmin: Boolean(result.data.isAdmin)
				};
				return res.json({ success: true, user: req.session.user });
			}
		} catch (error) {
			console.error('Error fetching session user info:', error);
			return res.status(500).json({ success: false, error: 'Error al comprobar la sesiÃ³n' });
		}

		return res.json({ success: true, user: req.session.user });
	});

	router.post('/api/user/anime', async (req, res) => {
		const { type, id_anime } = req.body;
		if (!req.session.user) {
			return res.status(401).json({ success: false, error: 'No hay sesiÃ³n activa' });
		}
		if (!['favorite', 'recommended'].includes(type)) {
			return res.status(400).json({ success: false, error: 'Tipo invÃ¡lido. Usa favorite o recommended.' });
		}
		if (!id_anime) {
			return res.status(400).json({ success: false, error: 'Falta el id del anime.' });
		}

		const field = type === 'favorite' ? 'id_anime_preferit' : 'id_anime_recomanat';
		try {
			const anime = await ensureAnimeExists(id_anime);
			if (!anime) {
				return res.status(500).json({ success: false, error: 'No se pudo sincronizar el anime seleccionado.' });
			}

			const { data, error } = await updateUserAnimeChoice(req.session.user.id_usuari, field, id_anime);
			if (error) {
				console.error('Error updating user anime choice:', error);
				return res.status(500).json({ success: false, error: 'Error al actualizar el anime del usuario' });
			}
			if (!data) {
				return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
			}

			updateSessionUser(req, data);
			return res.json({ success: true, user: req.session.user });
		} catch (error) {
			console.error('POST /api/user/anime error', error);
			return res.status(500).json({ success: false, error: error.message });
		}
	});

	router.post('/api/logout', (req, res) => {
		req.session = null;
		return res.json({ success: true, message: 'SesiÃ³n cerrada correctamente' });
	});

	router.post('/api/forgot-password', async (req, res) => {
		const { email } = req.body;

		if (!email) {
			return res.status(400).json({ success: false, error: 'El correo electrÃ³nico es requerido.' });
		}

		if (!validateEmail(email)) {
			return res.status(400).json({ success: false, error: 'El correo electrÃ³nico no es vÃ¡lido.' });
		}

		try {
			const result = await findUserByEmail(email.trim());

			if (result.error) {
				console.error('Error finding user by email:', result.error);
				return res.status(500).json({ success: false, error: 'Error al buscar el usuario.' });
			}

			if (!result.data) {
				return res.json({ success: true, message: 'Si el correo existe, recibirÃ¡s un enlace para restablecer tu contraseÃ±a.' });
			}

			const resetToken = createResetPasswordToken();
			const resetTokenHash = hashResetPasswordToken(resetToken);
			const updateResult = await updateResetPasswordToken(email.trim(), resetTokenHash);

			if (updateResult.error) {
				console.error('Error saving reset token:', updateResult.error);
				return res.status(500).json({ success: false, error: 'Error al generar el token de recuperaciÃ³n.' });
			}

			await sendPasswordResetEmail(email.trim(), resetToken);

			return res.json({ success: true, message: 'Si el correo existe, recibirÃ¡s un enlace para restablecer tu contraseÃ±a.' });
		} catch (error) {
			console.error('Error in forgot-password:', error);
			return res.status(500).json({ success: false, error: 'Error al procesar la solicitud.' });
		}
	});

	router.get('/api/verify-reset-token', async (req, res) => {
		const { token } = req.query;

		if (typeof token !== 'string' || !token) {
			return res.status(400).json({ success: false, error: 'Token requerido.' });
		}

		try {
			const resetTokenHash = hashResetPasswordToken(token);
			const result = await findUserByResetToken(resetTokenHash);

			if (result.error) {
				console.error('Error verifying reset token:', result.error);
				return res.status(500).json({ success: false, error: 'Error al verificar el token.' });
			}

			if (!result.data) {
				return res.status(400).json({ success: false, error: 'Token invÃ¡lido o expirado.' });
			}

			if (result.data.reset_password_token_expiredate) {
				const expirationDate = new Date(result.data.reset_password_token_expiredate);
				if (new Date() > expirationDate) {
					return res.status(400).json({ success: false, error: 'Token invÃ¡lido o expirado.' });
				}
			}

			return res.json({ success: true, message: 'Token vÃ¡lido.' });
		} catch (error) {
			console.error('Error in verify-reset-token:', error);
			return res.status(500).json({ success: false, error: 'Error al verificar el token.' });
		}
	});

	router.post('/api/reset-password', async (req, res) => {
		const { token, newPassword, confirmPassword } = req.body;

		if (typeof token !== 'string' || !token || !newPassword || !confirmPassword) {
			return res.status(400).json({ success: false, error: 'Todos los campos son requeridos.' });
		}

		if (newPassword !== confirmPassword) {
			return res.status(400).json({ success: false, error: 'Las contraseÃ±as no coinciden.' });
		}

		if (newPassword.length < 6) {
			return res.status(400).json({ success: false, error: 'La contraseÃ±a debe tener al menos 6 caracteres.' });
		}

		try {
			const resetTokenHash = hashResetPasswordToken(token);
			const result = await findUserByResetToken(resetTokenHash);

			if (result.error) {
				console.error('Error finding user by reset token:', result.error);
				return res.status(500).json({ success: false, error: 'Error al buscar el usuario.' });
			}

			if (!result.data) {
				return res.status(400).json({ success: false, error: 'Token invÃ¡lido o expirado.' });
			}

			if (result.data.reset_password_token_expiredate) {
				const expirationDate = new Date(result.data.reset_password_token_expiredate);
				if (new Date() > expirationDate) {
					return res.status(400).json({ success: false, error: 'Token invÃ¡lido o expirado.' });
				}
			}

			const newHashedPassword = hashPassword(newPassword);
			const updateResult = await updateUserPassword(result.data.id_usuari, newHashedPassword);

			if (updateResult.error) {
				console.error('Error updating password:', updateResult.error);
				return res.status(500).json({ success: false, error: 'Error al actualizar la contraseÃ±a.' });
			}

			await clearResetPasswordToken(result.data.id_usuari);

			return res.json({ success: true, message: 'ContraseÃ±a actualizada correctamente. Ya puedes iniciar sesiÃ³n con tu nueva contraseÃ±a.' });
		} catch (error) {
			console.error('Error in reset-password:', error);
			return res.status(500).json({ success: false, error: 'Error al restablecer la contraseÃ±a.' });
		}
	});

	router.post('/api/update-profile-picture', async (req, res) => {
		const { img_url } = req.body;
		if (!req.session.user) {
			return res.status(401).json({ success: false, error: 'No hay sesiÃ³n activa' });
		}
		if (!img_url || typeof img_url !== 'string' || !/^https?:\/\/.+\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(img_url)) {
			return res.status(400).json({ success: false, error: 'URL de imagen no vÃ¡lida' });
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

	return router;
}
