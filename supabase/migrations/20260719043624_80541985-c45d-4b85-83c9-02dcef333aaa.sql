
-- 1. Clients: drop national_id, add customer_type
ALTER TABLE public.clients DROP COLUMN IF EXISTS national_id;
DO $$ BEGIN
  CREATE TYPE public.customer_type AS ENUM ('field','office');
EXCEPTION WHEN duplicate_object THEN null; END $$;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS customer_type public.customer_type NOT NULL DEFAULT 'office';

-- 2. Profiles: add employee_type
DO $$ BEGIN
  CREATE TYPE public.employee_type AS ENUM ('field','office');
EXCEPTION WHEN duplicate_object THEN null; END $$;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS employee_type public.employee_type;

-- 3. Loans: add service_fee
ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS service_fee numeric NOT NULL DEFAULT 10000;

-- 4. Subscriptions
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  monthly_amount numeric NOT NULL DEFAULT 0,
  current_period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "subs read own or business" ON public.subscriptions;
CREATE POLICY "subs read own or business" ON public.subscriptions FOR SELECT TO authenticated
USING (
  admin_user_id = auth.uid()
  OR public.is_super_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.businesses b
    JOIN public.profiles p ON p.business_id = b.id
    WHERE p.id = auth.uid() AND b.created_by = admin_user_id
  )
);
DROP POLICY IF EXISTS "subs super manage" ON public.subscriptions;
CREATE POLICY "subs super manage" ON public.subscriptions FOR ALL TO authenticated
USING (public.is_super_admin(auth.uid()))
WITH CHECK (public.is_super_admin(auth.uid()));
DROP POLICY IF EXISTS "subs admin update own" ON public.subscriptions;
CREATE POLICY "subs admin update own" ON public.subscriptions FOR UPDATE TO authenticated
USING (admin_user_id = auth.uid()) WITH CHECK (admin_user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.subscription_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount numeric NOT NULL,
  months_granted numeric NOT NULL,
  paid_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subscription_payments TO authenticated;
GRANT ALL ON public.subscription_payments TO service_role;
ALTER TABLE public.subscription_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sp read own or super" ON public.subscription_payments;
CREATE POLICY "sp read own or super" ON public.subscription_payments FOR SELECT TO authenticated
USING (admin_user_id = auth.uid() OR public.is_super_admin(auth.uid()));
DROP POLICY IF EXISTS "sp insert own or super" ON public.subscription_payments;
CREATE POLICY "sp insert own or super" ON public.subscription_payments FOR INSERT TO authenticated
WITH CHECK (admin_user_id = auth.uid() OR public.is_super_admin(auth.uid()));

CREATE TRIGGER trg_subs_touch BEFORE UPDATE ON public.subscriptions
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Helper: subscription status for the current user's admin (business owner)
CREATE OR REPLACE FUNCTION public.get_my_subscription_status()
RETURNS TABLE (
  admin_user_id uuid,
  monthly_amount numeric,
  current_period_end timestamptz,
  grace_end timestamptz,
  status text,
  days_left integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_admin uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;

  -- If caller is platform_admin themselves, they ARE the admin
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_uid AND role = 'platform_admin') THEN
    v_admin := v_uid;
  ELSE
    -- Find business owner (creator)
    SELECT b.created_by INTO v_admin
    FROM public.profiles p JOIN public.businesses b ON b.id = p.business_id
    WHERE p.id = v_uid;
  END IF;

  IF v_admin IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT s.admin_user_id, s.monthly_amount, s.current_period_end,
         (s.current_period_end + interval '5 days') AS grace_end,
         CASE
           WHEN s.current_period_end IS NULL THEN 'inactive'
           WHEN now() <= s.current_period_end THEN 'active'
           WHEN now() <= s.current_period_end + interval '5 days' THEN 'grace'
           ELSE 'expired'
         END AS status,
         GREATEST(0, EXTRACT(day FROM ((s.current_period_end + interval '5 days') - now()))::int) AS days_left
  FROM public.subscriptions s
  WHERE s.admin_user_id = v_admin;
END $$;

REVOKE EXECUTE ON FUNCTION public.get_my_subscription_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_subscription_status() TO authenticated;
