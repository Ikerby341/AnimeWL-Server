# Servidor d'AnimeWL

Aquest repositori conté el backend d'AnimeWL. És una API feta amb Node.js i Express que guarda les dades a Supabase, sincronitza informació d'anime des de Jikan, gestiona usuaris, sessions, favorits, comentaris, valoracions, progrés de visualització, estadístiques i recuperació de contrasenya per correu.

## Tecnologies principals

- Express 5 per definir l'API HTTP.
- Supabase com a base de dades.
- Jikan API com a font externa de metadades d'anime.
- `cookie-session` i tokens signats per mantenir la sessió.
- `crypto` per generar UUIDs, tokens i hashes de contrasenya amb salt.
- Nodemailer o un relay HTTP per enviar correus.
- Axios per consumir APIs externes.
- Node Test Runner per proves.
- Vercel per desplegament serverless opcional.

## Com executar el servidor

1. Entra a la carpeta del servidor:

```bash
cd server
```

2. Instal·la dependències:

```bash
npm install
```

3. Crea un fitxer `.env` amb les variables necessàries:

```env
PORT=3000
SESSION_SECRET=una_clau_llarga_i_secreta
SUPABASE_URL=https://el-teu-projecte.supabase.co
SUPABASE_KEY=la_teva_clau_de_supabase
EMAIL_FROM=no-reply@animewl.cat
EMAIL_SMTP_HOST=smtp.exemple.com
EMAIL_SMTP_PORT=587
EMAIL_SMTP_USER=usuari
EMAIL_SMTP_PASS=contrasenya
EMAIL_SMTP_SECURE=false
```

També es pot configurar l'enviament de correu amb `EMAIL_RELAY_URL` i `EMAIL_RELAY_SECRET` en lloc de SMTP directe.

4. Arrenca l'API:

```bash
npm run dev
```

El script executa primer les proves i després inicia `src/server.js`.

## Scripts disponibles

- `npm run dev`: executa les proves i arrenca el servidor.
- `npm run start`: fa el mateix que `dev`, pensat per entorns de producció.
- `npm run test`: llança les proves amb `node --test`.

## Estructura general

- `server/src/server.js`: arrenca el servidor HTTP.
- `server/src/app.js`: configura Express, CORS, sessions, autenticació, fitxers estàtics i rutes de l'API.
- `server/src/config/db.js`: carrega `.env`, crea el client de Supabase i valida que existeixin `SUPABASE_URL` i `SUPABASE_KEY`.
- `server/src/controllers/syncAnime.js`: sincronitza animes, gèneres i capítols des de Jikan cap a Supabase, amb control de rate limit i reintents.
- `server/src/models`: capa d'accés a dades de Supabase.
- `server/vercel.json`: configura el desplegament de `src/server.js` com a funció de Vercel.
- `server/package.json` i `server/package-lock.json`: dependències, scripts i versions bloquejades.

## Models de dades

- `anime_model.js`: cerca, llista i actualitza animes; llista gèneres; llista animes en emissió; insereix o actualitza gèneres; desa capítols i calcula capítols emmagatzemats o pendents.
- `users_model.js`: registra usuaris, cerca per nom o email, actualitza foto, nom, email, contrasenya, anime preferit/recomanat i tokens de recuperació.
- `favorites_model.js`: llegeix, afegeix, elimina i actualitza favorits i exposa favorits públics.
- `comment_model.js`: llegeix, crea i elimina comentaris d'anime.
- `rating_model.js`: desa puntuacions i calcula resum de valoracions per anime.
- `progress_model.js`: desa progrés de capítols vistos, calcula minuts vistos i estadístiques d'usuari.
- `progress_stats.js`: helpers purs per sumar minuts, capítols i animes acabats.
- `progress_stats.test.js`: proves unitàries de les funcions d'estadístiques.

## Controladors i sincronització

`syncAnime.js` és l'encarregat d'omplir i actualitzar la base de dades d'anime:

- `mapJikanToDb`: transforma una resposta de Jikan al format de la base de dades.
- `syncAnimeMetadataById`: desa només metadades i gèneres d'un anime concret.
- `syncAnimeById`: desa metadades i sincronitza capítols nous o pendents.
- `syncAllAnime`: recorre pàgines de Jikan i sincronitza molts animes de forma controlada.

El codi limita les peticions a Jikan, reintenta quan rep `429`, evita peticions innecessàries i només afegeix capítols que falten.

## API principal

### Salut i catàleg

