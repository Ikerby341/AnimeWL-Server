import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import cookieSession from 'cookie-session';
import { sessioTokenAutenticacio } from './middleware/authTokenSession.js';
import { crearRouterAnimedle } from './routes/animedleRoutes.js';
import { crearRouterAnime } from './routes/animeRoutes.js';
import { crearRouterSistema } from './routes/systemRoutes.js';
import { crearRouterUsuaris } from './routes/userRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isProduction = process.env.NODE_ENV === 'production' || Boolean(process.env.RENDER);

function crearAplicacio() {
  const app = express();

  app.use(express.json());
  app.set('trust proxy', 1);

  app.use(cors({
    origin: [
    'https://animewl.cat',
    'http://localhost:5173'],

    credentials: true
  }));

  app.use(cookieSession({
    name: 'session',
    keys: [process.env.SESSION_SECRET],
    maxAge: 30 * 24 * 60 * 60 * 1000,
    secure: isProduction,
    httpOnly: true,
    sameSite: isProduction ? 'none' : 'lax'
  }));

  app.use(sessioTokenAutenticacio);

  app.use(express.static(path.join(__dirname, '../public')));
  app.set('views', path.join(__dirname, '../plantilles'));
  app.set('view engine', 'ejs');

  app.use(crearRouterSistema());
  app.use(crearRouterAnimedle());
  app.use(crearRouterAnime());
  app.use(crearRouterUsuaris());

  return app;
}export { crearAplicacio };