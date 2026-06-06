import { randomUUID } from 'crypto';
import supabase from '../config/db.js';
import { trobarAnimePerId } from './anime_model.js';

export const ANIMEDLE_MAX_ATTEMPTS = 5;

const MADRID_TIME_ZONE = 'Europe/Madrid';
const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: MADRID_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23'
});

function formatarDataUtc(date) {
  return date.toISOString().slice(0, 10);
}

function afegirDies(dateText, days) {
  const [year, month, day] = dateText.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return formatarDataUtc(date);
}

function obtenirDataActivaAnimedle(now = new Date()) {
  const parts = Object.fromEntries(
    dateFormatter.formatToParts(now).map((part) => [part.type, part.value])
  );
  const localDate = `${parts.year}-${parts.month}-${parts.day}`;
  const localHour = Number(parts.hour);

  return localHour >= 22 ? localDate : afegirDies(localDate, -1);
}export { obtenirDataActivaAnimedle };

function normalitzarTitol(title) {
  return String(title || '').
  normalize('NFD').
  replace(/[\u0300-\u036f]/g, '').
  replace(/[^\p{L}\p{N}]+/gu, ' ').
  trim().
  toLowerCase();
}

async function trobarReptePerData(challengeDate) {
  const { data, error } = await supabase.
  from('animedle').
  select('*').
  eq('data_repte', challengeDate).
  is('id_usuari', null).
  maybeSingle();

  if (error) throw error;
  return data;
}

async function trobarRepteAnterior(challengeDate) {
  const { data, error } = await supabase.
  from('animedle').
  select('*').
  lt('data_repte', challengeDate).
  is('id_usuari', null).
  order('data_repte', { ascending: false }).
  limit(1).
  maybeSingle();

  if (error) throw error;
  return data;
}

async function trobarIdsAnimeDeReptesRecents(challengeDate, limit = 7) {
  const { data, error } = await supabase.
  from('animedle').
  select('id_anime').
  lt('data_repte', challengeDate).
  is('id_usuari', null).
  order('data_repte', { ascending: false }).
  limit(limit);

  if (error) throw error;
  return (data || []).map((challenge) => String(challenge.id_anime));
}

async function triarAnimeAleatori(excludedAnimeIds = []) {
  const excludedIds = new Set(excludedAnimeIds.map((id) => String(id)));
  const { data, error } = await supabase.
  from('anime').
  select('id_anime');

  if (error) throw error;

  const eligibleAnime = (data || []).filter((anime) => !excludedIds.has(String(anime.id_anime)));

  if (!eligibleAnime.length) {
    throw new Error('No hay animes disponibles fuera de los últimos 7 retos de Animedle.');
  }

  const index = Math.floor(Math.random() * eligibleAnime.length);
  return eligibleAnime[index].id_anime;
}

async function trobarAnimePerTitolExacte(title) {
  const { data, error } = await supabase.
  from('anime').
  select('id_anime, titol').
  eq('titol', title).
  maybeSingle();

  if (error) throw error;
  return data;
}

