export default function Loading() {
  return (
    <div className="flex min-h-svh items-center justify-center" role="status" aria-label="Loading">
      <div className="size-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
    </div>
  );
}
