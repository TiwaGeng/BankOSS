
-- Clients
DROP POLICY IF EXISTS "Clients: admin/officer insert own business" ON public.clients;
DROP POLICY IF EXISTS "Clients: admin/officer update own business" ON public.clients;
DROP POLICY IF EXISTS "Clients: admin delete own business" ON public.clients;

CREATE POLICY "Clients: insert" ON public.clients FOR INSERT TO authenticated
WITH CHECK (
  public.is_super_admin(auth.uid())
  OR (business_id = public.get_user_business_id(auth.uid())
      AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'loan_officer')))
);
CREATE POLICY "Clients: update" ON public.clients FOR UPDATE TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR (business_id = public.get_user_business_id(auth.uid())
      AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'loan_officer')))
);
CREATE POLICY "Clients: delete" ON public.clients FOR DELETE TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR (business_id = public.get_user_business_id(auth.uid()) AND public.has_role(auth.uid(),'admin'))
);

-- Loans
DROP POLICY IF EXISTS "Loans: admin/officer insert own business" ON public.loans;
DROP POLICY IF EXISTS "Loans: admin/officer update own business" ON public.loans;
DROP POLICY IF EXISTS "Loans: admin delete own business" ON public.loans;

CREATE POLICY "Loans: insert" ON public.loans FOR INSERT TO authenticated
WITH CHECK (
  public.is_super_admin(auth.uid())
  OR (business_id = public.get_user_business_id(auth.uid())
      AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'loan_officer')))
);
CREATE POLICY "Loans: update" ON public.loans FOR UPDATE TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR (business_id = public.get_user_business_id(auth.uid())
      AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'loan_officer')))
);
CREATE POLICY "Loans: delete" ON public.loans FOR DELETE TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR (business_id = public.get_user_business_id(auth.uid()) AND public.has_role(auth.uid(),'admin'))
);

-- Payments
DROP POLICY IF EXISTS "Payments: staff insert own business" ON public.payments;
DROP POLICY IF EXISTS "Payments: admin delete own business" ON public.payments;

CREATE POLICY "Payments: insert" ON public.payments FOR INSERT TO authenticated
WITH CHECK (
  public.is_super_admin(auth.uid())
  OR (business_id = public.get_user_business_id(auth.uid())
      AND (public.has_role(auth.uid(),'admin')
           OR public.has_role(auth.uid(),'loan_officer')
           OR public.has_role(auth.uid(),'accountant')))
);
CREATE POLICY "Payments: delete" ON public.payments FOR DELETE TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR (business_id = public.get_user_business_id(auth.uid()) AND public.has_role(auth.uid(),'admin'))
);

-- Transactions
DROP POLICY IF EXISTS "Tx: admin/accountant insert own business" ON public.transactions;
DROP POLICY IF EXISTS "Tx: admin/accountant update own business" ON public.transactions;
DROP POLICY IF EXISTS "Tx: admin delete own business" ON public.transactions;

CREATE POLICY "Tx: insert" ON public.transactions FOR INSERT TO authenticated
WITH CHECK (
  public.is_super_admin(auth.uid())
  OR (business_id = public.get_user_business_id(auth.uid())
      AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'accountant')))
);
CREATE POLICY "Tx: update" ON public.transactions FOR UPDATE TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR (business_id = public.get_user_business_id(auth.uid())
      AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'accountant')))
);
CREATE POLICY "Tx: delete" ON public.transactions FOR DELETE TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR (business_id = public.get_user_business_id(auth.uid()) AND public.has_role(auth.uid(),'admin'))
);

-- Ensure the auto-fill trigger runs on all four tables so business_id is set from the caller's profile
DROP TRIGGER IF EXISTS set_business_id_clients ON public.clients;
CREATE TRIGGER set_business_id_clients BEFORE INSERT ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.set_business_id_from_user();

DROP TRIGGER IF EXISTS set_business_id_loans ON public.loans;
CREATE TRIGGER set_business_id_loans BEFORE INSERT ON public.loans
  FOR EACH ROW EXECUTE FUNCTION public.set_business_id_from_user();

DROP TRIGGER IF EXISTS set_business_id_payments ON public.payments;
CREATE TRIGGER set_business_id_payments BEFORE INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.set_business_id_from_user();

DROP TRIGGER IF EXISTS set_business_id_transactions ON public.transactions;
CREATE TRIGGER set_business_id_transactions BEFORE INSERT ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.set_business_id_from_user();
