"use client";
import { useState, type FormEvent } from "react";

export default function LoginForm() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenant: form.get("tenant"),
          email: form.get("email"),
          password: form.get("password"),
        }),
      });
      if (!response.ok) {
        setError("Check your organization, email, and password.");
        return;
      }
      window.location.assign("/");
    } catch {
      setError("The service is unavailable. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="brand-mark">H</div>
        <p className="eyebrow">Human Performance Intelligence</p>
        <h1>Welcome back</h1>
        <p className="muted">
          Sign in to review expectations, evidence, and development actions.
        </p>
        <form onSubmit={submit} className="form-stack">
          <label>
            Organization code
            <input name="tenant" autoComplete="organization" required />
          </label>
          <label>
            Work email
            <input name="email" type="email" autoComplete="username" required />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="fine">
          Your organization controls access to review data.
        </p>
      </section>
    </main>
  );
}
