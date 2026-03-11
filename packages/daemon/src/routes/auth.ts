import { Hono } from "hono";
import { sendOtp, verifyOtp } from "@devness/useai-cloud";
import { getConfig, patchConfig } from "@devness/useai-storage";

export const authRoutes = new Hono();

authRoutes.post("/send-otp", async (c) => {
  const { email } = await c.req.json<{ email: string }>();
  try {
    await sendOtp(email);
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

authRoutes.post("/verify-otp", async (c) => {
  const { email, code } = await c.req.json<{ email: string; code: string }>();
  try {
    const result = await verifyOtp(email, code);
    await patchConfig({ auth: { token: result.token, user: result.user } });
    return c.json({ ok: true, data: { user: result.user } });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 400);
  }
});

authRoutes.post("/logout", async (c) => {
  const config = await getConfig();
  await patchConfig({ ...config, auth: {} });
  return c.json({ ok: true });
});
