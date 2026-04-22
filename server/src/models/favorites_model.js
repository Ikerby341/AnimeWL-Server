import { randomUUID } from 'crypto';
import supabase from '../config/db.js';

export async function findFavoritesByUser(id_usuari) {
    if (!id_usuari) return [];

    const { data, error } = await supabase
        .from('llista')
        .select('id_llista, id_usuari, llista_anime(id_anime, estat)')
        .eq('id_usuari', id_usuari);

    if (error) {
        console.error('findFavoritesByUser error', error);
        throw error;
    }

    // Transformar la estructura y enriquecer con progreso
    const enrichedData = await Promise.all(
        (data || []).map(async (list) => {
            return Promise.all(
                (list.llista_anime || []).map(async (item) => {
                    try {
                        const { data: progress } = await supabase
                            .from('progres')
                            .select('capitols_vistos')
                            .eq('id_usuari', id_usuari)
                            .eq('id_anime', item.id_anime)
                            .maybeSingle();

                        return {
                            id_llista: list.id_llista,
                            id_usuari: list.id_usuari,
                            id_anime: item.id_anime,
                            estat: item.estat || 'Por ver',
                            capitols_vistos: progress?.capitols_vistos || 0
                        };
                    } catch (err) {
                        console.error('Error fetching progress for favorite:', err);
                        return {
                            id_llista: list.id_llista,
                            id_usuari: list.id_usuari,
                            id_anime: item.id_anime,
                            estat: item.estat || 'Por ver',
                            capitols_vistos: 0
                        };
                    }
                })
            );
        })
    );

    return enrichedData.flat();
}

export async function findFavoriteById(id_usuari, id_anime) {
    if (!id_usuari || !id_anime) return null;

    const { data, error } = await supabase
        .from('llista')
        .select('id_llista, id_usuari, llista_anime(id_anime)')
        .eq('id_usuari', id_usuari);

    if (error) {
        console.error('findFavoriteById error', error);
        throw error;
    }

    // Buscar si el anime está en la lista
    if (data && data.length > 0) {
        const list = data[0];
        const found = (list.llista_anime || []).find(item => String(item.id_anime) === String(id_anime));
        if (found) {
            return {
                id_llista: list.id_llista,
                id_usuari: list.id_usuari,
                id_anime: found.id_anime
            };
        }
    }

    return null;
}

export async function addFavorite(id_usuari, id_anime) {
    if (!id_usuari || !id_anime) {
        throw new Error('Faltan datos para agregar a favoritos');
    }

    // Verificar si ya existe
    const existing = await findFavoriteById(id_usuari, id_anime);
    if (existing) {
        return existing;
    }

    // Obtener o crear la lista del usuario
    let { data: listData, error: listError } = await supabase
        .from('llista')
        .select('id_llista')
        .eq('id_usuari', id_usuari)
        .maybeSingle();

    if (listError) {
        console.error('addFavorite list lookup error', listError);
        throw listError;
    }

    let id_llista = listData?.id_llista;

    // Si no existe lista, crearla
    if (!id_llista) {
        id_llista = randomUUID();
        const { error: createError } = await supabase
            .from('llista')
            .insert({
                id_llista,
                id_usuari,
                tipus: 'favoritos'
            });

        if (createError) {
            console.error('addFavorite create list error', createError);
            throw createError;
        }
    }

    // Agregar el anime a la lista
    const { data, error } = await supabase
        .from('llista_anime')
        .insert({
            id_llista,
            id_anime
        })
        .select()
        .maybeSingle();

    if (error) {
        console.error('addFavorite error', error);
        throw error;
    }

    return {
        id_llista,
        id_usuari,
        id_anime
    };
}

export async function removeFavorite(id_usuari, id_anime) {
    if (!id_usuari || !id_anime) {
        throw new Error('Faltan datos para eliminar de favoritos');
    }

    // Obtener el id_llista del usuario
    const { data: listData, error: listError } = await supabase
        .from('llista')
        .select('id_llista')
        .eq('id_usuari', id_usuari)
        .maybeSingle();

    if (listError) {
        console.error('removeFavorite list lookup error', listError);
        throw listError;
    }

    if (!listData) {
        throw new Error('Lista no encontrada');
    }

    const { data, error } = await supabase
        .from('llista_anime')
        .delete()
        .eq('id_llista', listData.id_llista)
        .eq('id_anime', id_anime)
        .select()
        .maybeSingle();

    if (error) {
        console.error('removeFavorite error', error);
        throw error;
    }

    return data;
}

export async function updateFavoriteStatus(id_usuari, id_anime, estat) {
    if (!id_usuari || !id_anime || !estat) {
        throw new Error('Faltan datos para actualizar el estado del favorito');
    }

    // Obtener el id_llista del usuario
    const { data: listData, error: listError } = await supabase
        .from('llista')
        .select('id_llista')
        .eq('id_usuari', id_usuari)
        .maybeSingle();

    if (listError) {
        console.error('updateFavoriteStatus list lookup error', listError);
        throw listError;
    }

    if (!listData) {
        throw new Error('Lista no encontrada');
    }

    const { data, error } = await supabase
        .from('llista_anime')
        .update({ estat })
        .eq('id_llista', listData.id_llista)
        .eq('id_anime', id_anime)
        .select()
        .maybeSingle();

    if (error) {
        console.error('updateFavoriteStatus error', error);
        throw error;
    }

    return data;
}
