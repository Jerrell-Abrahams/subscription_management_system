import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Button } from './ui/Button';

export function ProtectedRoute({ children }) {
  const { session, isAdmin, loading, logout } = useAuth();

  if (loading) return <p className="p-10 text-center text-sm text-text/70">Loading…</p>;
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
