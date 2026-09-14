import React from "react";

export interface FormMessageProps {
  type?: "error" | "success" | "info";
  message?: string | null;
}

export function FormMessage({ type = "error", message }: FormMessageProps) {
  if (!message) return null;

  return (
    <div className={`fh-message fh-message--${type}`} role="alert">
      <span>{message}</span>
    </div>
  );
}
