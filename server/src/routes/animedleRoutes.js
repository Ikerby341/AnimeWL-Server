import { Router } from 'express';
import { getUserId } from '../utils/auth.js';
import {
	getAnimedleStatus,
	searchAnimedleSuggestions,
	submitAnimedleGuess
} from '../models/animedle_model.js';

function requireSession(req, res) {
	const userId = getUserId(req.session?.user);
	if (!userId) {
		res.status(401).json({ success: false, error: 'No hay sesión activa' });
		return null;
	}

	return userId;
}

export function createAnimedleRouter() {
	const router = Router();

	router.get('/api/animedle', async (req, res) => {
		const userId = requireSession(req, res);
		if (!userId) return;

		try {
			const game = await getAnimedleStatus(userId);
			return res.json({ success: true, game });
		} catch (err) {
			console.error('GET /api/animedle error', err);
			return res.status(500).json({ success: false, error: err.message });
		}
	});

	router.get('/api/animedle/suggestions', async (req, res) => {
		const userId = requireSession(req, res);
		if (!userId) return;

		try {
			const suggestions = await searchAnimedleSuggestions(req.query.q, 8);
			return res.json({ success: true, suggestions });
		} catch (err) {
			console.error('GET /api/animedle/suggestions error', err);
			return res.status(500).json({ success: false, error: err.message });
		}
	});

	router.post('/api/animedle/guess', async (req, res) => {
		const userId = requireSession(req, res);
		if (!userId) return;

		try {
			const game = await submitAnimedleGuess(userId, req.body?.guess);
			return res.json({ success: true, game });
		} catch (err) {
			console.error('POST /api/animedle/guess error', err);
			return res.status(400).json({ success: false, error: err.message });
		}
	});

	return router;
}
