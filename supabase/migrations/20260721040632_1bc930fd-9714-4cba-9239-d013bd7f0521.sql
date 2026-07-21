
DROP FUNCTION IF EXISTS public.get_my_subscription_status();

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS payment_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS monthly_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS initial_months integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS payment_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS business_id uuid REFERENCES public.businesses(id) ON DELETE CASCADE;

ALTER TABLE public.subscription_payments
  ADD COLUMN IF NOT EXISTS business_id uuid REFERENCES public.businesses(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS subscriptions_business_idx ON public.subscriptions(business_id);
CREATE INDEX IF NOT EXISTS subscription_payments_business_idx ON public.subscription_payments(business_id);
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_business_uniq ON public.subscriptions(business_id) WHERE business_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_admin_uniq ON public.subscriptions(admin_user_id) WHERE business_id IS NULL;

CREATE OR REPLACE FUNCTION public.get_my_subscription_status()
RETURNS TABLE(admin_user_id uuid, business_id uuid, monthly_amount numeric, current_period_end timestamp with time zone, grace_end timestamp with time zone, status text, days_left integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_biz uuid;
  v_is_platform boolean;
  v_pay_enabled boolean;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_uid AND role = 'platform_admin') INTO v_is_platform;

  IF v_is_platform THEN
    SELECT p.payment_enabled INTO v_pay_enabled FROM public.profiles p WHERE p.id = v_uid;
    IF NOT COALESCE(v_pay_enabled, false) THEN RETURN; END IF;
    RETURN QUERY
    SELECT s.admin_user_id, NULL::uuid, s.monthly_amount, s.current_period_end,
           (s.current_period_end + interval '5 days'),
           CASE WHEN s.current_period_end IS NULL THEN 'inactive'
                WHEN now() <= s.current_period_end THEN 'active'
                WHEN now() <= s.current_period_end + interval '5 days' THEN 'grace'
                ELSE 'expired' END,
           GREATEST(0, EXTRACT(day FROM ((s.current_period_end + interval '5 days') - now()))::int)
    FROM public.subscriptions s WHERE s.admin_user_id = v_uid AND s.business_id IS NULL;
    RETURN;
  END IF;

  SELECT p.business_id INTO v_biz FROM public.profiles p WHERE p.id = v_uid;
  IF v_biz IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.businesses WHERE id = v_biz AND payment_enabled = true) THEN RETURN; END IF;

  RETURN QUERY
  SELECT s.admin_user_id, s.business_id, s.monthly_amount, s.current_period_end,
         (s.current_period_end + interval '5 days'),
         CASE WHEN s.current_period_end IS NULL THEN 'inactive'
              WHEN now() <= s.current_period_end THEN 'active'
              WHEN now() <= s.current_period_end + interval '5 days' THEN 'grace'
              ELSE 'expired' END,
         GREATEST(0, EXTRACT(day FROM ((s.current_period_end + interval '5 days') - now()))::int)
  FROM public.subscriptions s WHERE s.business_id = v_biz;
END $$;

REVOKE EXECUTE ON FUNCTION public.get_my_subscription_status() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_subscription_status() TO authenticated;

