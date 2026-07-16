import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Lock, Mail } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';

export function Login() {
  const { session, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  if (session) return <Navigate to="/" replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    const { error } = await login(email, password);
    if (error) toast.error(error.message);
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Card className="w-80">
        <h1 className="mb-5 text-lg font-semibold text-text-h">license-platform admin</h1>
        <form onSubmit={handleSubmit} className="space-y-3">
          <Input
            icon={Mail}
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Input
            icon={Lock}
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <Button type="submit" className="w-full">
            Log in
          </Button>
        </form>
      </Card>
    </div>
  );
}
