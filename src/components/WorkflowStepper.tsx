"use client";

import React from "react";

interface WorkflowStepperProps {
  currentStep: 1 | 2 | 3 | 4;
}

const STEPS = [
  { step: 1, label: "1 Words" },
  { step: 2, label: "2 Screening" },
  { step: 3, label: "3 Explorer" },
  { step: 4, label: "4 Summary" },
] as const;

export function WorkflowStepper({ currentStep }: WorkflowStepperProps) {
  return (
    <nav
      aria-label="Workflow progress"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexWrap: "wrap",
        gap: "8px",
        margin: "12px 0 20px 0",
        padding: "8px 12px",
        background: "#f8fafc",
        border: "1px solid #e2e8f0",
        borderRadius: "8px"
      }}
    >
      {STEPS.map((s, idx) => {
        const isCurrent = s.step === currentStep;
        const isCompleted = s.step < currentStep;

        return (
          <React.Fragment key={s.step}>
            {idx > 0 && (
              <span
                style={{
                  color: "#94a3b8",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  userSelect: "none"
                }}
                aria-hidden="true"
              >
                ·
              </span>
            )}
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "4px 10px",
                borderRadius: "6px",
                fontSize: "0.82rem",
                fontWeight: isCurrent ? 700 : 500,
                background: isCurrent
                  ? "#0f766e"
                  : isCompleted
                  ? "#e6fffa"
                  : "transparent",
                color: isCurrent
                  ? "#ffffff"
                  : isCompleted
                  ? "#0d9488"
                  : "#64748b",
                border: isCurrent
                  ? "1px solid #0f766e"
                  : isCompleted
                  ? "1px solid #99f6e4"
                  : "1px solid transparent",
                lineHeight: 1.3
              }}
              aria-current={isCurrent ? "step" : undefined}
            >
              {s.label}
            </span>
          </React.Fragment>
        );
      })}
    </nav>
  );
}
