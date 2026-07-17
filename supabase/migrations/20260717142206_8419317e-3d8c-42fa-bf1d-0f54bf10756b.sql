
-- ============================================================
-- 1. businesses table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.businesses TO authenticated;
GRANT ALL ON public.businesses TO service_role;

ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_businesses_updated_at
BEFORE UPDATE ON public.businesses
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============================================================
-- 2. business_id columns
-- ============================================================
ALTER TABLE public.profiles     ADD COLUMN IF NOT EXISTS business_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL;
ALTER TABLE public.user_roles   ADD COLUMN IF NOT EXISTS business_id uuid REFERENCES public.businesses(id) ON DELETE CASCADE;
ALTER TABLE public.clients      ADD COLUMN IF NOT EXISTS business_id uuid REFERENCES public.businesses(id) ON DELETE CASCADE;
ALTER TABLE public.loans        ADD COLUMN IF NOT EXISTS business_id uuid REFERENCES public.businesses(id) ON DELETE CASCADE;
ALTER TABLE public.payments     ADD COLUMN IF NOT EXISTS business_id uuid REFERENCES public.businesses(id) ON DELETE CASCADE;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS business_id uuid REFERENCES public.businesses(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_profiles_business_id     ON public.profiles(business_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_business_id   ON public.user_roles(business_id);
CREATE INDEX IF NOT EXISTS idx_clients_business_id      ON public.clients(business_id);
CREATE INDEX IF NOT EXISTS idx_loans_business_id        ON public.loans(business_id);
CREATE INDEX IF NOT EXISTS idx_payments_business_id     ON public.payments(business_id);
CREATE INDEX IF NOT EXISTS idx_transactions_business_id ON public.transactions(business_id);

-- ============================================================
-- 3. Helper functions
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = 'super_admin'
  )
$$;

CREATE OR REPLACE FUNCTION public.get_user_business_id(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT business_id FROM public.profiles WHERE id = _user_id LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.has_role_in_business(_user_id uuid, _role app_role, _business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
      AND (business_id = _business_id OR role = 'super_admin')
  )
$$;

-- ============================================================
-- 4. Updated signup trigger
--    First-ever signup => super_admin (developer)
--    Everyone else => profile only, no role (must be created by admin)
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_super boolean;
BEGIN
  INSERT INTO public.profiles (id, full_name, phone)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NEW.raw_user_meta_data->>'phone'
  )
  ON CONFLICT (id) DO NOTHING;

  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'super_admin') INTO v_has_super;

  IF NOT v_has_super THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'super_admin');
  END IF;

  RETURN NEW;
END;
$$;

-- Ensure trigger exists on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 5. businesses RLS
-- ============================================================
DROP POLICY IF EXISTS "Super admin manages businesses"      ON public.businesses;
DROP POLICY IF EXISTS "Business members view own business"  ON public.businesses;

CREATE POLICY "Super admin manages businesses" ON public.businesses
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "Business members view own business" ON public.businesses
  FOR SELECT TO authenticated
  USING (id = public.get_user_business_id(auth.uid()));

-- ============================================================
-- 6. Rewrite RLS: scope by business_id
-- ============================================================

-- profiles
DROP POLICY IF EXISTS "Profiles viewable by authenticated" ON public.profiles;
DROP POLICY IF EXISTS "Users insert own profile"           ON public.profiles;
DROP POLICY IF EXISTS "Users update own profile"           ON public.profiles;

CREATE POLICY "Profiles: self or same business or super admin" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR public.is_super_admin(auth.uid())
    OR (business_id IS NOT NULL AND business_id = public.get_user_business_id(auth.uid()))
  );

CREATE POLICY "Profiles: users insert own" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

CREATE POLICY "Profiles: users update own" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.is_super_admin(auth.uid()));

-- user_roles
DROP POLICY IF EXISTS "Roles viewable by authenticated" ON public.user_roles;
DROP POLICY IF EXISTS "Admins manage roles"             ON public.user_roles;

CREATE POLICY "Roles: view own, same business, or super admin" ON public.user_roles
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_super_admin(auth.uid())
    OR (business_id IS NOT NULL AND business_id = public.get_user_business_id(auth.uid()))
  );

CREATE POLICY "Roles: super admin manages all" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "Roles: business admin manages own business (non-super)" ON public.user_roles
  FOR ALL TO authenticated
  USING (
    role <> 'super_admin'
    AND business_id IS NOT NULL
    AND business_id = public.get_user_business_id(auth.uid())
    AND public.has_role(auth.uid(), 'admin')
  )
  WITH CHECK (
    role <> 'super_admin'
    AND business_id IS NOT NULL
    AND business_id = public.get_user_business_id(auth.uid())
    AND public.has_role(auth.uid(), 'admin')
  );

