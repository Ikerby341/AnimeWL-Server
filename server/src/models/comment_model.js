import supabase from '../config/db.js';

export async function findCommentsByAnimeId(id_anime) {
    if (!id_anime) return [];

    const { data, error } = await supabase
        .from('comentari')
        .select('id_comentari, id_usuari, id_anime, id_capitol, contingut, data_hora, usuari(nom, img_url)')
        .eq('id_anime', id_anime)
        .order('data_hora', { ascending: false });

    if (error) {
        console.error('findCommentsByAnimeId error', error);
        throw error;
    }

    return (data || []).map((comment) => ({
        id_comentari: comment.id_comentari,
        id_usuari: comment.id_usuari,
        id_anime: comment.id_anime,
        id_capitol: comment.id_capitol,
        contingut: comment.contingut,
        data_hora: comment.data_hora,
        userName: comment.usuari?.nom || 'Anónimo',
        userImg: comment.usuari?.img_url || null,
    }));
}

export async function insertComment(comment) {
    const { data, error } = await supabase
        .from('comentari')
        .insert(comment)
        .select('id_comentari, id_usuari, id_anime, id_capitol, contingut, data_hora, usuari(nom, img_url)')
        .single();

    if (error) {
        console.error('insertComment error', error);
        throw error;
    }

    return {
        id_comentari: data.id_comentari,
        id_usuari: data.id_usuari,
        id_anime: data.id_anime,
        id_capitol: data.id_capitol,
        contingut: data.contingut,
        data_hora: data.data_hora,
        userName: data.usuari?.nom || 'Anónimo',
        userImg: data.usuari?.img_url || null,
    };
}

export async function deleteCommentById(id_comentari, id_usuari, isAdmin = false) {
    let query = supabase
        .from('comentari')
        .delete()
        .eq('id_comentari', id_comentari);

    if (!isAdmin) {
        query = query.eq('id_usuari', id_usuari);
    }

    const { data, error } = await query
        .select('id_comentari')
        .maybeSingle();

    if (error) {
        console.error('deleteCommentById error', error);
        throw error;
    }

    return data;
}
