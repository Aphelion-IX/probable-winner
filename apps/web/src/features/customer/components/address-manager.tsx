"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createAddress,
  deleteAddress,
  type CustomerAddress,
} from "@/features/customer/actions/manage-profile";

type AddressManagerProps = {
  initialAddresses: CustomerAddress[];
};

const EMPTY_FORM = {
  label: "",
  line1: "",
  line2: "",
  city: "",
  region: "",
  postalCode: "",
  country: "AU",
};

export function AddressManager({ initialAddresses }: AddressManagerProps) {
  const [addresses, setAddresses] = useState(initialAddresses);
  const [form, setForm] = useState(EMPTY_FORM);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setAdding(true);

    try {
      const id = await createAddress(form);
      setAddresses((current) => [
        ...current,
        {
          id,
          label: form.label || null,
          line1: form.line1,
          line2: form.line2 || null,
          city: form.city,
          region: form.region || null,
          postalCode: form.postalCode || null,
          country: form.country,
          isDefault: false,
        },
      ]);
      setForm(EMPTY_FORM);
    } catch {
      setError("Couldn't save this address. Please try again.");
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(addressId: string) {
    setDeletingId(addressId);
    try {
      await deleteAddress(addressId);
      setAddresses((current) => current.filter((address) => address.id !== addressId));
    } catch {
      setError("Couldn't remove this address. Please try again.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="flex max-w-md flex-col gap-6">
      {addresses.length > 0 && (
        <ul className="flex flex-col gap-2" data-testid="address-list">
          {addresses.map((address) => (
            <li
              key={address.id}
              className="flex items-start justify-between gap-3 rounded-lg border p-3 text-sm"
            >
              <div>
                {address.label && <p className="font-medium">{address.label}</p>}
                <p>{address.line1}</p>
                {address.line2 && <p>{address.line2}</p>}
                <p className="text-muted-foreground">
                  {[address.city, address.region, address.postalCode].filter(Boolean).join(", ")}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={deletingId === address.id}
                onClick={() => handleDelete(address.id)}
              >
                {deletingId === address.id ? "Removing…" : "Remove"}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleAdd} className="flex flex-col gap-3 rounded-lg border p-4">
        <p className="text-sm font-medium">Add a new address</p>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="addressLabel">Label</Label>
          <Input
            id="addressLabel"
            value={form.label}
            onChange={(event) => setForm({ ...form, label: event.target.value })}
            placeholder="Home, work, etc. (optional)"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="addressLine1">Street address</Label>
          <Input
            id="addressLine1"
            value={form.line1}
            onChange={(event) => setForm({ ...form, line1: event.target.value })}
            required
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="addressLine2">Apartment, suite, etc.</Label>
          <Input
            id="addressLine2"
            value={form.line2}
            onChange={(event) => setForm({ ...form, line2: event.target.value })}
            placeholder="Optional"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="addressCity">City</Label>
            <Input
              id="addressCity"
              value={form.city}
              onChange={(event) => setForm({ ...form, city: event.target.value })}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="addressRegion">State/region</Label>
            <Input
              id="addressRegion"
              value={form.region}
              onChange={(event) => setForm({ ...form, region: event.target.value })}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="addressPostalCode">Postal code</Label>
            <Input
              id="addressPostalCode"
              value={form.postalCode}
              onChange={(event) => setForm({ ...form, postalCode: event.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="addressCountry">Country</Label>
            <Input
              id="addressCountry"
              value={form.country}
              onChange={(event) => setForm({ ...form, country: event.target.value })}
              required
            />
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button type="submit" disabled={adding} className="self-start">
          {adding ? "Saving…" : "Add address"}
        </Button>
      </form>
    </div>
  );
}
