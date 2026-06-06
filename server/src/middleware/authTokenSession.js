import { crearTokenAutenticacio, verificarTokenAutenticacio } from '../utils/auth.js';

function sessioTokenAutenticacio(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const tokenUser = verificarTokenAutenticacio(token);

  if (tokenUser && !req.session.user) {
    req.session.user = tokenUser;
  }

  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (body && typeof body === 'object' && req.session?.user && !body.token) {
      const refreshedToken = crearTokenAutenticacio(req.session.user);
      if (refreshedToken) {
        body.token = refreshedToken;
      }
    }

    return originalJson(body);
  };

  next();
}export { sessioTokenAutenticacio };