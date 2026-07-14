import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react'

type FieldWrapperProps = {
  label: string
  htmlFor: string
  children: ReactNode
  hint?: string
}

export function FieldWrapper({ label, htmlFor, children, hint }: FieldWrapperProps) {
  return (
    <label htmlFor={htmlFor} className="block">
      <span className="mb-1 block text-sm font-medium text-steel-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-steel-500">{hint}</span>}
    </label>
  )
}

const inputClass =
  'w-full rounded-lg border border-steel-300 bg-white px-3 py-2.5 text-base text-steel-900 placeholder:text-steel-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200'

export function Input({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${inputClass} ${className}`} {...rest} />
}

export function Textarea({ className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${inputClass} ${className}`} {...rest} />
}
