import { useStore } from "../store.js";
import type { UseaiConfig } from "../lib/api.js";

function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-3">
      <div>
        <p className="text-sm font-medium text-slate-200">{label}</p>
        {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
      </div>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={[
          "relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
          checked ? "bg-violet-600" : "bg-slate-600",
        ].join(" ")}
      >
        <span
          className={[
            "inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-4" : "translate-x-1",
          ].join(" ")}
        />
      </button>
    </label>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-400">
        {title}
      </h3>
      <div className="divide-y divide-slate-700/50">{children}</div>
    </div>
  );
}

export function SettingsPage() {
  const { config, patchConfig, user, logout, syncNow, syncing } = useStore();

  if (!config) {
    return (
      <div className="card animate-pulse h-48 bg-slate-800/40" />
    );
  }

  async function update(patch: Partial<UseaiConfig>) {
    await patchConfig(patch);
  }

  const capture = config.capture ?? { prompt: false, promptImages: false, evaluation: true, milestones: true, reasonsLevel: "none" };
  const sync = config.sync ?? { enabled: false, autoSync: false, intervalMinutes: 30 };
  const framework = config.evaluation?.framework ?? "space";

  return (
    <div className="space-y-5">
      {/* Evaluation framework */}
      <Section title="Evaluation Framework">
        <div className="py-3">
          <p className="mb-2 text-xs text-slate-500">
            How sessions are scored after each conversation.
          </p>
          <div className="flex gap-2">
            {(["space", "aps", "raw"] as const).map((f) => (
              <button
                key={f}
                onClick={() => void update({ evaluation: { framework: f } })}
                className={[
                  "rounded-lg border px-4 py-2 text-sm font-medium transition-colors",
                  framework === f
                    ? "border-violet-500 bg-violet-900/40 text-violet-300"
                    : "border-slate-600 text-slate-400 hover:border-slate-500 hover:text-slate-200",
                ].join(" ")}
              >
                {f.toUpperCase()}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-600">
            {framework === "space"
              ? "SPACE: Satisfaction, Performance, Activity, Communication, Efficiency"
              : framework === "aps"
                ? "APS: Aggregate performance score across 5 weighted dimensions"
                : "Raw: Direct evaluation pass-through with simple average"}
          </p>
        </div>
      </Section>

      {/* Capture settings */}
      <Section title="Data Capture">
        <Toggle
          label="Capture prompt text"
          description="Store the full prompt locally. Never sent to cloud."
          checked={capture.prompt}
          onChange={(v) => void update({ capture: { ...capture, prompt: v } })}
        />
        <Toggle
          label="Capture prompt images"
          description="Store attached images locally. Never sent to cloud."
          checked={capture.promptImages}
          onChange={(v) => void update({ capture: { ...capture, promptImages: v } })}
        />
        <Toggle
          label="Capture evaluation details"
          description="Store per-session evaluation scores and reasons."
          checked={capture.evaluation}
          onChange={(v) => void update({ capture: { ...capture, evaluation: v } })}
        />
        <Toggle
          label="Capture milestones"
          description="Store milestone titles and categories in session records."
          checked={capture.milestones}
          onChange={(v) => void update({ capture: { ...capture, milestones: v } })}
        />
        <div className="py-3">
          <label className="label">Reasons detail level</label>
          <select
            value={capture.reasonsLevel ?? "none"}
            onChange={(e) =>
              void update({ capture: { ...capture, reasonsLevel: e.target.value as "none" | "summary" | "detailed" } })
            }
            className="input w-auto"
          >
            <option value="none">None — no reason text stored</option>
            <option value="summary">Summary — brief reason notes</option>
            <option value="detailed">Detailed — complete reason text</option>
          </select>
        </div>
      </Section>

      {/* Cloud sync */}
      <Section title="Cloud Sync">
        {user ? (
          <>
            <div className="py-3">
              <p className="text-sm text-slate-300">
                Signed in as <span className="font-medium text-violet-300">{user.username ?? user.email}</span>
              </p>
              {config.lastSyncAt && (
                <p className="mt-0.5 text-xs text-slate-500">
                  Last sync: {new Date(config.lastSyncAt).toLocaleString()}
                </p>
              )}
            </div>
            <Toggle
              label="Enable sync"
              description="Sync sessions to the useai cloud for leaderboard and cross-device access."
              checked={sync.enabled}
              onChange={(v) => void update({ sync: { ...sync, enabled: v } })}
            />
            <Toggle
              label="Auto sync"
              description="Automatically sync sessions in the background."
              checked={sync.autoSync}
              onChange={(v) => void update({ sync: { ...sync, autoSync: v } })}
            />
            {sync.autoSync && (
              <div className="py-3">
                <label className="label">Sync interval (minutes)</label>
                <input
                  type="number"
                  min={5}
                  max={1440}
                  value={sync.intervalMinutes}
                  onChange={(e) =>
                    void update({ sync: { ...sync, intervalMinutes: Number(e.target.value) } })
                  }
                  className="input w-32"
                />
              </div>
            )}
            <div className="py-3">
              <button
                className="btn-primary"
                disabled={syncing || !sync.enabled}
                onClick={() => void syncNow()}
              >
                {syncing ? "Syncing…" : "Sync now"}
              </button>
            </div>
          </>
        ) : (
          <div className="py-4">
            <p className="text-sm text-slate-400">
              Sign in to enable cloud sync and access the leaderboard.
            </p>
            <p className="mt-1 text-xs text-slate-600">
              Use the profile menu in the top-right corner to sign in.
            </p>
          </div>
        )}
      </Section>

      {/* Daemon settings */}
      <Section title="Daemon">
        <div className="py-3">
          <label className="label">Port</label>
          <input
            type="number"
            value={config.daemon?.port ?? 19200}
            onChange={(e) =>
              void update({ daemon: { ...config.daemon, port: Number(e.target.value) } })
            }
            className="input w-32"
          />
          <p className="mt-1 text-xs text-slate-600">
            Requires daemon restart to take effect.
          </p>
        </div>
        <div className="py-3">
          <label className="label">Idle timeout (minutes)</label>
          <input
            type="number"
            min={1}
            value={config.daemon?.idleTimeoutMinutes ?? 30}
            onChange={(e) =>
              void update({
                daemon: { ...config.daemon, idleTimeoutMinutes: Number(e.target.value) },
              })
            }
            className="input w-32"
          />
        </div>
      </Section>

      {/* Danger zone */}
      {user && (
        <Section title="Danger Zone">
          <div className="py-3">
            <p className="mb-2 text-sm text-slate-400">
              Sign out of your useai account. Local sessions are not deleted.
            </p>
            <button className="btn-danger" onClick={() => void logout()}>
              Sign out
            </button>
          </div>
        </Section>
      )}
    </div>
  );
}