CREATE OR REPLACE FUNCTION public.approve_subscription_payment(_payment_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_pay record; v_months numeric; v_biz_owner uuid; v_is_super boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT * INTO v_pay FROM public.subscription_payments WHERE id = _payment_id;
  IF v_pay IS NULL THEN RAISE EXCEPTION 'payment not found'; END IF;
  IF v_pay.status = 'confirmed' THEN RAISE EXCEPTION 'already confirmed'; END IF;
  SELECT public.has_role(v_uid, 'super_admin') INTO v_is_super;
  IF v_pay.business_id IS NOT NULL THEN
    SELECT created_by INTO v_biz_owner FROM public.businesses WHERE id = v_pay.business_id;
    IF NOT v_is_super AND v_biz_owner <> v_uid THEN RAISE EXCEPTION 'forbidden'; END IF;
  ELSE
    IF NOT v_is_super THEN RAISE EXCEPTION 'forbidden'; END IF;
  END IF;
  v_months := COALESCE(v_pay.months_requested, v_pay.months_granted, 1);
  IF v_pay.business_id IS NOT NULL THEN
    INSERT INTO public.subscriptions (business_id, admin_user_id, monthly_amount, current_period_end)
    VALUES (v_pay.business_id, v_pay.admin_user_id,
      (SELECT monthly_amount FROM public.businesses WHERE id = v_pay.business_id),
      GREATEST(now(), COALESCE((SELECT current_period_end FROM public.subscriptions WHERE business_id = v_pay.business_id), now())) + (v_months || ' months')::interval)
    ON CONFLICT (business_id) DO UPDATE
      SET current_period_end = GREATEST(now(), COALESCE(public.subscriptions.current_period_end, now())) + (v_months || ' months')::interval,
          updated_at = now();
  ELSE
    INSERT INTO public.subscriptions (admin_user_id, monthly_amount, current_period_end)
    VALUES (v_pay.admin_user_id, COALESCE(v_pay.amount / NULLIF(v_months,0), 0),
      GREATEST(now(), COALESCE((SELECT current_period_end FROM public.subscriptions WHERE admin_user_id = v_pay.admin_user_id AND business_id IS NULL), now())) + (v_months || ' months')::interval)
    ON CONFLICT (admin_user_id) WHERE business_id IS NULL DO UPDATE
      SET current_period_end = GREATEST(now(), COALESCE(public.subscriptions.current_period_end, now())) + (v_months || ' months')::interval,
          updated_at = now();
  END IF;
  UPDATE public.subscription_payments
     SET status = 'confirmed', months_granted = v_months, confirmed_by = v_uid, confirmed_at = now()
   WHERE id = _payment_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.approve_subscription_payment(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.approve_subscription_payment(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_subscription_payment(_payment_id uuid, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_pay record; v_biz_owner uuid; v_is_super boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT * INTO v_pay FROM public.subscription_payments WHERE id = _payment_id;
  IF v_pay IS NULL THEN RAISE EXCEPTION 'payment not found'; END IF;
  SELECT public.has_role(v_uid, 'super_admin') INTO v_is_super;
  IF v_pay.business_id IS NOT NULL THEN
    SELECT created_by INTO v_biz_owner FROM public.businesses WHERE id = v_pay.business_id;
    IF NOT v_is_super AND v_biz_owner <> v_uid THEN RAISE EXCEPTION 'forbidden'; END IF;
  ELSE
    IF NOT v_is_super THEN RAISE EXCEPTION 'forbidden'; END IF;
  END IF;
  UPDATE public.subscription_payments
     SET status = 'rejected', note = COALESCE(_reason, note), confirmed_by = v_uid, confirmed_at = now()
   WHERE id = _payment_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.reject_subscription_payment(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.reject_subscription_payment(uuid, text) TO authenticated;

-- Super admin: activate/deactivate platform admin
CREATE OR REPLACE FUNCTION public.set_platform_admin_active(_user_id uuid, _active boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.profiles SET is_active = _active, updated_at = now() WHERE id = _user_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.set_platform_admin_active(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_platform_admin_active(uuid, boolean) TO authenticated;

-- Super admin: toggle platform admin's payment_enabled
CREATE OR REPLACE FUNCTION public.set_platform_admin_payment_enabled(_user_id uuid, _enabled boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.profiles SET payment_enabled = _enabled, updated_at = now() WHERE id = _user_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.set_platform_admin_payment_enabled(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_platform_admin_payment_enabled(uuid, boolean) TO authenticated;

-- Platform admin: toggle business.is_active / payment_enabled
CREATE OR REPLACE FUNCTION public.set_business_active(_business_id uuid, _active boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'super_admin')
          OR EXISTS (SELECT 1 FROM public.businesses WHERE id = _business_id AND created_by = auth.uid())) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  UPDATE public.businesses SET is_active = _active, updated_at = now() WHERE id = _business_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.set_business_active(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_business_active(uuid, boolean) TO authenticated;

DROP POLICY IF EXISTS "Platform admin views business sub payments" ON public.subscription_payments;
CREATE POLICY "Platform admin views business sub payments"
  ON public.subscription_payments FOR SELECT TO authenticated
  USING (business_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = subscription_payments.business_id AND b.created_by = auth.uid()));

DROP POLICY IF EXISTS "Business users view their business sub payments" ON public.subscription_payments;
CREATE POLICY "Business users view their business sub payments"
  ON public.subscription_payments FOR SELECT TO authenticated
  USING (business_id IS NOT NULL AND business_id = public.get_user_business_id(auth.uid()));

DROP POLICY IF EXISTS "Business admin inserts business sub payment" ON public.subscription_payments;
CREATE POLICY "Business admin inserts business sub payment"
  ON public.subscription_payments FOR INSERT TO authenticated
  WITH CHECK (admin_user_id = auth.uid() AND (business_id IS NULL OR business_id = public.get_user_business_id(auth.uid())));

DROP POLICY IF EXISTS "Platform admin views business subs" ON public.subscriptions;
CREATE POLICY "Platform admin views business subs"
  ON public.subscriptions FOR SELECT TO authenticated
  USING (business_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = subscriptions.business_id AND b.created_by = auth.uid()));

DROP POLICY IF EXISTS "Business users view their business sub" ON public.subscriptions;
CREATE POLICY "Business users view their business sub"
  ON public.subscriptions FOR SELECT TO authenticated
  USING (business_id IS NOT NULL AND business_id = public.get_user_business_id(auth.uid()));
