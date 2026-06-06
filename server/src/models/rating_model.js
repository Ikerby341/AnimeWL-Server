import supabase from '../config/db.js';

async function trobarResumValoracionsPerIdAnime(id_anime) {
  if (!id_anime) {
    return { average: 0, count: 0 };
  }

  const { data, error } = await supabase.
  from('valoracio').
  select('puntuacio').
  eq('id_anime', id_anime);

  if (error) {
    console.error('findRatingSummaryByAnimeId error', error);
    throw error;
  }

  const count = (data || []).length;
  const sum = (data || []).reduce((acc, item) => acc + (item.puntuacio || 0), 0);
  return {
    average: count > 0 ? +(sum / count).toFixed(1) : 0,
    count
  };
}export { trobarResumValoracionsPerIdAnime };

async function trobarValoracioPerAnimeIUsuari(id_anime, id_usuari) {
  if (!id_anime || !id_usuari) return null;

  const { data, error } = await supabase.
  from('valoracio').
  select('id_valoracio, id_usuari, id_anime, puntuacio, id_capitol, data').
  eq('id_anime', id_anime).
  eq('id_usuari', id_usuari).
  maybeSingle();

  if (error) {
    console.error('findRatingByAnimeAndUser error', error);
    throw error;
  }

  return data || null;
}export { trobarValoracioPerAnimeIUsuari };

async function desarValoracio(rating) {
  const { id_usuari, id_anime, id_capitol = null, puntuacio, data } = rating;
  if (!id_usuari || !id_anime || !puntuacio) {
    throw new Error('Faltan datos de valoración');
  }

  const existing = await supabase.
  from('valoracio').
  select('id_valoracio').
  eq('id_usuari', id_usuari).
  eq('id_anime', id_anime).
  maybeSingle();

  if (existing.error) {
    console.error('saveRating existing lookup error', existing.error);
    throw existing.error;
  }

  if (existing.data) {
    const { data: updated, error } = await supabase.
    from('valoracio').
    update({ puntuacio, id_capitol, data: data || new Date().toISOString().split('T')[0] }).
    eq('id_valoracio', existing.data.id_valoracio).
    select().
    maybeSingle();

    if (error) {
      console.error('saveRating update error', error);
      throw error;
    }

    return updated;
  }

  const id_valoracio = rating.id_valoracio;
  const { data: inserted, error } = await supabase.
  from('valoracio').
  insert({
    id_valoracio,
    id_usuari,
    id_anime,
    id_capitol,
    puntuacio,
    data: data || new Date().toISOString().split('T')[0]
  }).
  select().
  maybeSingle();

  if (error) {
    console.error('saveRating insert error', error);
    throw error;
  }

  return inserted;
}export { desarValoracio };