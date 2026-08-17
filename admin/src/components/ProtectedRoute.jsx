import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Button } from './ui/Button';
import { Layout } from './Layout';

export function ProtectedRoute({ children }) {
  const { session, isAdmin, loading, logout } = useAuth();

  // The app boot gate. `children` is <Layout /> too, so React reconciles this in place
  // rather than remounting -- the sidebar and header you see here are the ones that stay,
  // and only the content area swaps once the session and admin flag land.
  if (loading) return <Layout loading />;
  if (!session) return <Navigate to="/login" replace />;
  if (!isAdmin) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p className="text-sm text-text">This account isn't authorized for the admin dashboard.</p>
        <Button variant="secondary" onClick={logout}>Log out</Button>
      </div>
    );
  }

  return children;
}