async function assegurarRepteDiariAnimedle() {
  const challengeDate = obtenirDataActivaAnimedle();
  const existing = await trobarReptePerData(challengeDate);
  if (existing) return existing;

  const recentAnimeIds = await trobarIdsAnimeDeReptesRecents(challengeDate, 7);
  const animeId = await triarAnimeAleatori(recentAnimeIds);
  const record = {
    id_animedle: randomUUID(),
    data_repte: challengeDate,
    id_usuari: null,
    id_anime: animeId,
    intents: 0,
    guesses: [],
    guanyat: false,
    finalitzat: false,
    generated_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase.
  from('animedle').
  insert(record).
  select().
  maybeSingle();

  if (error?.code === '23505') {
    return trobarReptePerData(challengeDate);
  }
  if (error) throw error;
  return data;
}export { assegurarRepteDiariAnimedle };

async function obtenirEstatAnimedle(userId) {
  const challenge = await assegurarRepteDiariAnimedle();
  const previousChallenge = await trobarRepteAnterior(challenge.data_repte);
  const [targetAnime, previousAnime, progress] = await Promise.all([
  trobarAnimePerId(challenge.id_anime),
  previousChallenge?.id_anime ? trobarAnimePerId(previousChallenge.id_anime) : null,
  obtenirOCrearProgresAnimedle(userId, challenge)]
  );

  return {
    challengeDate: challenge.data_repte,
    maxAttempts: ANIMEDLE_MAX_ATTEMPTS,
    attempts: progress.intents || 0,
    guesses: progress.guesses || [],
    won: Boolean(progress.guanyat),
    finished: Boolean(progress.finalitzat),
    blur: calcularDifuminat(progress.intents || 0, Boolean(progress.finalitzat)),
    imageUrl: targetAnime?.imatge_portada || '',
    answer: progress.finalitzat ? targetAnime?.titol || '' : null,
    previousAnswer: previousAnime?.titol || null
  };
}export { obtenirEstatAnimedle };

async function obtenirOCrearProgresAnimedle(userId, challenge) {
  const { data: existing, error: findError } = await supabase.
  from('animedle').
  select('*').
  eq('data_repte', challenge.data_repte).
  eq('id_usuari', userId).
  maybeSingle();

  if (findError) throw findError;
  if (existing) return existing;

  const record = {
    id_animedle: randomUUID(),
    data_repte: challenge.data_repte,
    id_usuari: userId,
    id_anime: challenge.id_anime,
    intents: 0,
    guesses: [],
    guanyat: false,
    finalitzat: false,
    generated_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase.
  from('animedle').
  insert(record).
  select().
  maybeSingle();

  if (error?.code === '23505') {
    return obtenirOCrearProgresAnimedle(userId, challenge);
  }
  if (error) throw error;
  return data;
}

function calcularDifuminat(attempts, finished) {
  if (finished) return 0;
  const remaining = Math.max(0, ANIMEDLE_MAX_ATTEMPTS - attempts);
  return remaining * 4;
}export { calcularDifuminat };

async function enviarIntentAnimedle(userId, guessTitle) {
  const challenge = await assegurarRepteDiariAnimedle();
  const progress = await obtenirOCrearProgresAnimedle(userId, challenge);
  const targetAnime = await trobarAnimePerId(challenge.id_anime);

  if (progress.finalitzat) {
    return obtenirEstatAnimedle(userId);
  }

  const title = String(guessTitle || '').trim();
  if (!title) {
    throw new Error('Introduce un anime antes de enviar.');
  }

  const guessedAnime = await trobarAnimePerTitolExacte(title);
  if (!guessedAnime) {
    throw new Error('Selecciona un anime de la lista de sugerencias.');
  }

  const guesses = Array.isArray(progress.guesses) ? progress.guesses : [];
  const nextAttempts = Math.min((progress.intents || 0) + 1, ANIMEDLE_MAX_ATTEMPTS);
  const isCorrect = String(guessedAnime.id_anime) === String(challenge.id_anime) ||
  normalitzarTitol(guessedAnime.titol) === normalitzarTitol(targetAnime?.titol);
  const isFinished = isCorrect || nextAttempts >= ANIMEDLE_MAX_ATTEMPTS;
  const nextGuesses = [...guesses, { title: guessedAnime.titol, correct: isCorrect }];

  const { error } = await supabase.
  from('animedle').
  update({
    intents: nextAttempts,
    guesses: nextGuesses,
    guanyat: isCorrect,
    finalitzat: isFinished,
    updated_at: new Date().toISOString()
  }).
  eq('id_animedle', progress.id_animedle);

  if (error) throw error;
  return obtenirEstatAnimedle(userId);
}export { enviarIntentAnimedle };

async function cercarSuggerimentsAnimedle(query, limit = 8) {
  const trimmedQuery = String(query || '').trim();
  if (!trimmedQuery) return [];

  const { data, error } = await supabase.
  from('anime').
  select('id_anime, titol').
  ilike('titol', `%${trimmedQuery}%`).
  order('titol', { ascending: true }).
  limit(limit);

  if (error) throw error;
  return (data || []).map((anime) => ({
    id_anime: anime.id_anime,
    titol: anime.titol
  }));
}export { cercarSuggerimentsAnimedle };