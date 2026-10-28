/* =========================================================
   Configuración de Supabase
   ---------------------------------------------------------
   Supabase → Project Settings → API (o "Data API" / "API Keys"):
     - supabaseUrl:     Project URL  (https://xxxx.supabase.co)
     - supabaseAnonKey: la clave "anon public" o "publishable"

   Estas claves SON públicas por diseño: lo que protege tus
   datos es el Row Level Security de supabase/schema.sql.
   NUNCA pongas aquí la clave "service_role" ni la "secret".
   ========================================================= */
window.BODEGA_CONFIG = {
  supabaseUrl: 'https://ffpcpxhvbadjdpugveie.supabase.co/rest/v1/',
  supabaseAnonKey: 'sb_publishable_l4_os06O3TkCG6FT6QfBbw_f5hDWqvU'
};
