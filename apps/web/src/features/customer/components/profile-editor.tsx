"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateProfile, type CustomerProfile } from "@/features/customer/actions/manage-profile";
import type { ActiveStore } from "@/features/customer/queries/list-active-stores";

type ProfileEditorProps = {
  profile: CustomerProfile;
  stores: ActiveStore[];
};

export function ProfileEditor({ profile, stores }: ProfileEditorProps) {
  const [displayName, setDisplayName] = useState(profile.displayName ?? "");
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [preferredStoreId, setPreferredStoreId] = useState(profile.preferredFulfilmentNodeId ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("saving");

    try {
      await updateProfile({
        displayName,
        phone,
        preferredFulfilmentNodeId: preferredStoreId || null,
      });
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex max-w-md flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="displayName">Display name</Label>
        <Input
          id="displayName"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          placeholder="Your name"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="phone">Phone</Label>
        <Input
          id="phone"
          type="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder="Optional"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="preferredStore">Preferred store</Label>
        <select
          id="preferredStore"
          value={preferredStoreId}
          onChange={(event) => setPreferredStoreId(event.target.value)}
          className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
        >
          <option value="">No preference</option>
          {stores.map((store) => (
            <option key={store.id} value={store.id}>
              {store.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={status === "saving"}>
          {status === "saving" ? "Saving…" : "Save changes"}
        </Button>
        {status === "saved" && (
          <span className="text-sm text-muted-foreground" data-testid="profile-status">
            Saved.
          </span>
        )}
        {status === "error" && (
          <span className="text-sm text-destructive" data-testid="profile-status">
            Couldn&apos;t save your changes. Please try again.
          </span>
        )}
      </div>
    </form>
  );
}