-- clients
DROP POLICY IF EXISTS "Clients viewable by authenticated" ON public.clients;
DROP POLICY IF EXISTS "Admin/Officer insert clients"      ON public.clients;
DROP POLICY IF EXISTS "Admin/Officer update clients"      ON public.clients;
DROP POLICY IF EXISTS "Admin delete clients"              ON public.clients;

CREATE POLICY "Clients: same business or super admin (select)" ON public.clients
  FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR business_id = public.get_user_business_id(auth.uid()));

CREATE POLICY "Clients: admin/officer insert own business" ON public.clients
  FOR INSERT TO authenticated
  WITH CHECK (
    business_id = public.get_user_business_id(auth.uid())
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'loan_officer'))
  );

CREATE POLICY "Clients: admin/officer update own business" ON public.clients
  FOR UPDATE TO authenticated
  USING (
    business_id = public.get_user_business_id(auth.uid())
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'loan_officer'))
  );

CREATE POLICY "Clients: admin delete own business" ON public.clients
  FOR DELETE TO authenticated
  USING (
    business_id = public.get_user_business_id(auth.uid())
    AND public.has_role(auth.uid(), 'admin')
  );

-- loans
DROP POLICY IF EXISTS "Loans viewable by authenticated" ON public.loans;
DROP POLICY IF EXISTS "Admin/Officer insert loans"      ON public.loans;
DROP POLICY IF EXISTS "Admin/Officer update loans"      ON public.loans;
DROP POLICY IF EXISTS "Admin delete loans"              ON public.loans;

CREATE POLICY "Loans: same business or super admin (select)" ON public.loans
  FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR business_id = public.get_user_business_id(auth.uid()));

CREATE POLICY "Loans: admin/officer insert own business" ON public.loans
  FOR INSERT TO authenticated
  WITH CHECK (
    business_id = public.get_user_business_id(auth.uid())
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'loan_officer'))
  );

CREATE POLICY "Loans: admin/officer update own business" ON public.loans
  FOR UPDATE TO authenticated
  USING (
    business_id = public.get_user_business_id(auth.uid())
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'loan_officer'))
  );

CREATE POLICY "Loans: admin delete own business" ON public.loans
  FOR DELETE TO authenticated
  USING (
    business_id = public.get_user_business_id(auth.uid())
    AND public.has_role(auth.uid(), 'admin')
  );

-- payments
DROP POLICY IF EXISTS "Payments viewable by authenticated"             ON public.payments;
DROP POLICY IF EXISTS "Admin/Officer/Accountant insert payments"       ON public.payments;
DROP POLICY IF EXISTS "Admin delete payments"                          ON public.payments;

CREATE POLICY "Payments: same business or super admin (select)" ON public.payments
  FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR business_id = public.get_user_business_id(auth.uid()));

CREATE POLICY "Payments: staff insert own business" ON public.payments
  FOR INSERT TO authenticated
  WITH CHECK (
    business_id = public.get_user_business_id(auth.uid())
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'loan_officer')
      OR public.has_role(auth.uid(), 'accountant')
    )
  );

CREATE POLICY "Payments: admin delete own business" ON public.payments
  FOR DELETE TO authenticated
  USING (
    business_id = public.get_user_business_id(auth.uid())
    AND public.has_role(auth.uid(), 'admin')
  );

-- transactions
DROP POLICY IF EXISTS "Transactions viewable by authenticated" ON public.transactions;
DROP POLICY IF EXISTS "Admin/Accountant insert tx"             ON public.transactions;
DROP POLICY IF EXISTS "Admin/Accountant update tx"             ON public.transactions;
DROP POLICY IF EXISTS "Admin delete tx"                        ON public.transactions;

CREATE POLICY "Tx: same business or super admin (select)" ON public.transactions
  FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR business_id = public.get_user_business_id(auth.uid()));

CREATE POLICY "Tx: admin/accountant insert own business" ON public.transactions
  FOR INSERT TO authenticated
  WITH CHECK (
    business_id = public.get_user_business_id(auth.uid())
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'accountant'))
  );

CREATE POLICY "Tx: admin/accountant update own business" ON public.transactions
  FOR UPDATE TO authenticated
  USING (
    business_id = public.get_user_business_id(auth.uid())
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'accountant'))
  );

CREATE POLICY "Tx: admin delete own business" ON public.transactions
  FOR DELETE TO authenticated
  USING (
    business_id = public.get_user_business_id(auth.uid())
    AND public.has_role(auth.uid(), 'admin')
  );
