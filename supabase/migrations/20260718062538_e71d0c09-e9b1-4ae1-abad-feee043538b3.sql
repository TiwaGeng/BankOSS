
-- helper: is caller the platform_admin who created a given business?
CREATE OR REPLACE FUNCTION public.is_platform_admin_of(_user_id uuid, _business_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.businesses
    WHERE id = _business_id AND created_by = _user_id
  ) AND public.has_role(_user_id, 'platform_admin'::app_role)
$$;

-- Businesses: platform admins can insert/select/update/delete the ones they created
DROP POLICY IF EXISTS "Platform admins manage own businesses" ON public.businesses;
CREATE POLICY "Platform admins manage own businesses"
  ON public.businesses FOR ALL
  USING (public.has_role(auth.uid(), 'platform_admin'::app_role) AND created_by = auth.uid())
  WITH CHECK (public.has_role(auth.uid(), 'platform_admin'::app_role) AND created_by = auth.uid());

-- User roles: platform admins can view roles inside businesses they created
DROP POLICY IF EXISTS "Platform admins view roles in own businesses" ON public.user_roles;
CREATE POLICY "Platform admins view roles in own businesses"
  ON public.user_roles FOR SELECT
  USING (business_id IS NOT NULL AND public.is_platform_admin_of(auth.uid(), business_id));

-- Profiles: platform admins view profiles in businesses they created
DROP POLICY IF EXISTS "Platform admins view profiles in own businesses" ON public.profiles;
CREATE POLICY "Platform admins view profiles in own businesses"
  ON public.profiles FOR SELECT
  USING (business_id IS NOT NULL AND public.is_platform_admin_of(auth.uid(), business_id));

-- Clients / loans / payments / transactions: platform admins view data in their businesses
DROP POLICY IF EXISTS "Platform admins view clients" ON public.clients;
CREATE POLICY "Platform admins view clients" ON public.clients FOR SELECT
  USING (business_id IS NOT NULL AND public.is_platform_admin_of(auth.uid(), business_id));

DROP POLICY IF EXISTS "Platform admins view loans" ON public.loans;
CREATE POLICY "Platform admins view loans" ON public.loans FOR SELECT
  USING (business_id IS NOT NULL AND public.is_platform_admin_of(auth.uid(), business_id));

DROP POLICY IF EXISTS "Platform admins view payments" ON public.payments;
CREATE POLICY "Platform admins view payments" ON public.payments FOR SELECT
  USING (business_id IS NOT NULL AND public.is_platform_admin_of(auth.uid(), business_id));

DROP POLICY IF EXISTS "Platform admins view transactions" ON public.transactions;
CREATE POLICY "Platform admins view transactions" ON public.transactions FOR SELECT
  USING (business_id IS NOT NULL AND public.is_platform_admin_of(auth.uid(), business_id));

-- Migrate the legacy pre-existing admin (with no business) to platform_admin
UPDATE public.user_roles
SET role = 'platform_admin'::app_role
WHERE role = 'admin'::app_role AND business_id IS NULL;
