import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import { authClient } from "../lib/auth";
import { useDeleteAccount, useMe } from "../queries/account";

const REAUTH_WINDOW_MS = 15 * 60000;

/** Permanent account deletion. Requires a sign-in from the last 15 minutes and typing DELETE. */
export function DeleteAccount() {
  const me = useMe(true), remove = useDeleteAccount(), q = useQueryClient();
  const [open, setOpen] = useState(false), [confirm, setConfirm] = useState("");
  const recent = !!me.data && Date.now() - me.data.sessionCreatedAt < REAUTH_WINDOW_MS;
  async function destroy() {
    try {
      await remove.mutateAsync({ confirm: "DELETE" });
      q.clear();
      await authClient.signOut().catch(() => undefined);
      window.location.href = "/";
    } catch { /* shown below */ }
  }
  if (!open) return <button className="ghost danger-link" onClick={() => setOpen(true)}><Trash2 size={15} /> Delete my account</button>;
  return (
    <section className="danger-zone">
      <strong>Delete your account permanently</strong>
      <p>This removes your sign-in, narrations, videos, uploaded clips, favorites, cloned voices and every remaining credit. Credits cannot be restored or refunded. Payment records without your name or email are kept for accounting.</p>
      {remove.isError && <p className="error">{remove.error.message}</p>}
      {!recent ? (
        <>
          <p className="muted">For your security, sign in again first. You then have 15 minutes to delete the account.</p>
          <button className="action" onClick={async () => { await authClient.signOut(); window.location.href = "/sign-in"; }}>Sign in again</button>
        </>
      ) : (
        <>
          <label className="field">Type DELETE to confirm<input value={confirm} onChange={e => setConfirm(e.target.value)} aria-label="Type DELETE to confirm" /></label>
          <div className="danger-actions">
            <button className="ghost" onClick={() => setOpen(false)}>Cancel</button>
            <button className="action danger" disabled={confirm !== "DELETE" || remove.isPending} onClick={destroy}>
              {remove.isPending ? <Loader2 size={16} className="spin" /> : <Trash2 size={16} />} Delete account
            </button>
          </div>
        </>
      )}
    </section>
  );
}
