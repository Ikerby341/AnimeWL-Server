import { Router } from 'express';
import { crearRouterAutenticacio } from './auth.routes.js';
import { crearRouterRegistre } from './register.routes.js';
import { crearRouterRecuperacioContrasenya } from './passwordRecovery.routes.js';
import { crearRouterConfiguracio } from './userSettings.routes.js';
import { crearRouterFavorits } from './favorites.routes.js';
import { crearRouterAdmin } from './admin.routes.js';
import { crearRouterEstatistiquesIPerfil } from './stats.routes.js';

function crearRouterUsuaris() {
  const mainRouter = Router();

  const authRouter = crearRouterAutenticacio();
  const registerRouter = crearRouterRegistre();
  const passwordRecoveryRouter = crearRouterRecuperacioContrasenya();
  const settingsRouter = crearRouterConfiguracio();
  const favoritesRouter = crearRouterFavorits();
  const adminRouter = crearRouterAdmin();
  const statsRouter = crearRouterEstatistiquesIPerfil();

  mainRouter.use(authRouter);
  mainRouter.use(registerRouter);
  mainRouter.use(passwordRecoveryRouter);
  mainRouter.use(settingsRouter);
  mainRouter.use(favoritesRouter);
  mainRouter.use(adminRouter);
  mainRouter.use(statsRouter);

  return mainRouter;
}

export { crearRouterUsuaris };