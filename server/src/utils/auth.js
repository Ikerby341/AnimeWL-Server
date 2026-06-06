import { createHmac, randomBytes, scryptSync } from 'crypto';

function crearHashContrasenya(password) {
  const salt = randomBytes(16).toString('hex');
  const hashed = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hashed}`;
}export { crearHashContrasenya };

function crearTokenRestablimentContrasenya() {
  return randomBytes(32).toString('base64url');
}export { crearTokenRestablimentContrasenya };

function crearHashTokenRestablimentContrasenya(token) {
  const secret = process.env.RESET_PASSWORD_TOKEN_SECRET || process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error('RESET_PASSWORD_TOKEN_SECRET or SESSION_SECRET must be configured');
  }
  return createHmac('sha256', secret).update(token).digest('hex');
}export { crearHashTokenRestablimentContrasenya };

function validarCorreuElectronic(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}export { validarCorreuElectronic };

function codificarBase64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function decodificarBase64Url(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function signarCarregaToken(payload) {
  return createHmac('sha256', process.env.SESSION_SECRET).update(payload).digest('base64url');
}

function crearTokenAutenticacio(user) {
  if (!process.env.SESSION_SECRET) return null;

  const payload = codificarBase64Url(JSON.stringify({
    user,
    exp: Date.now() + 30 * 24 * 60 * 60 * 1000
  }));
  const signature = signarCarregaToken(payload);
  return `${payload}.${signature}`;
}export { crearTokenAutenticacio };

function verificarTokenAutenticacio(token) {
  if (!process.env.SESSION_SECRET || !token || !token.includes('.')) return null;

  const [payload, signature] = token.split('.');
  const expectedSignature = signarCarregaToken(payload);
  if (signature !== expectedSignature) return null;

  try {
    const data = JSON.parse(decodificarBase64Url(payload));
    if (!data.exp || Date.now() > data.exp || !data.user) return null;
    return data.user;
  } catch {
    return null;
  }
}export { verificarTokenAutenticacio };

function obtenirTokenBearer(req) {
  const authHeader = req.headers.authorization || '';
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
}export { obtenirTokenBearer };

function obtenirIdUsuari(user) {
  return user?.id_usuari || user?.id_usuario || user?.id_user || user?.id || null;
}export { obtenirIdUsuari };

function obtenirUsuariTokenAutenticat(req) {
  return verificarTokenAutenticacio(obtenirTokenBearer(req));
}export { obtenirUsuariTokenAutenticat };

function esMateixUsuariAutenticat(sessionUser, tokenUser) {
  const sessionUserId = obtenirIdUsuari(sessionUser);
  const tokenUserId = obtenirIdUsuari(tokenUser);

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
}export { esMateixUsuariAutenticat };