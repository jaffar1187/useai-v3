import { getConfig, patchConfig } from "@devness/useai-storage";
import { sendOtp, verifyOtp, checkUsername, claimUsername } from "@devness/useai-cloud";

export async function login(email: string, code: string) {
  const auth = await verifyOtp(email, code);
  await patchConfig({ auth: { token: auth.token, user: { id: auth.user.id, email: auth.user.email, username: auth.user.username } }, sync: { enabled: true, autoSync: true, intervalMinutes: 30 } });
  return auth;
}

export { sendOtp, checkUsername, claimUsername };

export async function logout(): Promise<void> {
  const config = await getConfig();
  await patchConfig({ ...config, auth: {} });
}

export async function getAuthToken(): Promise<string | null> {
  const config = await getConfig();
  return config.auth.token ?? null;
}
