import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

const schema = z.object({
  first_name: z.string().trim().min(1, "First name required").max(80),
  last_name: z.string().trim().min(1, "Last name required").max(80),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  customer_type: z.enum(["field", "office"]),
  address: z.string().trim().max(200).optional().or(z.literal("")),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

interface ClientRow { id: string; full_name: string; last_name: string | null; phone: string | null; customer_type: "field" | "office"; address: string | null; }

const NewClient = () => {
  const { user, hasRole } = useAuth();
  const [saving, setSaving] = useState(false);
  const [items, setItems] = useState<ClientRow[]>([]);
  const [search, setSearch] = useState("");
  const [countdown, setCountdown] = useState(0);
  const [customerType, setCustomerType] = useState<"field" | "office">("office");

  const load = async () => {
    const { data } = await supabase.from("clients").select("id, full_name, last_name, phone, customer_type, address").order("created_at", { ascending: false });
    setItems(((data as unknown) as ClientRow[]) ?? []);
  };
  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  if (!hasRole(["admin", "loan_officer", "accountant"])) {
    return <p className="text-muted-foreground">You don't have permission to add clients.</p>;
  }

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    setSaving(true);
    const fd = { ...Object.fromEntries(new FormData(form)), customer_type: customerType };
    const parsed = schema.safeParse(fd);
    if (!parsed.success) { setSaving(false); return toast.error(parsed.error.errors[0].message); }
    const { first_name, last_name, ...rest } = parsed.data;
    const { error } = await supabase.from("clients").insert({
      ...rest,
      full_name: first_name,
      last_name,
      created_by: user!.id,
    } as never);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("✓ Client added successfully!");
    setCountdown(5);
    form.reset();
    setCustomerType("office");
    load();
  };

  const filtered = items.filter((c) => {
    const q = search.toLowerCase();
    return !q || c.full_name.toLowerCase().includes(q) || (c.last_name ?? "").toLowerCase().includes(q) || (c.phone ?? "").includes(q);
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-3xl font-bold">Add a New Client</h1>
        <p className="text-muted-foreground">Register a new borrower in the system</p>
      </header>
      <Card className="shadow-soft max-w-2xl">
        <CardHeader><CardTitle>Client details</CardTitle></CardHeader>
        <CardContent>
          {countdown > 0 && (
            <div className="mb-4 rounded-lg border border-gold/40 bg-gold/10 px-4 py-3 text-sm">
              <strong>Successfully added!</strong>{" "}
              <span className="text-muted-foreground">Form clears in {countdown}s — add another client below.</span>
            </div>
          )}
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><Label>Client name (first)</Label><Input name="first_name" required /></div>
              <div><Label>Last name</Label><Input name="last_name" required /></div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><Label>Phone number</Label><Input name="phone" /></div>
              <div>
                <Label>Customer type</Label>
                <Select value={customerType} onValueChange={(v) => setCustomerType(v as "field" | "office")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="field">Field — we collect at their place</SelectItem>
                    <SelectItem value="office">Office — they bring money to office</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Business address</Label><Input name="address" /></div>
            <div><Label>Notes</Label><Textarea name="notes" rows={3} /></div>
            <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save Client"}</Button>
          </form>
        </CardContent>
      </Card>

      <Card className="shadow-soft">
        <CardHeader className="flex flex-row items-center justify-between gap-3 flex-wrap">
          <CardTitle>All Clients ({items.length})</CardTitle>
          <Input placeholder="Search any client…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-64" />
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow><TableHead>Name</TableHead><TableHead>Last name</TableHead><TableHead>Phone</TableHead><TableHead>Type</TableHead><TableHead>Address</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No clients</TableCell></TableRow>
              ) : filtered.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.full_name}</TableCell>
                  <TableCell>{c.last_name || "—"}</TableCell>
                  <TableCell>{c.phone || "—"}</TableCell>
                  <TableCell><Badge variant={c.customer_type === "field" ? "default" : "secondary"}>{c.customer_type}</Badge></TableCell>
                  <TableCell>{c.address || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default NewClient;
