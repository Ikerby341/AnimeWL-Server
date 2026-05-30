import { createHmac, randomBytes, scryptSync } from 'crypto';

export function hashPassword(password) {
	const salt = randomBytes(16).toString('hex');
	const hashed = scryptSync(password, salt, 64).toString('hex');
	return `${salt}:${hashed}`;
}

export function createResetPasswordToken() {
	return randomBytes(32).toString('base64url');
}

export function hashResetPasswordToken(token) {
	const secret = process.env.RESET_PASSWORD_TOKEN_SECRET || process.env.SESSION_SECRET;
	if (!secret) {
		throw new Error('RESET_PASSWORD_TOKEN_SECRET or SESSION_SECRET must be configured');
	}
	return createHmac('sha256', secret).update(token).digest('hex');
}

export function validateEmail(email) {
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

export function createAuthToken(user) {
	if (!process.env.SESSION_SECRET) return null;

	const payload = base64UrlEncode(JSON.stringify({
		user,
		exp: Date.now() + 30 * 24 * 60 * 60 * 1000
	}));
	const signature = signTokenPayload(payload);
	return `${payload}.${signature}`;
}

export function verifyAuthToken(token) {
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

export function getBearerToken(req) {
	const authHeader = req.headers.authorization || '';
	return authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
}

export function getUserId(user) {
	return user?.id_usuari || user?.id_usuario || user?.id_user || user?.id || null;
}

export function getAuthenticatedTokenUser(req) {
	return verifyAuthToken(getBearerToken(req));
}

export function isSameAuthenticatedUser(sessionUser, tokenUser) {
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
