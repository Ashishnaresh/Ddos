"use client";

const RULES: { label: string; test: (p: string) => boolean }[] = [
  { label: "At least 12 characters", test: (p) => p.length >= 12 },
  { label: "A lowercase letter", test: (p) => /[a-z]/.test(p) },
  { label: "An uppercase letter", test: (p) => /[A-Z]/.test(p) },
  { label: "A digit", test: (p) => /[0-9]/.test(p) },
];

export function passwordValid(p: string): boolean {
  return RULES.every((r) => r.test(p));
}

export function PasswordChecklist({ value }: { value: string }) {
  if (value.length === 0) return null;
  return (
    <ul className="space-y-1 text-xs">
      {RULES.map((r) => {
        const ok = r.test(value);
        return (
          <li key={r.label} className={ok ? "text-emerald-500" : "text-muted"}>
            {ok ? "✓" : "○"} {r.label}
          </li>
        );
      })}
    </ul>
  );
}
