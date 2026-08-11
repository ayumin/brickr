type TextFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  prefix?: string;
  required?: boolean;
  maxLength?: number;
  pattern?: string;
  type?: string;
  autoComplete?: string;
};

export function TextField({ label, value, onChange, hint, prefix, ...input }: TextFieldProps) {
  return (
    <label className="block text-sm text-ink-muted">
      {label}
      <span className="mt-1.5 flex items-center rounded-xl border border-line bg-surface-raised focus-within:border-accent/60">
        {prefix ? <span className="pl-3 text-ink-faint">{prefix}</span> : null}
        <input
          {...input}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          className="min-w-0 flex-1 bg-transparent px-3 py-2 text-ink focus:outline-none"
        />
      </span>
      {hint ? <span className="mt-1 block text-xs text-ink-faint">{hint}</span> : null}
    </label>
  );
}