- `GET /health`: retorna l'estat bàsic del servidor.
- `GET /api/anime`: llista animes amb paginació opcional i filtre de gènere.
- `GET /api/genres`: retorna els gèneres disponibles.
- `GET /api/anime/recent/:limit`: retorna animes recents.
- `GET /api/anime/airing/:limit`: retorna animes que estan en emissió.
- `GET /api/anime/genre/:genreId`: retorna animes d'un gènere.
- `GET /api/anime/genre/:genreId/:limit`: retorna animes d'un gènere amb límit.
- `GET /api/anime/:id`: retorna un anime; si existeix a la base de dades respon ràpid i sincronitza en segon pla.
- `POST /api/anime/sync/:id`: força la sincronització d'un anime.
- `GET /api/jikan/search?q=`: cerca a Jikan i fa fallback a la base de dades local.

### Comentaris, valoracions i progrés

- `GET /api/anime/:id/comments`: llista comentaris d'un anime.
- `POST /api/anime/:id/comments`: crea un comentari autenticat amb longitud màxima de 255 caràcters.
- `DELETE /api/anime/:id/comments/:commentId` i `DELETE /api/comments/:commentId`: eliminen comentaris.
- `GET /api/anime/:id/rating`: retorna mitjana, nombre de vots i vot de l'usuari si hi ha sessió.
- `POST /api/anime/:id/rating`: desa o actualitza la puntuació de l'usuari.
- `GET /api/anime/:id/progress`: consulta el progrés de l'usuari en un anime.
- `POST /api/anime/:id/progress`: desa capítols vistos i estat de progrés.
- `GET /api/user/stats`: retorna estadístiques personals agregades.

### Favorits i perfils públics

- `GET /api/user/favorites`: retorna favorits de l'usuari autenticat.
- `POST /api/user/favorites/:id_anime`: afegeix un anime a favorits.
- `DELETE /api/user/favorites/:id_anime`: elimina un anime de favorits.
- `PUT /api/user/favorites/:id_anime`: actualitza l'estat d'un favorit.
- `GET /api/user/:userId/favorites`: retorna favorits públics d'un usuari.
- Les rutes públiques de perfil retornen informació pública de l'usuari sense exposar dades sensibles.

### Usuaris, sessió i configuració

- `POST /api/register`: registra un usuari amb contrasenya hashejada.
- `POST /api/login`: valida usuari i contrasenya, crea sessió i retorna dades d'usuari.
- `GET /api/session`: retorna la sessió actual o `user: null`.
- `GET /api/check-session`: comprova i refresca dades de sessió des de Supabase.
- `POST /api/logout`: tanca la sessió.
- `POST /api/settings/update-username`: canvia el nom d'usuari amb sessió activa i token d'autorització.
- `POST /api/user/anime`: desa anime preferit o recomanat al perfil.
- `POST /api/update-profile-picture`: actualitza la foto de perfil.
- `POST /api/user/update-password`: canvia la contrasenya amb validació de la contrasenya actual.
- `POST /api/user/send-email-code`: envia un codi per confirmar canvi d'email.
- `POST /api/user/update-email`: valida el codi i actualitza l'email.
- `GET /api/admin/users`: llista usuaris per a administradors.
- `PATCH /api/admin/users/:userId`: permet a un administrador canviar el rol i el nom d'usuari, enviant un correu informatiu si el nom canvia.

### Recuperació de contrasenya

- `POST /api/forgot-password`: genera un token, en desa només el hash i envia un correu de recuperació sense revelar si l'email existeix.
- `GET /api/verify-reset-token`: valida el hash del token i comprova que no ha caducat.
- `POST /api/reset-password`: desa la nova contrasenya i neteja el token.

## Seguretat i sessions

El servidor combina cookies de sessió amb tokens signats. Les contrasenyes es guarden amb `scryptSync`, salt únic i format `salt:hash`. Les cookies són `httpOnly`, tenen una durada de 30 dies i canvien `sameSite`/`secure` segons si l'entorn és producció.

CORS permet el domini de producció `https://animewl.cat` i el client local `http://localhost:5173`.

## Desplegament

`server/vercel.json` indica a Vercel que totes les rutes han d'anar a `src/server.js`. En producció cal definir les variables d'entorn de Supabase, sessió i correu al panell del proveïdor.

## Proves

Les proves actuals cobreixen helpers de càlcul de progrés i estadístiques. Es poden executar amb:

```bash
npm run test
```
