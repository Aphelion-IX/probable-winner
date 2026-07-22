export function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3 px-4 py-16 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-muted-foreground">{description}</p>
    </div>
  );
}
