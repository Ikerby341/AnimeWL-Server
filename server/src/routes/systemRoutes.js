import { Router } from 'express';
import { testDbConnection } from '../models/anime_model.js';

export function createSystemRouter({ isProduction }) {
	const router = Router();

	router.get('/test-db', async (req, res) => {
		const { data, error } = await testDbConnection();

		if (error) {
			console.error('Supabase error:', error);
			return res.status(500).json({ success: false, error });
		}
		res.json({ success: true, rows: data });
	});

	router.get('/api/debug-session', (req, res) => {
		res.json({
			cookies: req.headers.cookie,
			session: req.session,
			isProduction,
			envKeys: Object.keys(process.env).filter(k => k.includes('SESSION') || k.includes('FRONTEND') || k.includes('COOKIE'))
		});
	});

	return router;
}
