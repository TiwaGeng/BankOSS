
DROP POLICY IF EXISTS "Avatars are publicly readable" ON storage.objects;
CREATE POLICY "Authenticated users can read avatars"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'avatars');

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_super_admin(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_user_business_id(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_role_in_business(uuid, app_role, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_platform_admin_of(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_business_id_from_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "Business staff can update payments" ON public.payments;
CREATE POLICY "Business staff can update payments"
ON public.payments FOR UPDATE
TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR public.is_platform_admin_of(auth.uid(), business_id)
  OR (
    business_id = public.get_user_business_id(auth.uid())
    AND (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'loan_officer'::app_role)
      OR public.has_role(auth.uid(), 'accountant'::app_role)
    )
  )
)
WITH CHECK (
  public.is_super_admin(auth.uid())
  OR public.is_platform_admin_of(auth.uid(), business_id)
  OR (
    business_id = public.get_user_business_id(auth.uid())
    AND (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'loan_officer'::app_role)
      OR public.has_role(auth.uid(), 'accountant'::app_role)
    )
  )
);
