import { EventEmitter } from 'events';
import supabase from './db.js';

/**
 * Session Store para express-session usando Supabase
 * Implementación minimalista que evita conflictos con wrapmethods
 */
class SupabaseSessionStore extends EventEmitter {
    constructor(options = {}) {
        super();
        this.tableName = options.tableName || 'sessions';
    }

    createSession(req, session) {
        return session;
    }

    /**
     * Obtiene una sesión por ID
     * Retorna el objeto sesión sin incluir cookie para evitar problemas con wrapmethods
     */
    get(sid, callback) {
        supabase
            .from(this.tableName)
            .select('sess')
            .eq('sid', sid)
            .gt('expire', new Date().toISOString())
            .single()
            .then(({ data, error }) => {
                if (error || !data) {
                    return callback(null);
                }

                try {
                    const sess = JSON.parse(data.sess);
                    // Extraer solo los datos del usuario, no el cookie completo
                    // Express-session recreará el cookie desde su configuración
                    const result = {
                        user: sess.user || null
                    };

                    // Copiar otras propiedades guardadas
                    if (sess.emailChange) result.emailChange = sess.emailChange;

                    console.log('[Session Store] Retrieved user:', result.user?.nom);
                    callback(null, result);
                } catch (err) {
                    console.error('[Session Store] Parse error:', err.message);
                    callback(null);
                }
            })
            .catch((err) => {
                console.error('[Session Store] GET error:', err.message);
                callback(null);
            });
    }

    /**
     * Guarda una sesión
     */
    set(sid, session, callback) {
        if (!callback) callback = () => { };

        try {
            const expire = new Date(Date.now() + (session.cookie?.maxAge || 30 * 24 * 60 * 60 * 1000)).toISOString();

            // Guardar solo datos, no el cookie
            const sessionData = {
                user: session.user || null
            };

            // Guardar propiedades adicionales
            if (session.emailChange) sessionData.emailChange = session.emailChange;

            supabase
                .from(this.tableName)
                .upsert([{ sid, sess: JSON.stringify(sessionData), expire }], { onConflict: 'sid' })
                .then(({ error }) => {
                    if (error) {
                        console.error('[Session Store] SET error:', error.message);
                        callback(error);
                    } else {
                        console.log('[Session Store] Saved user:', sessionData.user?.nom);
                        callback(null);
                    }
                })
                .catch((err) => {
                    console.error('[Session Store] SET error:', err.message);
                    callback(err);
                });
        } catch (err) {
            console.error('[Session Store] SET error:', err.message);
            callback(err);
        }
    }

    /**
     * Destruye una sesión
     */
    destroy(sid, callback) {
        if (!callback) callback = () => { };

        supabase
            .from(this.tableName)
            .delete()
            .eq('sid', sid)
            .then(({ error }) => {
                if (error) {
                    console.error('[Session Store] DESTROY error:', error.message);
                    callback(error);
                } else {
                    console.log('[Session Store] Destroyed session:', sid);
                    callback(null);
                }
            })
            .catch((err) => {
                console.error('[Session Store] DESTROY error:', err.message);
                callback(err);
            });
    }

    /**
     * Limpia sesiones expiradas
     */
    clear(callback) {
        if (!callback) callback = () => { };

        supabase
            .from(this.tableName)
            .delete()
            .lt('expire', new Date().toISOString())
            .then(({ error }) => {
                if (error) {
                    console.error('[Session Store] CLEAR error:', error.message);
                    callback(error);
                } else {
                    console.log('[Session Store] Cleaned expired sessions');
                    callback(null);
                }
            })
            .catch((err) => {
                console.error('[Session Store] CLEAR error:', err.message);
                callback(err);
            });
    }

    static startCleanupInterval(store, intervalHours = 1) {
        setInterval(() => {
            store.clear();
        }, intervalHours * 60 * 60 * 1000);
    }
}

export default SupabaseSessionStore;
