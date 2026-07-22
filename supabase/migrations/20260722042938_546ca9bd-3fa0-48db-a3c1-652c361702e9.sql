
-- Deduplicate clients first (keep oldest per key)
DELETE FROM public.clients c
USING public.clients c2
WHERE c.business_id = c2.business_id
  AND lower(c.full_name) = lower(c2.full_name)
  AND lower(coalesce(c.last_name,'')) = lower(coalesce(c2.last_name,''))
  AND coalesce(c.phone,'') = coalesce(c2.phone,'')
  AND c.created_at > c2.created_at;

-- Deduplicate phone-per-business (keep oldest)
DELETE FROM public.clients c
USING public.clients c2
WHERE c.business_id = c2.business_id
  AND c.phone IS NOT NULL AND c.phone <> ''
  AND c.phone = c2.phone
  AND c.created_at > c2.created_at
  AND c.id <> c2.id;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS locked_reason TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS clients_unique_full_identity
  ON public.clients (business_id, lower(full_name), lower(coalesce(last_name,'')), coalesce(phone,''));

CREATE UNIQUE INDEX IF NOT EXISTS clients_unique_phone_per_business
  ON public.clients (business_id, phone)
  WHERE phone IS NOT NULL AND phone <> '';

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own notifications read" ON public.notifications;
CREATE POLICY "own notifications read" ON public.notifications
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "own notifications update" ON public.notifications;
CREATE POLICY "own notifications update" ON public.notifications
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.get_effective_lock_status(_user_id UUID)
RETURNS TABLE(locked BOOLEAN, reason TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_profile RECORD; v_biz RECORD; v_creator_profile RECORD;
  v_is_super BOOLEAN; v_is_platform BOOLEAN;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE id = _user_id;
  IF NOT FOUND THEN RETURN QUERY SELECT false, NULL::TEXT; RETURN; END IF;
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'super_admin') INTO v_is_super;
  IF v_is_super THEN RETURN QUERY SELECT false, NULL::TEXT; RETURN; END IF;
  IF v_profile.is_active IS FALSE THEN
    RETURN QUERY SELECT true, COALESCE(v_profile.locked_reason, 'manual'); RETURN;
  END IF;
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'platform_admin') INTO v_is_platform;
  IF v_is_platform THEN RETURN QUERY SELECT false, NULL::TEXT; RETURN; END IF;
  IF v_profile.business_id IS NOT NULL THEN
    SELECT * INTO v_biz FROM public.businesses WHERE id = v_profile.business_id;
    IF FOUND AND v_biz.is_active IS FALSE THEN
      RETURN QUERY SELECT true, 'business_locked'::TEXT; RETURN;
    END IF;
    IF FOUND AND v_biz.created_by IS NOT NULL THEN
      SELECT * INTO v_creator_profile FROM public.profiles WHERE id = v_biz.created_by;
      IF FOUND AND v_creator_profile.is_active IS FALSE THEN
        RETURN QUERY SELECT true, 'platform_admin_locked'::TEXT; RETURN;
      END IF;
    END IF;
  END IF;
  RETURN QUERY SELECT false, NULL::TEXT;
END $$;

GRANT EXECUTE ON FUNCTION public.get_effective_lock_status(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_platform_admin_active(_user_id UUID, _active BOOLEAN, _reason TEXT DEFAULT 'manual')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.profiles
    SET is_active = _active,
        locked_reason = CASE WHEN _active THEN NULL ELSE _reason END,
        updated_at = now()
   WHERE id = _user_id;
END $$;

CREATE OR REPLACE FUNCTION public.on_subscription_payment_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_recipient UUID; v_biz_name TEXT;
BEGIN
  IF NEW.business_id IS NOT NULL THEN
    SELECT created_by, name INTO v_recipient, v_biz_name FROM public.businesses WHERE id = NEW.business_id;
    IF v_recipient IS NOT NULL THEN
      INSERT INTO public.notifications(user_id, title, body, link)
      VALUES (v_recipient,
              'New subscription payment',
              COALESCE(v_biz_name,'A business') || ' submitted a payment of ' || NEW.amount || ' for ' || COALESCE(NEW.months_requested,1) || ' month(s).',
              '/admin/businesses/' || NEW.business_id || '/billing');
    END IF;
  ELSE
    INSERT INTO public.notifications(user_id, title, body, link)
    SELECT ur.user_id, 'Platform admin subscription payment',
           'A platform admin submitted a payment of ' || NEW.amount || ' for ' || COALESCE(NEW.months_requested,1) || ' month(s).',
           '/developer'
    FROM public.user_roles ur WHERE ur.role = 'super_admin';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_subscription_payment_insert ON public.subscription_payments;
CREATE TRIGGER trg_subscription_payment_insert
  AFTER INSERT ON public.subscription_payments
  FOR EACH ROW EXECUTE FUNCTION public.on_subscription_payment_insert();

CREATE OR REPLACE FUNCTION public.approve_subscription_payment(_payment_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_pay record; v_months numeric; v_biz_owner uuid; v_is_super boolean; v_biz_name text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT * INTO v_pay FROM public.subscription_payments WHERE id = _payment_id;
  IF v_pay IS NULL THEN RAISE EXCEPTION 'payment not found'; END IF;
  IF v_pay.status = 'confirmed' THEN RAISE EXCEPTION 'already confirmed'; END IF;
  SELECT public.has_role(v_uid, 'super_admin') INTO v_is_super;
  IF v_pay.business_id IS NOT NULL THEN
    SELECT created_by, name INTO v_biz_owner, v_biz_name FROM public.businesses WHERE id = v_pay.business_id;
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
    INSERT INTO public.notifications(user_id, title, body, link)
    VALUES (v_pay.admin_user_id, 'Subscription approved',
            'Your payment of ' || v_pay.amount || ' for ' || v_months || ' month(s) has been approved. Access is extended.',
            '/subscription');
  ELSE
    INSERT INTO public.subscriptions (admin_user_id, monthly_amount, current_period_end)
    VALUES (v_pay.admin_user_id, COALESCE(v_pay.amount / NULLIF(v_months,0), 0),
      GREATEST(now(), COALESCE((SELECT current_period_end FROM public.subscriptions WHERE admin_user_id = v_pay.admin_user_id AND business_id IS NULL), now())) + (v_months || ' months')::interval)
    ON CONFLICT (admin_user_id) WHERE business_id IS NULL DO UPDATE
      SET current_period_end = GREATEST(now(), COALESCE(public.subscriptions.current_period_end, now())) + (v_months || ' months')::interval,
          updated_at = now();
    INSERT INTO public.notifications(user_id, title, body, link)
    VALUES (v_pay.admin_user_id, 'Subscription approved',
            'Your payment of ' || v_pay.amount || ' for ' || v_months || ' month(s) has been approved.',
            '/subscription');
  END IF;
  UPDATE public.subscription_payments
     SET status = 'confirmed', months_granted = v_months, confirmed_by = v_uid, confirmed_at = now()
   WHERE id = _payment_id;
END $function$;
