import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import AppLayout from "@/components/app/AppLayout";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import Clients from "./pages/Clients";
import Loans from "./pages/Loans";
import Payments from "./pages/Payments";
import Transactions from "./pages/Transactions";
import Reports from "./pages/Reports";
import Employees from "./pages/Employees";
import NewClient from "./pages/clients/NewClient";
import ManageClients from "./pages/clients/ManageClients";
import ClientBook from "./pages/clients/ClientBook";
import GiveLoan from "./pages/loans/GiveLoan";
import RenewLoan from "./pages/loans/RenewLoan";
import AddFine from "./pages/loans/AddFine";
import DailyReport from "./pages/reports/DailyReport";
import ClientsNotPaid from "./pages/reports/ClientsNotPaid";
import ClientsWithLoans from "./pages/reports/ClientsWithLoans";
import ClientsWithoutLoans from "./pages/reports/ClientsWithoutLoans";
import AllLoans from "./pages/reports/AllLoans";
import ComplicatedLoans from "./pages/reports/ComplicatedLoans";
import RenewedLoans from "./pages/reports/RenewedLoans";
import Settings from "./pages/Settings";
import Messages from "./pages/clients/Messages";
import Businesses from "./pages/Businesses";
import DeveloperDashboard from "./pages/developer/DeveloperDashboard";
import DeveloperAdmins from "./pages/developer/DeveloperAdmins";
import AdminBusinessesView from "./pages/developer/AdminBusinesses";
import AdminDashboard from "./pages/admin/AdminDashboard";
import BusinessBilling from "./pages/admin/BusinessBilling";
import Subscription from "./pages/Subscription";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const RoleRedirect = () => {
  const { user, loading, isSuperAdmin, isPlatformAdmin } = useAuth();
  if (loading) return <div className="min-h-screen grid place-items-center text-muted-foreground">Loading…</div>;
  if (!user) return <Navigate to="/auth" replace />;
  if (isSuperAdmin) return <Navigate to="/developer" replace />;
  if (isPlatformAdmin) return <Navigate to="/admin" replace />;
  return <Navigate to="/dashboard" replace />;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<RoleRedirect />} />
            <Route path="/auth" element={<Auth />} />
            <Route element={<AppLayout />}>
              {/* Developer portal */}
              <Route path="/developer" element={<DeveloperDashboard />} />
              <Route path="/developer/admins" element={<DeveloperAdmins />} />
              <Route path="/developer/admins/:id" element={<AdminBusinessesView />} />
              <Route path="/developer/reports" element={<Reports />} />
              <Route path="/developer/settings" element={<Settings />} />

              {/* Platform admin portal */}
              <Route path="/admin" element={<AdminDashboard />} />
              <Route path="/admin/businesses" element={<Businesses />} />
              <Route path="/admin/payments" element={<Payments />} />
              <Route path="/admin/transactions" element={<Transactions />} />
              <Route path="/admin/settings" element={<Settings />} />

              {/* Business user routes */}
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/clients" element={<Clients />} />
              <Route path="/clients/new" element={<NewClient />} />
              <Route path="/clients/manage" element={<ManageClients />} />
              <Route path="/clients/book" element={<ClientBook />} />
              <Route path="/clients/messages" element={<Messages />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/subscription" element={<Subscription />} />
              <Route path="/loans" element={<Loans />} />
              <Route path="/loans/new" element={<GiveLoan />} />
              <Route path="/loans/renew" element={<RenewLoan />} />
              <Route path="/loans/fine" element={<AddFine />} />
              <Route path="/payments" element={<Payments />} />
              <Route path="/transactions" element={<Transactions />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/reports/daily" element={<DailyReport />} />
              <Route path="/reports/not-paid" element={<ClientsNotPaid />} />
              <Route path="/reports/with-loans" element={<ClientsWithLoans />} />
              <Route path="/reports/without-loans" element={<ClientsWithoutLoans />} />
              <Route path="/reports/all-loans" element={<AllLoans />} />
              <Route path="/reports/complicated" element={<ComplicatedLoans />} />
              <Route path="/reports/renewed" element={<RenewedLoans />} />
              <Route path="/employees" element={<Employees />} />
              <Route path="/businesses" element={<Businesses />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
