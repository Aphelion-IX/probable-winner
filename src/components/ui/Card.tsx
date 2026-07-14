import type { HTMLAttributes } from 'react'

export function Card({ className = '', children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`rounded-xl border border-steel-200 bg-white shadow-sm ${className}`} {...rest}>
      {children}
    </div>
  )
}

export function CardHeader({ className = '', children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`border-b border-steel-200 px-4 py-3 sm:px-5 ${className}`} {...rest}>
      {children}
    </div>
  )
}

export function CardBody({ className = '', children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`px-4 py-4 sm:px-5 ${className}`} {...rest}>
      {children}
    </div>
  )
}
