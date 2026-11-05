import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useBlocker } from "react-router-dom";
import { ConfirmDialog } from "../components/ui";

/**
 * Guards against losing unsaved form changes:
 * - blocks in-app react-router navigation while `dirty` is true,
 * - blocks tab/window close via beforeunload.
 *
 * Returns props for <DirtyGuardPrompt/> plus the current dirty flag.
 */
export function useDirtyGuard(dirty: boolean): {
  showPrompt: boolean;
  confirmLeave: () => void;
  stay: () => void;
  /** Call before a programmatic navigation that should NOT be blocked (e.g. after save). */
  allowNavigation: () => void;
} {
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const proceedRef = useRef<(() => void) | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);

  const blocker = useBlocker(
    useCallback(
      ({
        currentLocation,
        nextLocation,
      }: {
        currentLocation: { pathname: string };
        nextLocation: { pathname: string };
      }) =>
        dirtyRef.current && currentLocation.pathname !== nextLocation.pathname,
      [],
    ),
  );

  useEffect(() => {
    if (blocker.state === "blocked") {
      proceedRef.current = () => blocker.proceed();
      setShowPrompt(true);
    }
  }, [blocker]);

  const confirmLeave = useCallback(() => {
    dirtyRef.current = false;
    setShowPrompt(false);
    proceedRef.current?.();
  }, []);

  const stay = useCallback(() => {
    setShowPrompt(false);
    if (blocker.state === "blocked") blocker.reset();
  }, [blocker]);

  const allowNavigation = useCallback(() => {
    dirtyRef.current = false;
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [dirty]);

  return { showPrompt, confirmLeave, stay, allowNavigation };
}

/** Confirmation dialog rendered when the dirty guard blocks a navigation. */
export function DirtyGuardPrompt({
  show,
  onLeave,
  onStay,
}: {
  show: boolean;
  onLeave: () => void;
  onStay: () => void;
}) {
  const { t } = useTranslation();
  return (
    <ConfirmDialog
      open={show}
      title={t("common.unsavedChanges")}
      text={t("common.unsavedChangesText")}
      confirmLabel={t("common.leave")}
      onConfirm={onLeave}
      onClose={onStay}
    />
  );
}
