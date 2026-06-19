// Single shared Supabase client. Extracted so non-`main.jsx` modules
// (InsightsView, TelegramSettings, future views) can import it without
// needing to receive `sb` as a prop everywhere.
//
// Auth storage adapter behaviour (remember-me vs session-only) stays
// identical to how main.jsx originally created the client.
import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL  = 'https://pxenybeudcsddsnkduaj.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB4ZW55YmV1ZGNzZGRzbmtkdWFqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4NjM1NjMsImV4cCI6MjA5NzQzOTU2M30.llZzz-FYENFgf5ew32S9k5ysTrG5HGAfDb8nW-r0mrg';

const REMEMBER_KEY = 'pos.remember';
const isRemember = () => localStorage.getItem(REMEMBER_KEY) !== 'false';

const authStorage = {
  getItem: (k) => localStorage.getItem(k) ?? sessionStorage.getItem(k),
  setItem: (k, v) => {
    if (isRemember()) { localStorage.setItem(k, v); sessionStorage.removeItem(k); }
    else              { sessionStorage.setItem(k, v); localStorage.removeItem(k); }
  },
  removeItem: (k) => { localStorage.removeItem(k); sessionStorage.removeItem(k); },
};

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: { persistSession: true, autoRefreshToken: true, storage: authStorage },
});

// Also exposed on window for the SW-aware offline queue drainer.
if (typeof window !== 'undefined') window._sb = sb;
