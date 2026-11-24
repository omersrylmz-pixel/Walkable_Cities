-- Faz 4: panelde salt okunur "viewer" rolü.
-- Supabase Auth kullanıcıları app_user tablosuna eşlenirken bu rol kullanılır.

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'viewer';
