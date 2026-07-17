
CREATE OR REPLACE FUNCTION public.set_business_id_from_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.business_id IS NULL AND auth.uid() IS NOT NULL THEN
    NEW.business_id := public.get_user_business_id(auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clients_set_business_id      ON public.clients;
DROP TRIGGER IF EXISTS trg_loans_set_business_id        ON public.loans;
DROP TRIGGER IF EXISTS trg_payments_set_business_id     ON public.payments;
DROP TRIGGER IF EXISTS trg_transactions_set_business_id ON public.transactions;

CREATE TRIGGER trg_clients_set_business_id      BEFORE INSERT ON public.clients      FOR EACH ROW EXECUTE FUNCTION public.set_business_id_from_user();
CREATE TRIGGER trg_loans_set_business_id        BEFORE INSERT ON public.loans        FOR EACH ROW EXECUTE FUNCTION public.set_business_id_from_user();
CREATE TRIGGER trg_payments_set_business_id     BEFORE INSERT ON public.payments     FOR EACH ROW EXECUTE FUNCTION public.set_business_id_from_user();
CREATE TRIGGER trg_transactions_set_business_id BEFORE INSERT ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.set_business_id_from_user();
