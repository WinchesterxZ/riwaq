import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useNavigate } from "react-router-dom";
import { Button, Field, TextInput } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { errorMessage } from "../lib/errors";
import { Brand } from "../components/Brand";
import { ThemeToggle } from "../components/ThemeToggle";

export function LoginPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { isAuthed, isLoading, refresh } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [mfaStep, setMfaStep] = useState(false);
  const [formError, setFormError] = useState("");
  const [showReset, setShowReset] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetDone, setResetDone] = useState(false);

  const login = useMutation({
    mutationFn: (body: { email: string; password: string; totpCode?: string }) => api.login(body),
    onSuccess: async (res) => {
      if (res.mfaRequired) {
        setMfaStep(true);
        setFormError("");
        return;
      }
      setFormError("");
      await refresh();
      navigate("/", { replace: true });
    },
    onError: (err) => setFormError(errorMessage(err, t)),
  });

  const reset = useMutation({
    mutationFn: (em: string) => api.requestPasswordReset(em),
    onSuccess: () => setResetDone(true),
    onError: (err) => setFormError(errorMessage(err, t)),
  });

  if (isLoading) return null;
  if (isAuthed) return <Navigate to="/" replace />;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    login.mutate({ email: email.trim(), password, totpCode: mfaStep ? totpCode.trim() : undefined });
  };

  return (
    <div className="login-layout">
      <aside className="login-story">
        <Brand />
        <div><h2>{t("brand.tagline")}</h2><p>{t("brand.intro")}</p></div>
        <div className="arch-art" aria-hidden="true"><i /><i /><i /></div>
        <footer>{t("brand.loginFoot")}</footer>
      </aside>
      <div className="login-form-panel">
        <div className="login-tools"><ThemeToggle /><button onClick={() => void i18n.changeLanguage(i18n.language === "ar" ? "en" : "ar")}>{i18n.language === "ar" ? "English" : "العربية"}</button></div>
        <Brand />
        <h1>{mfaStep ? t("auth.totpTitle") : t("brand.welcome")}</h1>
        <p className="login-lead">{t("brand.loginNote")}</p>

        {!mfaStep ? (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <Field label={t("auth.email")} required>
              <TextInput
                type="email"
                required
                autoComplete="username"
                dir="ltr"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@example.com"
              />
            </Field>
            <Field label={t("auth.password")} required>
              <TextInput
                type="password"
                required
                autoComplete="current-password"
                dir="ltr"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            {formError && <p role="alert" className="text-sm font-medium text-danger">{formError}</p>}
            <Button type="submit" loading={login.isPending}>
              {login.isPending ? t("auth.signingIn") : t("auth.signIn")}
            </Button>
            <button
              type="button"
              onClick={() => { setShowReset((v) => !v); setResetDone(false); setFormError(""); }}
              className="text-center text-[13px] font-medium text-accent-deep hover:underline"
            >
              {t("auth.forgotPassword")}
            </button>
          </form>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <p className="text-sm text-ink-soft">{t("auth.totpSubtitle")}</p>
            <Field label={t("auth.totpCode")} required>
              <TextInput
                inputMode="numeric"
                autoComplete="one-time-code"
                dir="ltr"
                className="text-center text-lg tracking-[0.3em]"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
                placeholder="••••••"
              />
            </Field>
            {formError && <p role="alert" className="text-sm font-medium text-danger">{formError}</p>}
            <Button type="submit" loading={login.isPending}>
              {login.isPending ? t("auth.verifying") : t("auth.verify")}
            </Button>
            <button
              type="button"
              onClick={() => { setMfaStep(false); setTotpCode(""); setFormError(""); }}
              className="text-center text-[13px] font-medium text-ink-soft hover:underline"
            >
              {t("auth.backToLogin")}
            </button>
          </form>
        )}

        {showReset && !mfaStep && (
          <form
            onSubmit={(e) => { e.preventDefault(); setFormError(""); reset.mutate(resetEmail.trim()); }}
            className="mt-4 flex flex-col gap-3 rounded-xl border border-line-soft bg-paper p-4"
          >
            {resetDone ? (
              <p className="text-sm text-ink-soft">{t("auth.resetRequested")}</p>
            ) : (
              <>
                <Field label={t("auth.resetTitle")}>
                  <TextInput
                    type="email"
                    dir="ltr"
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    placeholder="admin@example.com"
                  />
                </Field>
                <Button type="submit" variant="secondary" size="sm" loading={reset.isPending}>
                  {t("auth.sendResetLink")}
                </Button>
              </>
            )}
          </form>
        )}
        <p className="login-note">{t("brand.secure")}</p>
      </div>
    </div>
  );
}
