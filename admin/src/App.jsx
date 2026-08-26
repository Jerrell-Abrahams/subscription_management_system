import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { MotionConfig } from 'motion/react';
import { Toaster } from 'sonner';
import { AuthProvider } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Subscriptions } from './pages/Subscriptions';
import { SubscriptionDetail } from './pages/SubscriptionDetail';
import { Websites } from './pages/Websites';
import { Users } from './pages/Users';
import { Products } from './pages/Products';
import { Updates } from './pages/Updates';
import { Analytics } from './pages/Analytics';
import { Leads } from './pages/Leads';
import { Finance } from './pages/Finance';
import { Invoices } from './pages/Invoices';
import { Documents } from './pages/Documents';
import { QrCodes } from './pages/QrCodes';
import { Settings } from './pages/Settings';

export default function App() {
  return (
    // reducedMotion="user" makes every motion component below honour the OS setting; the
    // CSS keyframes are covered separately by the media query in index.css.
    <MotionConfig reducedMotion="user">
      <BrowserRouter>
        <Toaster richColors position="top-right" theme="system" />
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route path="/" element={<Dashboard />} />
              <Route path="/subscriptions" element={<Subscriptions />} />
              <Route path="/subscriptions/:id" element={<SubscriptionDetail />} />
              <Route path="/websites" element={<Websites />} />
              <Route path="/users" element={<Users />} />
              <Route path="/products" element={<Products />} />
              <Route path="/updates" element={<Updates />} />
              <Route path="/analytics" element={<Analytics />} />
              <Route path="/leads" element={<Leads />} />
              <Route path="/finance" element={<Finance />} />
              <Route path="/invoices" element={<Invoices />} />
              <Route path="/documents" element={<Documents />} />
              <Route path="/qr-codes" element={<QrCodes />} />
              <Route path="/settings" element={<Settings />} />
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </MotionConfig>
  );
}
