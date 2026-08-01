"use client";
import { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

export function Button({
  className = "",
  variant = "default",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "outline" | "ghost" }) {
  const styles = {
    default: "bg-oao text-white hover:bg-[#e85400]",
    outline: "theme-btn-outline",
    ghost: "theme-btn-ghost",
  };
  return (
    <button
      className={`inline-flex items-center justify-center rounded-lg px-3 py-2 text-sm font-medium transition disabled:opacity-40 ${styles[variant]} ${className}`}
      {...props}
    />
  );
}

export function Checkbox({
  label,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="tx-secondary flex cursor-pointer items-center gap-3 py-1.5 text-sm">
      <input type="checkbox" className="h-4 w-4 accent-oao" {...props} />
      {label}
    </label>
  );
}

export function Dialog({
  open,
  children,
  onClose,
}: {
  open: boolean;
  children: ReactNode;
  onClose: () => void;
}) {
  return open ? (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div className="theme-dialog w-full max-w-md rounded-2xl p-6 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  ) : null;
}

export function Select({
  value,
  onChange,
  children,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`theme-select ${className}`}
    >
      {children}
    </select>
  );
}
