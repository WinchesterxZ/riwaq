import { ApiError } from "@atlas-erp/api-client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useNavigate } from "react-router-dom";
import { Button, Field, LoadingBlock, TextInput } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { errorMessage } from "../lib/errors";
import { useToast } from "../lib/toast";
import { Brand } from "../components/Brand";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SetupPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const { refresh } = useAuth();

  const status = useQuery({
    queryKey: ["first-run-status"],
    queryFn: () => api.firstRunStatus(),
    retry: false,
    staleTime: 60_000,
  });

  const [step, setStep] = useState(0);
  const [orgName, setOrgName] = useState("");
  const [orgNameAr, setOrgNameAr] = useState("");
  const [currency, setCurrency] = useState("EGP");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [formError, setFormError] = useState("");

  const create = useMutation({
    mutationFn: () =>
      api.firstRun({
        organizationName: orgName.trim(),
        organizationNameAr: orgNameAr.trim(),
        adminName: adminName.trim(),
        adminEmail: adminEmail.trim(),
        password,
      }),
    onSuccess: async () => {
      toast.success(t("setup.success"));
      await refresh();
      navigate("/", { replace: true });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === "FIRST_RUN_DONE") {
        navigate("/", { replace: true });
        return;
      }
      setFormError(errorMessage(err, t));
    },
  });

  if (status.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <LoadingBlock label={t("setup.checking")} />
      </div>
    );
  }
  if (status.isError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper px-4">
        <p className="max-w-md text-center text-sm text-danger">{errorMessage(status.error, t)}</p>
      </div>
    );
  }
  if (!status.data?.firstRun) return <Navigate to="/" replace />;

  const stepValid = (): boolean => {
    if (step === 0) {
      if (!orgName.trim() || !orgNameAr.trim()) {
        setFormError(t("auth.requiredField"));
        return false;
      }
    } else {
      if (!adminName.trim() || !adminEmail.trim() || !password) {
        setFormError(t("auth.requiredField"));
        return false;
      }
      if (!EMAIL_RE.test(adminEmail.trim())) {
        setFormError(t("auth.invalidEmail"));
        return false;
      }
      if (password.length < 8) {
        setFormError(t("auth.passwordMin"));
        return false;
      }
      if (password !== confirm) {
        setFormError(t("auth.passwordMismatch"));
        return false;
      }
    }
    setFormError("");
    return true;
  };

  const next = () => {
    if (stepValid()) setStep(1);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (stepValid()) create.mutate();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4 py-10">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-surface p-8 shadow-card">
        <div className="setup-brand mb-8"><Brand /></div>
        <h1 className="text-xl font-bold">{t("setup.title")}</h1>
        <p className="mt-1 text-sm text-ink-soft">{t("setup.subtitle")}</p>

        {/* Stepper */}
        <div className="my-6 flex items-center gap-2">
          {[t("setup.stepOrg"), t("setup.stepAdmin")].map((label, i) => (
            <div key={label} className="flex flex-1 items-center gap-2">
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  i <= step ? "bg-accent on-solid" : "bg-surface-soft text-ink-faint"
                }`}
              >
                {i + 1}
              </span>
              <span className={`text-[13px] font-semibold ${i <= step ? "text-ink" : "text-ink-faint"}`}>
                {label}
              </span>
              {i === 0 && <span className="mx-1 h-px flex-1 bg-line" />}
            </div>
          ))}
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4">
          {step === 0 ? (
            <>
              <Field label={t("setup.orgName")} required>
                <TextInput dir="ltr" value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="Acme Corp" />
              </Field>
              <Field label={t("setup.orgNameAr")} required>
                <TextInput value={orgNameAr} onChange={(e) => setOrgNameAr(e.target.value)} placeholder="شركة أكمي" />
              </Field>
              <Field label={t("setup.defaultCurrency")} required>
                <TextInput dir="ltr" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))} placeholder="EGP" maxLength={3} />
              </Field>
            </>
          ) : (
            <>
              <Field label={t("setup.adminName")} required>
                <TextInput value={adminName} onChange={(e) => setAdminName(e.target.value)} />
              </Field>
              <Field label={t("setup.adminEmail")} required>
                <TextInput type="email" dir="ltr" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="admin@example.com" />
              </Field>
              <Field label={t("setup.adminPassword")} required>
                <TextInput type="password" dir="ltr" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
              <Field label={t("setup.confirmPassword")} required>
                <TextInput type="password" dir="ltr" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </Field>
            </>
          )}

          {formError && <p className="text-sm font-medium text-danger">{formError}</p>}

          <div className="mt-2 flex justify-between gap-2">
            {step === 1 ? (
              <Button type="button" variant="secondary" onClick={() => { setStep(0); setFormError(""); }}>
                {t("common.previous")}
              </Button>
            ) : <span />}
            {step === 0 ? (
              <Button type="button" onClick={next}>
                {t("common.next")}
              </Button>
            ) : (
              <Button type="submit" loading={create.isPending}>
                {create.isPending ? t("setup.creating") : t("setup.createWorkspace")}
              </Button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
