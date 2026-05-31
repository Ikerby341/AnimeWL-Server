import { Router } from 'express';

export function createSystemRouter() {
	const router = Router();

	router.get('/health', (req, res) => {
		res.json({ success: true });
	});

	return router;
}
