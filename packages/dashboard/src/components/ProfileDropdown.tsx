import { useState, useRef, useEffect } from "react";
import { useStore } from "../store.js";

export function ProfileDropdown() {
  const { user, config, syncing, authStep, authEmail, authError, beginLogin, cancelLogin, sendOtp, verifyOtp, logout, syncNow, loadUpdateCheck, updateInfo } = useStore();
  const [open, setOpen] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const dropRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const lastSync = config?.lastSyncAt
    ? new Date(config.lastSyncAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : null;

  if (authStep === "email") {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-800 p-6 shadow-2xl">
          <h2 className="mb-1 text-lg font-semibold text-slate-50">Sign in to useai</h2>
          <p className="mb-5 text-sm text-slate-400">We'll send a 6-digit code to your email.</p>
          <label className="label">Email address</label>
          <input
            className="input mb-4"
            type="email"
            placeholder="you@example.com"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void sendOtp(emailInput)}
            autoFocus
          />
          {authError && <p className="mb-3 text-sm text-red-400">{authError}</p>}
          <div className="flex gap-2">
            <button className="btn-primary flex-1" onClick={() => void sendOtp(emailInput)}>
              Send code
            </button>
            <button className="btn-ghost" onClick={cancelLogin}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (authStep === "code") {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-800 p-6 shadow-2xl">
          <h2 className="mb-1 text-lg font-semibold text-slate-50">Check your email</h2>
          <p className="mb-5 text-sm text-slate-400">
            Enter the 6-digit code sent to <span className="text-slate-200">{authEmail}</span>.
          </p>
          <label className="label">Verification code</label>
          <input
            className="input mb-4 text-center text-xl tracking-[0.4em]"
            type="text"
            inputMode="numeric"
            maxLength={6}
            placeholder="──────"
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value.replace(/\D/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && codeInput.length === 6 && void verifyOtp(codeInput)}
            autoFocus
          />
          {authError && <p className="mb-3 text-sm text-red-400">{authError}</p>}
          <div className="flex gap-2">
            <button
              className="btn-primary flex-1"
              disabled={codeInput.length !== 6}
              onClick={() => void verifyOtp(codeInput)}
            >
              Verify
            </button>
            <button className="btn-ghost" onClick={() => { cancelLogin(); setCodeInput(""); }}>
              Cancel
            </button>
          </div>
          <p className="mt-3 text-center text-xs text-slate-500">
            Wrong email?{" "}
            <button className="text-violet-400 hover:text-violet-300" onClick={() => { cancelLogin(); beginLogin(); }}>
              Start over
            </button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative" ref={dropRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-slate-300 transition hover:bg-slate-700"
      >
        {user ? (
          <>
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-violet-600 text-xs font-bold text-white">
              {(user.username ?? user.email)[0]?.toUpperCase()}
            </span>
            <span className="hidden sm:inline">{user.username ?? user.email}</span>
          </>
        ) : (
          <span className="text-slate-400">Sign in</span>
        )}
        <svg className="h-3 w-3 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-10 z-40 w-64 rounded-xl border border-slate-700 bg-slate-800 py-1 shadow-2xl">
          {user ? (
            <>
              <div className="border-b border-slate-700 px-4 py-3">
                <p className="text-sm font-medium text-slate-100">{user.username ?? user.email}</p>
                <p className="text-xs text-slate-400">{user.email}</p>
              </div>

              <div className="px-4 py-3">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Sync</p>
                {lastSync && (
                  <p className="mb-2 text-xs text-slate-400">Last synced: {lastSync}</p>
                )}
                <button
                  className="btn-ghost w-full justify-center text-xs"
                  disabled={syncing}
                  onClick={() => void syncNow()}
                >
                  {syncing ? "Syncing…" : "Sync now"}
                </button>
              </div>

              {updateInfo?.hasUpdate && (
                <div className="border-t border-slate-700 px-4 py-3">
                  <p className="text-xs text-amber-400">
                    Update available: v{updateInfo.latestVersion}
                  </p>
                </div>
              )}

              <div className="border-t border-slate-700 px-2 py-1">
                <button
                  className="btn-ghost w-full justify-start text-xs text-red-400 hover:bg-red-900/20 hover:text-red-300"
                  onClick={async () => { await logout(); setOpen(false); }}
                >
                  Sign out
                </button>
              </div>
            </>
          ) : (
            <div className="px-2 py-1">
              <button
                className="btn-ghost w-full justify-start text-sm"
                onClick={() => { beginLogin(); setOpen(false); }}
              >
                Sign in with email
              </button>
              {updateInfo === null && (
                <button
                  className="btn-ghost w-full justify-start text-xs text-slate-500"
                  onClick={() => void loadUpdateCheck()}
                >
                  Check for updates
                </button>
              )}
              {updateInfo?.hasUpdate && (
                <p className="px-2 py-1 text-xs text-amber-400">
                  v{updateInfo.latestVersion} available
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
