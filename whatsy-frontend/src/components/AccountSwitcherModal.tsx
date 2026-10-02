import React, { useState, useEffect } from 'react';
import { getCurrentAgent, getSavedAccounts, switchAccount, logoutCurrentAccount, SavedAccount } from '../lib/auth';
import { useT } from '../i18n/translations';
import ChangePasswordModal from './ChangePasswordModal';

interface AccountSwitcherModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AccountSwitcherModal: React.FC<AccountSwitcherModalProps> = ({ isOpen, onClose }) => {
  const t = useT();
  const [currentAgent, setCurrentAgent] = useState(() => getCurrentAgent());
  const [accounts, setAccounts] = useState<SavedAccount[]>(() => getSavedAccounts());
  const [showPasswordModal, setShowPasswordModal] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setCurrentAgent(getCurrentAgent());
      setAccounts(getSavedAccounts());
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleRemoveAccount = (e: React.MouseEvent, accId: string) => {
    e.stopPropagation();
    const updated = accounts.filter(a => a.id !== accId);
    setAccounts(updated);
    localStorage.setItem('whatsy_accounts', JSON.stringify(updated));
  };

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4 transition-opacity animate-in fade-in"
        onClick={onClose}
      >
        <div
          className="bg-white dark:bg-[#1f2c33] w-full max-w-sm rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden border border-gray-100 dark:border-[#2a3942] transition-all"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3.5 border-b border-gray-100 dark:border-[#2a3942]">
            <span className="font-semibold text-gray-900 dark:text-[#e9edef] text-base">{t.switch_account || 'Switch Account'}</span>
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-full text-gray-400 hover:text-gray-600 dark:hover:text-[#e9edef] hover:bg-black/5 dark:hover:bg-white/5 transition"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Accounts List */}
          <div className="p-3 max-h-[50vh] overflow-y-auto space-y-1.5">
            {accounts.map((acc) => {
              const isActive = acc.id === currentAgent?.id;
              const initials = acc.name ? acc.name.slice(0, 2).toUpperCase() : '?';

              return (
                <div
                  key={acc.id}
                  onClick={() => {
                    if (!isActive) switchAccount(acc);
                    else onClose();
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all cursor-pointer ${
                    isActive
                      ? 'bg-[#00a884]/10 dark:bg-[#00a884]/20 border border-[#00a884]/30'
                      : 'hover:bg-gray-100 dark:hover:bg-[#2a3942] border border-transparent'
                  }`}
                >
                  <div className="w-10 h-10 rounded-full bg-[#00a884] flex items-center justify-center text-white text-sm font-bold shrink-0 shadow-sm">
                    {initials}
                  </div>
                  <div className="min-w-0 flex-1 text-start">
                    <div className="flex items-center gap-1.5">
                      <p className="text-gray-900 dark:text-[#e9edef] text-sm font-semibold truncate leading-tight">
                        {acc.name}
                      </p>
                      <span className="text-[10px] uppercase font-bold px-1.5 py-0.2 rounded bg-gray-200 dark:bg-[#2a3942] text-gray-600 dark:text-[#aebac1]">
                        {acc.role}
                      </span>
                    </div>
                    <p className="text-gray-500 dark:text-[#8696a0] text-xs truncate mt-0.5">
                      {acc.email}
                    </p>
                  </div>
                  {isActive ? (
                    <div className="w-6 h-6 rounded-full bg-[#00a884] flex items-center justify-center text-white shrink-0">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => handleRemoveAccount(e, acc.id)}
                      title="Remove from saved accounts"
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-black/5 dark:hover:bg-white/5 opacity-60 hover:opacity-100 transition shrink-0"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Action Footer */}
          <div className="border-t border-gray-100 dark:border-[#2a3942] p-3 space-y-1">
            <button
              type="button"
              onClick={() => {
                onClose();
                window.location.href = '/login';
              }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-gray-800 dark:text-[#e9edef] hover:bg-gray-100 dark:hover:bg-[#2a3942] transition font-medium text-sm text-start cursor-pointer"
            >
              <div className="w-8 h-8 rounded-full bg-gray-100 dark:bg-[#2a3942] flex items-center justify-center text-[#00a884] shrink-0">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              </div>
              <span>{t.add_account || 'Add account'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setShowPasswordModal(true);
              }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-gray-800 dark:text-[#e9edef] hover:bg-gray-100 dark:hover:bg-[#2a3942] transition font-medium text-sm text-start cursor-pointer"
            >
              <div className="w-8 h-8 rounded-full bg-gray-100 dark:bg-[#2a3942] flex items-center justify-center text-gray-500 dark:text-[#8696a0] shrink-0">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
              </div>
              <span>{t.nav_change_password || 'Change password'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                onClose();
                logoutCurrentAccount();
              }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 transition font-medium text-sm text-start cursor-pointer"
            >
              <div className="w-8 h-8 rounded-full bg-red-100 dark:bg-red-950/30 flex items-center justify-center text-red-500 shrink-0">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </div>
              <span>{t.nav_sign_out || 'Sign out'}</span>
            </button>
          </div>
        </div>
      </div>

      <ChangePasswordModal
        isOpen={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
      />
    </>
  );
};

export default AccountSwitcherModal;
