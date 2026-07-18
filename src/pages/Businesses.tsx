import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { z } from "zod";
import { Building2, ShieldAlert, Plus } from "lucide-react";

const schema = z.object({
  business_name: z.string().trim().min(2).max(100),
  full_name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(255),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  password: z.string().min(6).max(72),
});

interface Business {
  id: string;
  name: string;
  owner_id: string | null;
  created_by: string | null;
  created_at: string;
}

const Businesses = () => {
  const { isSuperAdmin, isPlatformAdmin } = useAuth();
  const allowed = isSuperAdmin || isPlatformAdmin;
  const [items, setItems] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ business_name: "", full_name: "", email: "", phone: "", password: "" });

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("businesses").select("id, name, owner_id, created_by, created_at").order("created_at", { ascending: false });
    setItems((data ?? []) as Business[]);
    setLoading(false);
  };

  useEffect(() => { if (allowed) load(); }, [allowed]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      toast({ title: "Invalid", description: parsed.error.issues[0].message, variant: "destructive" });
      return;
    }
    setSubmitting(true);
    const { data, error } = await supabase.functions.invoke("create-business", {
      body: {
        business_name: parsed.data.business_name,
        email: parsed.data.email,
        password: parsed.data.password,
        full_name: parsed.data.full_name,
        phone: parsed.data.phone || null,
      },
    });
    setSubmitting(false);
    if (error || (data as any)?.error) {
      toast({ title: "Failed", description: error?.message ?? (data as any)?.error ?? "Could not create", variant: "destructive" });
      return;
    }
    toast({ title: "Business created", description: `${parsed.data.business_name} is ready. Owner can sign in with ${parsed.data.email}.` });
    setForm({ business_name: "", full_name: "", email: "", phone: "", password: "" });
    load();
  };

  if (!allowed) {
    return (
      <div className="max-w-xl mx-auto mt-12">
        <Card>
          <CardContent className="p-8 text-center space-y-3">
            <ShieldAlert className="h-10 w-10 text-destructive mx-auto" />
            <h2 className="text-xl font-semibold">Restricted</h2>
            <p className="text-sm text-muted-foreground">Only developers and platform admins can manage business accounts.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-3xl font-bold flex items-center gap-2"><Building2 className="h-7 w-7" /> Business accounts</h1>
        <p className="text-muted-foreground">Create a business and its first admin. That admin then adds their own staff.</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Plus className="h-5 w-5" /> New business</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Business name</Label>
              <Input value={form.business_name} onChange={(e) => setForm({ ...form, business_name: e.target.value })} required />
            </div>
            <div className="space-y-2">
              <Label>Admin full name</Label>
              <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required />
            </div>
            <div className="space-y-2">
              <Label>Admin email</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            </div>
            <div className="space-y-2">
              <Label>Admin phone</Label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Temporary password</Label>
              <Input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={6} />
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={submitting} className="w-full">
                {submitting ? "Creating…" : "Create business"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All businesses ({items.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground text-sm">Loading…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">{b.name}</TableCell>
                    <TableCell>{new Date(b.created_at).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
                {items.length === 0 && (
                  <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground">No businesses yet.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Businesses;
