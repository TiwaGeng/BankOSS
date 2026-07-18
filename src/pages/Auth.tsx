import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Landmark } from "lucide-react";
import { toast } from "sonner";

const emailSchema = z.string().trim().email("Invalid email").max(255);
const passSchema = z.string().min(6, "Min 6 characters").max(72);
const nameSchema = z.string().trim().min(2, "Name too short").max(100);
const phoneSchema = z.string().trim().min(7, "Phone too short").max(20).regex(/^[+0-9 \-()]+$/, "Invalid phone").optional().or(z.literal(""));

const Auth = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  if (loading) return null;
  if (user) return <Navigate to="/" replace />;

  const onLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email"));
    const password = String(fd.get("password"));
    const ev = emailSchema.safeParse(email);
    const pv = passSchema.safeParse(password);
    if (!ev.success || !pv.success) return toast.error(ev.success ? pv.error.errors[0].message : ev.error.errors[0].message);
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Welcome back");
    navigate("/");
  };

  const onSignup = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email"));
    const password = String(fd.get("password"));
    const full_name = String(fd.get("full_name"));
    const phone = String(fd.get("phone") || "");
    const ev = emailSchema.safeParse(email);
    const pv = passSchema.safeParse(password);
    const nv = nameSchema.safeParse(full_name);
    const phv = phoneSchema.safeParse(phone);
    if (!ev.success) return toast.error(ev.error.errors[0].message);
    if (!pv.success) return toast.error(pv.error.errors[0].message);
    if (!nv.success) return toast.error(nv.error.errors[0].message);
    if (!phv.success) return toast.error(phv.error.errors[0].message);
    setBusy(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/dashboard`,
        data: { full_name, phone: phone || null },
      },
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Account created — please check your email to confirm.");
  };

  return (
    <main className="min-h-screen grid lg:grid-cols-2 bg-background">
      <div className="hidden lg:flex flex-col justify-between p-12 bg-gradient-hero text-primary-foreground">
        <div className="flex items-center gap-2">
          <Landmark className="h-7 w-7 text-gold" />
          <span className="font-display text-2xl font-bold">BankOS</span>
        </div>
        <div className="space-y-4">
          <h1 className="font-display text-4xl font-bold">Manage your lending business with confidence.</h1>
          <p className="text-primary-foreground/80 max-w-md">Clients, loans, payments and reports — all in one secure place.</p>
        </div>
        <p className="text-xs text-primary-foreground/50">© 2026 BankOS</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-md space-y-6">
          <div className="lg:hidden flex items-center gap-2 mb-6">
            <Landmark className="h-6 w-6 text-primary" />
            <span className="font-display text-xl font-bold">BankOS</span>
          </div>
          <Tabs defaultValue="login">
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="login">Sign In</TabsTrigger>
              <TabsTrigger value="signup">Sign Up</TabsTrigger>
            </TabsList>
            <TabsContent value="login">
              <form onSubmit={onLogin} className="space-y-4 mt-6">
                <div>
                  <Label htmlFor="li-email">Email</Label>
                  <Input id="li-email" name="email" type="email" required />
                </div>
                <div>
                  <Label htmlFor="li-pass">Password</Label>
                  <Input id="li-pass" name="password" type="password" required />
                </div>
                <Button type="submit" className="w-full" disabled={busy}>{busy ? "..." : "Sign in"}</Button>
              </form>
            </TabsContent>
            <TabsContent value="signup">
              <form onSubmit={onSignup} className="space-y-4 mt-6">
                <div>
                  <Label htmlFor="su-name">Full name</Label>
                  <Input id="su-name" name="full_name" required />
                </div>
                <div>
                  <Label htmlFor="su-phone">Phone number</Label>
                  <Input id="su-phone" name="phone" type="tel" placeholder="+250 7XX XXX XXX" />
                </div>
                <div>
                  <Label htmlFor="su-email">Email</Label>
                  <Input id="su-email" name="email" type="email" required />
                </div>
                <div>
                  <Label htmlFor="su-pass">Password</Label>
                  <Input id="su-pass" name="password" type="password" required minLength={6} />
                </div>
                <Button type="submit" className="w-full" disabled={busy}>{busy ? "..." : "Create account"}</Button>
                <p className="text-xs text-muted-foreground">First account becomes Admin automatically.</p>
              </form>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </main>
  );
};

export default Auth;