import { useEffect, useState } from "react";

const stages = [
  "Checking urgent red flags",
  "Searching approved guidelines",
  "Reranking supporting evidence",
  "Validating citations and safety",
];

interface LoadingStateProps {
  onCancel: () => void;
}

export function LoadingState({ onCancel }: LoadingStateProps) {
  const [activeStage, setActiveStage] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setActiveStage((current) => Math.min(current + 1, stages.length - 1));
    }, 1350);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className="loading-state" role="status" aria-live="polite">
      <div className="loading-command">
        <div className="loading-head">
          <span>CLINICAL / PIPELINE</span>
          <span>PROCESSING</span>
        </div>
        <div className="loading-steps">
          {stages.map((stage, index) => (
            <div className={`loading-step ${index <= activeStage ? "active" : ""}`} key={stage}>
              <i aria-hidden="true" />
              <span>{stage}</span>
            </div>
          ))}
        </div>
        <button className="loading-cancel" type="button" onClick={onCancel}>
          Cancel assessment
        </button>
      </div>
    </div>
  );
}

