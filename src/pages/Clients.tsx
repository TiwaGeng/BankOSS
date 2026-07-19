import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Trash2, Printer, FileSpreadsheet, FileText, FileDown, BookOpen, IdCard } from "lucide-react";
import { toast } from "sonner";
import { exportExcel, exportPDF, exportWord, printRows } from "@/lib/exporters";

interface Client {
  id: string; full_name: string; last_name: string | null; phone: string | null;
  customer_type: "field" | "office"; address: string | null; notes: string | null; created_at: string;
}

const Clients = () => {
  const { hasRole } = useAuth();
  const nav = useNavigate();
  const canDelete = hasRole("admin");
  const [items, setItems] = useState<Client[]>([]);
  const [search, setSearch] = useState("");
  const [bio, setBio] = useState<Client | null>(null);

  const load = async () => {
    const { data, error } = await supabase.from("clients").select("*").order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setItems(((data as unknown) as Client[]) ?? []);
  };
  useEffect(() => { load(); }, []);

  const remove = async (id: string) => {
    if (!confirm("Delete this client?")) return;
    const { error } = await supabase.from("clients").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Deleted");
    load();
  };

  const filtered = items.filter((c) => {
    const q = search.toLowerCase();
    return !q || c.full_name.toLowerCase().includes(q) || (c.last_name ?? "").toLowerCase().includes(q) || (c.phone ?? "").includes(q);
  });

  const exportRows = () => filtered.map((c) => ({
    Name: c.full_name, "Last Name": c.last_name ?? "", Phone: c.phone ?? "",
    Type: c.customer_type, Address: c.address ?? "",
  }));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">Client List</h1>
          <p className="text-muted-foreground">{items.length} total · {filtered.length} shown</p>
        </div>
        <Input placeholder="Search any client (name, phone)…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-72" />
      </header>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => printRows(exportRows(), "Client List")}><Printer className="h-4 w-4 mr-1" /> Print</Button>
        <Button size="sm" variant="outline" onClick={() => exportExcel(exportRows(), "clients")}><FileSpreadsheet className="h-4 w-4 mr-1" /> Excel</Button>
        <Button size="sm" variant="outline" onClick={() => exportWord(exportRows(), "clients", "Client List")}><FileText className="h-4 w-4 mr-1" /> Word</Button>
        <Button size="sm" variant="outline" onClick={() => exportPDF(exportRows(), "clients", "Client List")}><FileDown className="h-4 w-4 mr-1" /> PDF</Button>
      </div>

      <div className="bg-card border rounded-xl shadow-soft overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Last name</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Business address</TableHead>
              <TableHead className="w-64">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-10">No clients</TableCell></TableRow>
            ) : filtered.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.full_name}</TableCell>
                <TableCell>{c.last_name || "—"}</TableCell>
                <TableCell>{c.phone || "—"}</TableCell>
                <TableCell><Badge variant={c.customer_type === "field" ? "default" : "secondary"}>{c.customer_type}</Badge></TableCell>
                <TableCell>{c.address || "—"}</TableCell>
                <TableCell>
                  <div className="flex gap-1 flex-wrap">
                    <Button size="sm" variant="outline" onClick={() => setBio(c)}><IdCard className="h-3.5 w-3.5 mr-1" /> Bio Data</Button>
                    <Button size="sm" variant="outline" onClick={() => nav(`/clients/book?id=${c.id}`)}><BookOpen className="h-3.5 w-3.5 mr-1" /> Client Book</Button>
                    {canDelete && <Button variant="ghost" size="icon" onClick={() => remove(c.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!bio} onOpenChange={(o) => !o && setBio(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Client Bio Data</DialogTitle></DialogHeader>
          {bio && (
            <dl className="grid grid-cols-3 gap-y-3 text-sm">
              <dt className="text-muted-foreground">First name</dt><dd className="col-span-2 font-medium">{bio.full_name}</dd>
              <dt className="text-muted-foreground">Last name</dt><dd className="col-span-2 font-medium">{bio.last_name || "—"}</dd>
              <dt className="text-muted-foreground">Phone</dt><dd className="col-span-2">{bio.phone || "—"}</dd>
              <dt className="text-muted-foreground">Customer type</dt><dd className="col-span-2">{bio.customer_type}</dd>
              <dt className="text-muted-foreground">Business address</dt><dd className="col-span-2">{bio.address || "—"}</dd>
              <dt className="text-muted-foreground">Notes</dt><dd className="col-span-2">{bio.notes || "—"}</dd>
              <dt className="text-muted-foreground">Registered</dt><dd className="col-span-2">{new Date(bio.created_at).toLocaleString()}</dd>
            </dl>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Clients;
