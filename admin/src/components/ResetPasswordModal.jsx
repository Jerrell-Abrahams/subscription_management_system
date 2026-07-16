import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { generatePassword, resetPassword } from '../adminApi';

export function ResetPasswordModal({ open, onOpenChange, user }) {
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (open) {
      setPassword(generatePassword());
      setDone(false);
    }
  }, [open]);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await resetPassword(user.id, password);
      toast.success(`Password reset for ${user.email}.`);
      setDone(true);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!user) return null;

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={`Reset password for ${user.email}`}>
      {done ? (
        <div className="space-y-3">
          <p className="text-sm text-text">
            New password:{' '}
            <code className="rounded bg-bg-alt px-1.5 py-0.5 font-mono text-text-h">{password}</code>
          </p>
          <p className="text-xs text-text/70">Save this now — it won't be shown again.</p>
          <div className="flex justify-end">
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="flex gap-2">
            <Input value={password} onChange={(e) => setPassword(e.target.value)} required />
            <Button type="button" variant="secondary" onClick={() => setPassword(generatePassword())}>
              Generate
            </Button>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Resetting…' : 'Reset password'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
