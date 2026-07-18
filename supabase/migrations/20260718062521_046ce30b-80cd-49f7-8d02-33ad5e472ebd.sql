
-- 1. Add platform_admin enum value
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'platform_admin';
