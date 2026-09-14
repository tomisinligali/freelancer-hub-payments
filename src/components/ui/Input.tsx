import React, { useId, useState } from "react";

function EyeIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  valid?: boolean;
  helperText?: string;
  hint?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    { label, error, valid, helperText, hint, id, className = "", type, onChange, autoComplete, ...props },
    ref
  ) => {
    // useId guarantees a unique id per instance so label/error/helper bindings never collide
    const generatedId = useId();
    const inputId = id ?? `${generatedId}-input`;
    const isPassword = type === "password";
    const [value, setValue] = useState<string>("");
    const [showPassword, setShowPassword] = useState(false);

    const inputType = isPassword && showPassword ? "text" : type;

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      setValue(e.target.value);
      onChange?.(e);
    };

    const isEmpty = value.length === 0;

    const errorId = `${inputId}-error`;
    const helperId = `${inputId}-helper`;
    const hintId = `${inputId}-hint`;

    const describedBy =
      [error ? errorId : null, helperText ? helperId : null, hint ? hintId : null]
        .filter(Boolean)
        .join(" ") || undefined;

    return (
      <div className="fh-input-group">
        {label ? (
          <label htmlFor={inputId} className="fh-input-label">
            {label}
          </label>
        ) : null}
        <div className={isPassword ? "fh-input-wrap fh-input-wrap--password" : "fh-input-wrap"}>
          <input
            ref={ref}
            id={inputId}
            type={inputType}
            className={`fh-input ${error ? "fh-input--error" : valid ? "fh-input--valid" : ""} ${className}`}
            onChange={handleChange}
            autoComplete={autoComplete}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            {...props}
          />
          {isPassword && !isEmpty ? (
            <button
              type="button"
              className="fh-input-toggle"
              aria-label={showPassword ? "Hide password" : "Show password"}
              onClick={() => setShowPassword(v => !v)}
              tabIndex={-1}
            >
              {showPassword ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          ) : null}
        </div>
        {error ? (
          <span id={errorId} className="fh-input-error-text" role="alert">
            {error}
          </span>
        ) : hint ? (
          <div id={hintId} className="fh-input-hint">
            {hint}
          </div>
        ) : helperText ? (
          <span id={helperId} className="fh-input-helper-text">
            {helperText}
          </span>
        ) : null}
      </div>
    );
  }
);

Input.displayName = "Input";