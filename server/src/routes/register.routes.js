import { Router } from 'express';
import { randomUUID } from 'crypto';
import { registrarUsuari } from '../models/users_model.js';
import { crearHashContrasenya, validarCorreuElectronic } from '../utils/auth.js';

function crearRouterRegistre() {
  const router = Router();

  /**
   * POST /api/register
   * Registra un nou usuari
   */
  router.post('/api/register', async (req, res) => {
    const { nom, email, contrasenya } = req.body;

    if (!nom || !email || !contrasenya) {
      return res.status(400).json({ success: false, error: 'Faltan datos de registro.' });
    }
    if (!validarCorreuElectronic(email)) {
      return res.status(400).json({ success: false, error: 'El email no es válido.' });
    }
    if (contrasenya.length < 6) {
      return res.status(400).json({ success: false, error: 'La contraseña debe tener al menos 6 caracteres.' });
    }

    const hashedPassword = crearHashContrasenya(contrasenya);
    const id_usuari = randomUUID();

    const { data, error } = await registrarUsuari({ id_usuari, nom, email, contrasenya: hashedPassword });

    if (error) {
      console.error('Supabase insert error:', error.message || error);
      const message = error.message || 'Error al registrar el usuario.';
      const status = message.includes('duplicate') || message.includes('unique') ? 409 : 500;
      return res.status(status).json({ success: false, error: message });
    }

    return res.status(201).json({ success: true, user: { id_usuari, nom, email } });
  });

  return router;
}

export { crearRouterRegistre };
