import React from "react";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost";
  isLoading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ children, variant = "primary", isLoading, disabled, className = "", ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={`fh-button fh-button--${variant} ${className}`}
        {...props}
      >
        {isLoading ? (
          <span className="fh-button-spinner" aria-hidden="true" />
        ) : null}
        <span className={isLoading ? "fh-button-content--loading" : ""}>{children}</span>
      </button>
    );
  }
);

Button.displayName = "Button";
