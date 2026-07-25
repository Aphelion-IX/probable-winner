import { Construction } from "lucide-react";

export function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 rounded-lg border border-dashed px-4 py-16 text-center sm:px-6">
      <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Construction className="size-6" aria-hidden />
      </span>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
