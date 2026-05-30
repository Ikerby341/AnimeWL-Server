import { createAuthToken, verifyAuthToken } from '../utils/auth.js';

export function authTokenSession(req, res, next) {
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
}
