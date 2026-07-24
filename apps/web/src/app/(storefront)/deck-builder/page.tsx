import { DecklistImport } from "@/features/deck-builder/components/decklist-import";

export default function DeckBuilderPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-12 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Deck-list purchasing</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Paste a decklist to match it against the catalogue. Lines matching more than one printing
          let you pick which one you mean.
        </p>
      </div>

      <DecklistImport />
    </div>
  );
}
