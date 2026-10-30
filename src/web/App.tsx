import { Navigate, Route, Routes } from 'react-router';
import { AuthProvider, RequireAuth } from './auth';
import { Layout } from './components/Layout';
import { PrefsProvider } from './prefs';
import { BillsPage } from './pages/BillsPage';
import { RecurringPage } from './pages/RecurringPage';
import { ReportsPage } from './pages/ReportsPage';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { SettingsPage } from './pages/SettingsPage';
import { SourcesPage } from './pages/SourcesPage';
import { TransaksiPage } from './pages/TransaksiPage';
import { AskPage } from './pages/AskPage';
import { BudgetsPage } from './pages/BudgetsPage';
import { LoansPage } from './pages/LoansPage';
import { ProfilePage } from './pages/ProfilePage';

export function App() {
  return (
    <PrefsProvider>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/masuk" element={<Navigate to="/login" replace />} />
          <Route element={<RequireAuth />}>
            <Route element={<Layout />}>
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="dashboard" element={<DashboardPage />} />
              {/* Add expense lives on Home now: the add link opens its form there. */}
              <Route path="add" element={<Navigate to="/dashboard?add=1" replace />} />
              <Route path="transactions" element={<TransaksiPage />} />
              <Route path="categories" element={<Navigate to="/settings" replace />} />
              <Route path="installments" element={<RecurringPage />} />
              <Route path="bills" element={<BillsPage />} />
              <Route path="budgets" element={<BudgetsPage />} />
              <Route path="loans" element={<LoansPage />} />
              <Route path="reports" element={<ReportsPage />} />
              <Route path="ask" element={<AskPage />} />
              <Route path="profile" element={<ProfilePage />} />
              <Route path="sources" element={<SourcesPage />} />
              <Route path="settings" element={<SettingsPage />} />
              {/* Old Indonesian paths keep working: bookmarks and installed copies still point at them. */}
              <Route path="catat" element={<Navigate to="/add" replace />} />
              <Route path="transaksi" element={<Navigate to="/transactions" replace />} />
              <Route path="cicilan" element={<Navigate to="/installments" replace />} />
              <Route path="tagihan" element={<Navigate to="/bills" replace />} />
              <Route path="laporan" element={<Navigate to="/reports" replace />} />
              <Route path="tanya" element={<Navigate to="/ask" replace />} />
              <Route path="pengaturan" element={<Navigate to="/settings" replace />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </PrefsProvider>
  );
}
