import supabase from './../config/db.js';

export async function registerUser({ id_usuari, nom, email, contrasenya }) {
    let result = await supabase.from('usuari').select('nom').eq('nom', nom).maybeSingle();

    if (result.error) {
        console.error('Error checking username uniqueness:', result.error);
        return { data: null, error: result.error };
    }
    if (result.data) {
        const message = 'Ese nombre de usuario ya está registrado.';
        console.log(message, nom);
        return { data: null, error: new Error(message) };
    }

    result = await supabase.from('usuari').select('email').eq('email', email).maybeSingle();

    if (result.error) {
        console.error('Error checking email uniqueness:', result.error);
        return { data: null, error: result.error };
    }
    if (result.data) {
        const message = 'Ese email ya está registrado.';
        console.log(message, email);
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
            img_url: null
        }
    ]);

    if (error) {
        console.error('Error registrando el usuario:', error);
    }

    return { data, error };
}

export async function findUserByNom(nom) {
    return await supabase
        .from('usuari')
        .select('id_usuari, nom, email, contrasenya, id_anime_preferit, id_anime_recomanat, img_url')
        .eq('nom', nom)
        .maybeSingle();
}

export async function findUserByEmail(email) {
    return await supabase
        .from('usuari')
        .select('id_usuari, nom, email, contrasenya, id_anime_preferit, id_anime_recomanat, img_url')
        .eq('email', email)
        .maybeSingle();
}

export async function updateUserProfilePicture(id_usuari, img_url) {
    return await supabase
        .from('usuari')
        .update({ img_url })
        .eq('id_usuari', id_usuari)
        .select()
        .maybeSingle();
}

export async function updateUserAnimeChoice(id_usuari, field, id_anime) {
    return await supabase
        .from('usuari')
        .update({ [field]: id_anime })
        .eq('id_usuari', id_usuari)
        .select()
        .maybeSingle();
}

export async function updateUsername(id_usuari, newUsername) {
    let result = await supabase.from('usuari').select('nom').eq('nom', newUsername).maybeSingle();
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
}

export async function updateUserEmail(id_usuari, newEmail) {
    return await supabase.from('usuari').update({ email: newEmail }).eq('id_usuari', id_usuari).select().maybeSingle();
}

export async function updateUserPassword(id_usuari, newPassword) {
    return await supabase.from('usuari').update({ contrasenya: newPassword }).eq('id_usuari', id_usuari).select().maybeSingle();
}

export async function updateResetPasswordToken(email, token) {
    // Token expira en 15 minutos
    const expirationDate = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    return await supabase.from('usuari').update({
        reset_password_token: token,
        reset_password_token_expiredate: expirationDate
    }).eq('email', email).select().maybeSingle();
}

export async function findUserByResetToken(token) {
    return await supabase
        .from('usuari')
        .select('id_usuari, nom, email, reset_password_token, reset_password_token_expiredate')
        .eq('reset_password_token', token)
        .maybeSingle();
}

export async function clearResetPasswordToken(id_usuari) {
    return await supabase.from('usuari').update({
        reset_password_token: null,
        reset_password_token_expiredate: null
    }).eq('id_usuari', id_usuari).select().maybeSingle();
}