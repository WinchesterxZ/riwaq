import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { useToast } from "../lib/toast";
import { Button, Dialog, Field, TextInput } from "./ui";

export function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [formError, setFormError] = useState("");

  const mutation = useMutation({
    mutationFn: () => api.changePassword({ currentPassword, newPassword }),
    onSuccess: () => {
      toast.success(t("auth.passwordChanged"));
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
      setFormError("");
      onClose();
    },
    onError: (err) => setFormError(errorMessage(err, t)),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword || !confirm) {
      setFormError(t("auth.requiredField"));
      return;
    }
    if (newPassword.length < 8) {
      setFormError(t("auth.passwordMin"));
      return;
    }
    if (newPassword !== confirm) {
      setFormError(t("auth.passwordMismatch"));
      return;
    }
    setFormError("");
    mutation.mutate();
  };

  return (
    <Dialog open={open} title={t("auth.changePasswordTitle")} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label={t("auth.currentPassword")} required error={undefined}>
          <TextInput
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </Field>
        <Field label={t("auth.newPassword")} required>
          <TextInput
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </Field>
        <Field label={t("auth.confirmPassword")} required>
          <TextInput
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </Field>
        {formError && <p className="text-sm font-medium text-danger">{formError}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            {t("common.save")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
