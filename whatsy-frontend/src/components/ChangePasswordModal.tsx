import { useState } from 'react';
import { getAuthHeader, API_BASE } from '../api/inbox';

interface ChangePasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  // If targetAgent is passed, caller is setting new password for targetAgent without old password
  targetAgent?: {
    id: string;
    name: string;
  } | null;
}

export default function ChangePasswordModal({
  isOpen,
  onClose,
  targetAgent,
}: ChangePasswordModalProps) {
  const isTargetingOther = Boolean(targetAgent);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (!isTargetingOther && !oldPassword) {
      setError('Current password is required');
      return;
    }

    setLoading(true);

    try {
      if (isTargetingOther && targetAgent) {
        // Admin setting password for another agent
        const res = await fetch(`${API_BASE}/v1/agents/${targetAgent.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
          body: JSON.stringify({ password: newPassword }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || `Failed to update password [${res.status}]`);
        }
      } else {
        // Self change password
        const res = await fetch(`${API_BASE}/v1/agents/me/password`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
          body: JSON.stringify({ oldPassword, newPassword }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || `Failed to update password [${res.status}]`);
        }
      }

      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        setOldPassword('');
        setNewPassword('');
        setConfirmPassword('');
        onClose();
      }, 1500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setError('');
    setSuccess(false);
    setOldPassword('');
    setNewPassword('');
    setConfirmPassword('');
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-[#111b21] rounded-2xl border border-gray-200 dark:border-[#222e35] w-full max-w-md shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-[#222e35]">
          <h2 className="text-lg font-bold text-gray-900 dark:text-[#e9edef]">
            {isTargetingOther ? `Set Password for ${targetAgent?.name}` : 'Change Password'}
          </h2>
          <button
            type="button"
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-[#e9edef] transition"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Content */}
        {success ? (
          <div className="flex flex-col items-center gap-3 py-10 px-6">
            <div className="w-12 h-12 rounded-full bg-[#00a884]/15 flex items-center justify-center">
              <svg className="w-6 h-6 text-[#00a884]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <p className="text-gray-900 dark:text-[#e9edef] font-semibold">Password updated successfully!</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {error && (
              <div className="text-red-500 dark:text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            {!isTargetingOther && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-[#8696a0] mb-1.5">
                  Current Password
                </label>
                <input
                  type="password"
                  required
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  placeholder="Enter current password"
                  className="w-full bg-gray-50 dark:bg-[#202c33] border border-gray-200 dark:border-[#374151] text-gray-900 dark:text-[#e9edef] placeholder-gray-400 dark:placeholder-[#8696a0] rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#00a884]"
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-[#8696a0] mb-1.5">
                New Password
              </label>
              <input
                type="password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Min. 8 characters"
                className="w-full bg-gray-50 dark:bg-[#202c33] border border-gray-200 dark:border-[#374151] text-gray-900 dark:text-[#e9edef] placeholder-gray-400 dark:placeholder-[#8696a0] rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#00a884]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-[#8696a0] mb-1.5">
                Confirm New Password
              </label>
              <input
                type="password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter new password"
                className="w-full bg-gray-50 dark:bg-[#202c33] border border-gray-200 dark:border-[#374151] text-gray-900 dark:text-[#e9edef] placeholder-gray-400 dark:placeholder-[#8696a0] rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#00a884]"
              />
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={handleClose}
                className="flex-1 py-2.5 border border-gray-200 dark:border-[#374151] text-gray-700 dark:text-[#8696a0] rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-[#202c33] transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 py-2.5 bg-[#00a884] hover:bg-[#00967a] disabled:opacity-50 text-white rounded-lg text-sm font-medium transition flex items-center justify-center gap-2"
              >
                {loading && (
                  <svg className="animate-spin w-4 h-4 text-white" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                )}
                {loading ? 'Updating…' : 'Update Password'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
