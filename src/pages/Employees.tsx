import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { z } from "zod";
import { UserPlus, ShieldAlert } from "lucide-react";

type Role = "admin" | "loan_officer" | "accountant" | "viewer";
type EmpType = "field" | "office";

const roleLabels: Record<Role, string> = {
  admin: "Admin",
  loan_officer: "Loan Officer",
  accountant: "Accountant",
  viewer: "Viewer",
};

const schema = z.object({
  full_name: z.string().trim().min(2, "Name too short").max(100),
  email: z.string().trim().email("Invalid email").max(255),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  password: z.string().min(6, "Min 6 characters").max(72),
  role: z.enum(["admin", "loan_officer", "accountant", "viewer"]),
  employee_type: z.enum(["field", "office"]),
});

interface Employee {
  id: string;
  full_name: string | null;
  phone: string | null;
  employee_type: EmpType | null;
  is_active: boolean;
  created_at: string;
  role: Role;
}

const Employees = () => {
  const { hasRole, user } = useAuth();
  const isAdmin = hasRole("admin");

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ full_name: "", email: "", phone: "", password: "", role: "viewer" as Role, employee_type: "office" as EmpType });

  const load = async () => {
    setLoading(true);
    const { data: roles } = await supabase.from("user_roles").select("user_id, role");
    const { data: profiles } = await supabase.from("profiles").select("id, full_name, phone, employee_type, is_active, created_at");
    const merged: Employee[] = (profiles ?? []).map((p) => ({
      id: p.id,
      full_name: p.full_name,
      phone: p.phone,
      employee_type: (p as { employee_type: EmpType | null }).employee_type ?? null,
      is_active: (p as { is_active?: boolean }).is_active ?? true,
      created_at: p.created_at,
      role: (roles?.find((r) => r.user_id === p.id)?.role ?? "viewer") as Role,
    }));
    setEmployees(merged.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      toast({ title: "Invalid", description: parsed.error.issues[0].message, variant: "destructive" });
      return;
    }
    setSubmitting(true);
    const { data, error } = await supabase.functions.invoke("create-employee", {
      body: {
        email: parsed.data.email,
        password: parsed.data.password,
        full_name: parsed.data.full_name,
        phone: parsed.data.phone || null,
        role: parsed.data.role,
        employee_type: parsed.data.employee_type,
      },
    });
    setSubmitting(false);
    if (error || (data as { error?: string })?.error) {
      toast({ title: "Failed", description: error?.message ?? (data as { error?: string })?.error ?? "Could not create", variant: "destructive" });
      return;
    }
    toast({ title: "Employee created", description: `${parsed.data.full_name} added as ${roleLabels[parsed.data.role]}` });
    setForm({ full_name: "", email: "", phone: "", password: "", role: "viewer", employee_type: "office" });
    load();
  };

  const updateRole = async (userId: string, role: Role) => {
    const { error: delErr } = await supabase.from("user_roles").delete().eq("user_id", userId);
    if (delErr) return toast({ title: "Failed", description: delErr.message, variant: "destructive" });
    const { error: insErr } = await supabase.from("user_roles").insert({ user_id: userId, role });
    if (insErr) return toast({ title: "Failed", description: insErr.message, variant: "destructive" });
    toast({ title: "Role updated" });
    load();
  };

  const toggleActive = async (emp: Employee) => {
    const { error } = await supabase.from("profiles").update({
      is_active: !emp.is_active,
      locked_reason: emp.is_active ? "manual" : null,
    } as never).eq("id", emp.id);
    if (error) return toast({ title: "Failed", description: error.message, variant: "destructive" });
    toast({ title: emp.is_active ? "Employee deactivated" : "Employee activated" });
    load();
  };


  if (!isAdmin) {
    return (
      <div className="max-w-xl mx-auto mt-12">
        <Card>
          <CardContent className="p-8 text-center space-y-3">
            <ShieldAlert className="h-10 w-10 text-destructive mx-auto" />
            <h2 className="text-xl font-semibold">Admin only</h2>
            <p className="text-sm text-muted-foreground">You don't have permission to manage employees.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-3xl font-bold">Employees</h1>
        <p className="text-muted-foreground">Create staff accounts, assign roles and work type.</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><UserPlus className="h-5 w-5" /> New employee</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Full name</Label>
              <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Temporary password</Label>
              <Input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={6} />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as Role })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(roleLabels) as Role[]).map((r) => (
                    <SelectItem key={r} value={r}>{roleLabels[r]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Work type</Label>
              <Select value={form.employee_type} onValueChange={(v) => setForm({ ...form, employee_type: v as EmpType })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="office">Office employee</SelectItem>
                  <SelectItem value="field">Field employee</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end md:col-span-2 lg:col-span-3">
              <Button type="submit" disabled={submitting} className="w-full md:w-auto">
                {submitting ? "Creating…" : "Create employee"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All staff ({employees.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground text-sm">Loading…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Work type</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {employees.map((emp) => (
                  <TableRow key={emp.id}>
                    <TableCell className="font-medium">
                      {emp.full_name || "—"}
                      {emp.id === user?.id && <Badge variant="secondary" className="ml-2">You</Badge>}
                    </TableCell>
                    <TableCell>{emp.phone || "—"}</TableCell>
                    <TableCell>{emp.employee_type ? <Badge variant={emp.employee_type === "field" ? "default" : "secondary"}>{emp.employee_type}</Badge> : "—"}</TableCell>
                    <TableCell>
                      <Select value={emp.role} onValueChange={(v) => updateRole(emp.id, v as Role)} disabled={emp.id === user?.id}>
                        <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(Object.keys(roleLabels) as Role[]).map((r) => (
                            <SelectItem key={r} value={r}>{roleLabels[r]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>{new Date(emp.created_at).toLocaleDateString()}</TableCell>
                    <TableCell>{emp.is_active ? <Badge>Active</Badge> : <Badge variant="destructive">Locked</Badge>}</TableCell>
                    <TableCell className="text-right">
                      {emp.id !== user?.id && (
                        <Button size="sm" variant={emp.is_active ? "destructive" : "default"} onClick={() => toggleActive(emp)}>
                          {emp.is_active ? "Deactivate" : "Activate"}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {employees.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No employees yet.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Employees;
