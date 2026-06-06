import supabase from './../config/db.js';

async function registrarUsuari({ id_usuari, nom, email, contrasenya }) {
  let result = await supabase.from('usuari').select('nom').eq('nom', nom).maybeSingle();

  if (result.error) {
    console.error('Error checking username uniqueness:', result.error);
    return { data: null, error: result.error };
  }
  if (result.data) {
    const message = 'Ese nombre de usuario ya está registrado.';
    return { data: null, error: new Error(message) };
  }

  result = await supabase.from('usuari').select('email').eq('email', email).maybeSingle();

  if (result.error) {
    console.error('Error checking email uniqueness:', result.error);
    return { data: null, error: result.error };
  }
  if (result.data) {
    const message = 'Ese email ya está registrado.';
    return { data: null, error: new Error(message) };
  }

  const { data, error } = await supabase.from('usuari').insert([
  {
    id_usuari,
    nom,
    email,
    contrasenya,
    id_anime_preferit: null,
    id_anime_recomanat: null,
    img_url: null,
    isAdmin: false
  }]
  );

  if (error) {
    console.error('Error registrando el usuario:', error);
  }

  return { data, error };
}export { registrarUsuari };

async function trobarUsuariPerNom(nom) {
  return await supabase.
  from('usuari').
  select('id_usuari, nom, email, contrasenya, id_anime_preferit, id_anime_recomanat, img_url, isAdmin').
  eq('nom', nom).
  maybeSingle();
}export { trobarUsuariPerNom };

async function trobarUsuariPerCorreu(email) {
  return await supabase.
  from('usuari').
  select('id_usuari, nom, email, contrasenya, id_anime_preferit, id_anime_recomanat, img_url, isAdmin').
  eq('email', email).
  maybeSingle();
}export { trobarUsuariPerCorreu };

async function trobarUsuariPerId(id_usuari) {
  return await supabase.
  from('usuari').
  select('id_usuari, nom, email, contrasenya, id_anime_preferit, id_anime_recomanat, img_url, isAdmin').
  eq('id_usuari', id_usuari).
  maybeSingle();
}export { trobarUsuariPerId };

async function llistarUsuarisAdmin() {
  return await supabase.
  from('usuari').
  select('id_usuari, nom, email, isAdmin').
  order('nom', { ascending: true });
}export { llistarUsuarisAdmin };

async function actualitzarFotoPerfilUsuari(id_usuari, img_url) {
  return await supabase.
  from('usuari').
  update({ img_url }).
  eq('id_usuari', id_usuari).
  select().
  maybeSingle();
}export { actualitzarFotoPerfilUsuari };

async function actualitzarAnimeUsuari(id_usuari, field, id_anime) {
  return await supabase.
  from('usuari').
  update({ [field]: id_anime }).
  eq('id_usuari', id_usuari).
  select().
  maybeSingle();
}export { actualitzarAnimeUsuari };

async function actualitzarNomUsuari(id_usuari, newUsername) {
  const currentUser = await supabase.
  from('usuari').
  select('id_usuari').
  eq('id_usuari', id_usuari).
  maybeSingle();

  if (currentUser.error) {
    console.error('Error checking current user:', currentUser.error);
    return { data: null, error: currentUser.error };
  }
  if (!currentUser.data) {
    return { data: null, error: new Error('Usuario actual no encontrado.') };
  }

  let result = await supabase.
  from('usuari').
  select('id_usuari, nom').
  eq('nom', newUsername).
  neq('id_usuari', id_usuari).
  maybeSingle();

  if (result.error) {
    console.error('Error checking username uniqueness:', result.error);
    return { data: null, error: result.error };
  } else if (result.data) {
    const message = 'Ese nombre de usuario ya está registrado.';
    return { data: null, error: new Error(message) };
  }
  const { data, error } = await supabase.from('usuari').update({ nom: newUsername }).eq('id_usuari', id_usuari).select().maybeSingle();
  if (error) {
    console.error('Error updating username:', error);
    return { data: null, error: error };
  }
  return { data, error };
}export { actualitzarNomUsuari };

async function actualitzarRolAdminUsuari(id_usuari, isAdmin) {
  return await supabase.
  from('usuari').
  update({ isAdmin }).
  eq('id_usuari', id_usuari).
  select('id_usuari, nom, email, id_anime_preferit, id_anime_recomanat, img_url, isAdmin').
  maybeSingle();
}export { actualitzarRolAdminUsuari };

async function actualitzarCorreuUsuari(id_usuari, newEmail) {
  return await supabase.from('usuari').update({ email: newEmail }).eq('id_usuari', id_usuari).select().maybeSingle();
}export { actualitzarCorreuUsuari };

async function actualitzarContrasenyaUsuari(id_usuari, newPassword) {
  return await supabase.from('usuari').update({ contrasenya: newPassword }).eq('id_usuari', id_usuari).select().maybeSingle();
}export { actualitzarContrasenyaUsuari };

async function actualitzarTokenRestablimentContrasenya(email, tokenHash) {
  // Token expira en 15 minutos
  const expirationDate = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  return await supabase.from('usuari').update({
    reset_password_token: tokenHash,
    reset_password_token_expiredate: expirationDate
  }).eq('email', email).select().maybeSingle();
}export { actualitzarTokenRestablimentContrasenya };

async function trobarUsuariPerTokenRestabliment(tokenHash) {
  return await supabase.
  from('usuari').
  select('id_usuari, nom, email, reset_password_token, reset_password_token_expiredate').
  eq('reset_password_token', tokenHash).
  maybeSingle();
}export { trobarUsuariPerTokenRestabliment };

async function netejarTokenRestablimentContrasenya(id_usuari) {
  return await supabase.from('usuari').update({
    reset_password_token: null,
    reset_password_token_expiredate: null
  }).eq('id_usuari', id_usuari).select().maybeSingle();
}export { netejarTokenRestablimentContrasenya };

async function trobarUsuariPublicPerId(id_usuari) {
  return await supabase.
  from('usuari').
  select('id_usuari, nom, img_url, id_anime_preferit, id_anime_recomanat').
  eq('id_usuari', id_usuari).
  maybeSingle();
}export { trobarUsuariPublicPerId };