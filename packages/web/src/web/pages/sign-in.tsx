import { useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowUpRight, Loader2 } from "lucide-react";
import { Brand, Wave } from "../components/brand";
import { authClient } from "../lib/auth";
export default function SignIn() {
  const [signup, setSignup] = useState(false),
    [email, setEmail] = useState(""),
    [name, setName] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [, navigate] = useLocation();
  const { data: session } = authClient.useSession();
  if (session) navigate("/studio");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = signup
        ? await authClient.signUp.email({ email, password, name })
        : await authClient.signIn.email({ email, password });
      if (r.error) setError(r.error.message ?? "Unable to sign in.");
      else navigate("/studio");
    } catch {
      setError("Unable to connect. Please retry.");
    } finally {
      setBusy(false);
    }
  }
  async function google() {
    setBusy(true);
    setError("");
    try {
      const r = await authClient.managedAuth.signIn({ provider: "google" });
      if (r.error) setError(r.error.message ?? "Google sign-in failed.");
      else navigate("/studio");
    } catch {
      setError("Google sign-in could not be completed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <aside>
        <Brand />
        <div>
          <div className="eyebrow">GOOD TO HEAR FROM YOU.</div>
          <h1>
            YOUR STORY.
            <br />
            <span className="lavender-text italic">YOUR SPACE.</span>
          </h1>
          <Wave />
          <p>A little text. A new possibility.</p>
        </div>
        <Link href="/">
          Back to home <ArrowUpRight size={17} />
        </Link>
      </aside>
      <main>
        <div className="auth-form">
          <div className="eyebrow">MINGALAR VOICE STUDIO</div>
          <h2>{signup ? "Make yourself at home." : "Welcome back."}</h2>
          <p>
            {signup
              ? "Create your account and start exploring."
              : "Your next idea is waiting for you."}
          </p>
          <button className="google" disabled={busy} onClick={google}>
            Continue with Google <ArrowUpRight size={18} />
          </button>
          <div className="divider">or use your email</div>
          <form onSubmit={submit}>
            {signup && (
              <label>
                Your name
                <input
                    aria-label="Your name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                />
              </label>
            )}
            <label>
              Email address
              <input
                aria-label="Email address"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </label>
            <label>
              Password
              <input
                aria-label="Password"
                type="password"
                minLength={10}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={signup ? "new-password" : "current-password"}
              />
              <small>At least 10 characters</small>
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="action" disabled={busy}>
              {busy ? (
                <Loader2 className="spin" size={18} />
              ) : signup ? (
                "Create account"
              ) : (
                "Sign in"
              )}
              <ArrowUpRight size={18} />
            </button>
          </form>
          <p className="auth-toggle">
            {signup ? "Already have an account?" : "New around here?"}{" "}
            <button
              onClick={() => {
                setSignup(!signup);
                setError("");
              }}
            >
              {signup ? "Sign in" : "Create account"}
            </button>
          </p>
          <small className="auth-disclaimer">
            Development build. Paid generation and subscriptions are not yet
            available. Email verification and password recovery are not
            configured.
          </small>
        </div>
      </main>
    </div>
  );
}
