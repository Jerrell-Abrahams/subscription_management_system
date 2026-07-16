import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';
