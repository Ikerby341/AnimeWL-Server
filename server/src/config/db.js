import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// compute __dirname for this module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// load .env from server root regardless of current working directory
// __dirname is server/src/config, so go two levels up to reach server
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Supabase URL and KEY must be provided via environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

export default supabase;