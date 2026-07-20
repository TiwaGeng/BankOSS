
ALTER TABLE public.subscription_payments
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS proof_url text,
  ADD COLUMN IF NOT EXISTS note text,
  ADD COLUMN IF NOT EXISTS months_requested numeric,
  ADD COLUMN IF NOT EXISTS confirmed_by uuid,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

DROP POLICY IF EXISTS "sp update own pending or super" ON public.subscription_payments;
CREATE POLICY "sp update own pending or super"
  ON public.subscription_payments FOR UPDATE
  TO authenticated
  USING ((admin_user_id = auth.uid() AND status = 'pending') OR public.is_super_admin(auth.uid()))
  WITH CHECK ((admin_user_id = auth.uid()) OR public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "subproofs: admin uploads own" ON storage.objects;
CREATE POLICY "subproofs: admin uploads own"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'subscription-proofs' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "subproofs: admin reads own or super reads all" ON storage.objects;
CREATE POLICY "subproofs: admin reads own or super reads all"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'subscription-proofs' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_super_admin(auth.uid())));

DROP POLICY IF EXISTS "subproofs: admin updates own" ON storage.objects;
CREATE POLICY "subproofs: admin updates own"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'subscription-proofs' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'subscription-proofs' AND (storage.foldername(name))[1] = auth.uid()::text);
