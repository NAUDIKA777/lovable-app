import { createServerFn } from "@tanstack/react-start";
import { isValidPinShape, sanitizePin } from "./listing-rules";
import { checkPin, clearUnlockCookie, isUnlocked, issueUnlockCookie } from "./session.server";

export const getLockState = createServerFn({ method: "GET" }).handler(async () => ({ unlocked: await isUnlocked() }));

export const unlock = createServerFn({ method: "POST" })
  .inputValidator((d: { pin: string }) => ({ pin: sanitizePin(String(d?.pin ?? "")) }))
  .handler(async ({ data }) => {
    if (!isValidPinShape(data.pin)) return { ok: false, error: "Enter all 6 digits." };
    if (!(await checkPin(data.pin))) return { ok: false, error: "Wrong PIN. Try again." };
    await issueUnlockCookie();
    return { ok: true, error: null };
  });

export const lock = createServerFn({ method: "POST" }).handler(async () => {
  clearUnlockCookie();
  return { ok: true };
});
