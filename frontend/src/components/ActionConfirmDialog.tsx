import { useEffect, useId, useRef } from "react";
import { BellRing, HeartPulse, MapPin, PhoneCall, ShieldCheck } from "lucide-react";

export type ClinicalAction = "call" | "facility" | "contacts" | "wellness";

interface ActionCopy {
  title: string;
  description: string;
  confirm: string;
}

const actionCopy: Record<ClinicalAction, ActionCopy> = {
  call: {
    title: "Call emergency services?",
    description:
      "This opens your device's phone app only after you confirm. The system never places a call automatically.",
    confirm: "Continue to phone",
  },
  facility: {
    title: "Find nearby emergency care?",
    description:
      "This opens a maps search in a new tab. Confirm the facility and its opening status before travelling.",
    confirm: "Open maps",
  },
  contacts: {
    title: "Emergency contacts are not connected",
    description:
      "The MVP can recommend alerting a trusted contact, but it cannot message anyone for you. Please contact them directly.",
    confirm: "I understand",
  },
  wellness: {
    title: "Wellness guidance is not connected",
    description:
      "The backend permitted this action, but the dedicated wellness module is outside this MVP. No advice will be invented.",
    confirm: "I understand",
  },
};

const actionIcons = {
  call: PhoneCall,
  facility: MapPin,
  contacts: BellRing,
  wellness: HeartPulse,
};

interface ActionConfirmDialogProps {
  action: ClinicalAction | null;
  onCancel: () => void;
  onConfirm: (action: ClinicalAction) => void;
}

export function ActionConfirmDialog({ action, onCancel, onConfirm }: ActionConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!action) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    cancelRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [action, onCancel]);

  if (!action) return null;

  const copy = actionCopy[action];
  const Icon = actionIcons[action];

  return (
    <div className="dialog-backdrop" onMouseDown={onCancel}>
      <section
        ref={dialogRef}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const first = cancelRef.current;
          const last = confirmRef.current;
          if (!first || !last) return;
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <div className="dialog-icon" aria-hidden="true">
          <Icon size={23} />
        </div>
        <h2 id={titleId}>{copy.title}</h2>
        <p id={descriptionId}>{copy.description}</p>

        <div className="dialog-actions">
          <button ref={cancelRef} className="pill-button secondary" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button ref={confirmRef} className="pill-button" type="button" onClick={() => onConfirm(action)}>
            <ShieldCheck size={16} aria-hidden="true" />
            {copy.confirm}
          </button>
        </div>
      </section>
    </div>
  );
}
