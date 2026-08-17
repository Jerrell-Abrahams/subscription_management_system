import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Mail } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Logo } from '../components/Logo';

export function Login() {
  const { session, login, loginWithLink } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sendingLink, setSendingLink] = useState(false);

  if (session) return <Navigate to="/" replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    const { error } = await login(email, password);
    setSubmitting(false);
    if (error) toast.error(error.message);
  }

  // The password field is `required`, so this can't go through the form's submit -- it
  // reads the email box directly and does its own check.
  async function handleMagicLink() {
    if (!email) {
      toast.error('Enter your email address first.');
      return;
    }
    setSendingLink(true);
    const { error } = await loginWithLink(email);
    setSendingLink(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Sign-in link sent to ${email}. It expires in an hour.`);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-12 text-text">
      <div className="flex w-full max-w-[340px] flex-col gap-7">
        <Logo className="h-[64px] self-center" />

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] text-muted">Email</span>
            <Input
              type="email"
              autoComplete="email"
              className="h-[38px]"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] text-muted">Password</span>
            <Input
              type="password"
              autoComplete="current-password"
              className="h-[38px]"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>

          <Button type="submit" disabled={submitting} className="h-[38px] w-full">
            {submitting ? 'Signing in…' : 'Continue'}
          </Button>

          <div className="flex items-center gap-3 text-[11px] uppercase tracking-[0.1em] text-dim">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>

          <Button
            type="button"
            variant="secondary"
            onClick={handleMagicLink}
            disabled={sendingLink}
            className="h-[38px] w-full"
          >
            <Mail size={16} /> {sendingLink ? 'Sending…' : 'Email me a sign-in link'}
          </Button>
        </form>

        <p className="border-t border-border pt-4 text-[12px] text-dim">
          Protected area. Every sign-in is logged to the audit trail.
        </p>
      </div>
    </div>
  );
}
