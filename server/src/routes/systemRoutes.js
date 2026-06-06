import { Router } from 'express';

function crearRouterSistema() {
  const router = Router();

  router.get('/health', (req, res) => {
    res.json({ success: true });
  });

  return router;
}export { crearRouterSistema };