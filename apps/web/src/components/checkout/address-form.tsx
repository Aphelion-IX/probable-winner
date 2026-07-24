"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface AddressFormProps {
  onSubmit: (address: {
    line1: string;
    line2?: string;
    suburb: string;
    state: string;
    postcode: string;
  }) => void;
  initialValues?: {
    line1: string;
    line2?: string;
    suburb: string;
    state: string;
    postcode: string;
  };
}

const STATES = ["NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT"];

export function AddressForm({ onSubmit, initialValues }: AddressFormProps) {
  const [formData, setFormData] = useState(
    initialValues || {
      line1: "",
      line2: "",
      suburb: "",
      state: "NSW",
      postcode: "",
    }
  );

  const [errors, setErrors] = useState<Record<string, string>>({});

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.line1.trim()) {
      newErrors.line1 = "Street address is required";
    }

    if (!formData.suburb.trim()) {
      newErrors.suburb = "Suburb/city is required";
    }

    if (!formData.postcode.trim()) {
      newErrors.postcode = "Postcode is required";
    } else if (!/^\d{4}$/.test(formData.postcode)) {
      newErrors.postcode = "Postcode must be 4 digits";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (validateForm()) {
      onSubmit({
        line1: formData.line1,
        line2: formData.line2 || undefined,
        suburb: formData.suburb,
        state: formData.state,
        postcode: formData.postcode,
      });
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1">Street address</label>
        <Input
          type="text"
          placeholder="123 Main Street"
          value={formData.line1}
          onChange={(e) =>
            setFormData({ ...formData, line1: e.target.value })
          }
          className={errors.line1 ? "border-destructive" : ""}
        />
        {errors.line1 && (
          <p className="text-xs text-destructive mt-1">{errors.line1}</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">
          Apartment, suite, etc. (optional)
        </label>
        <Input
          type="text"
          placeholder="Apartment 4B"
          value={formData.line2 || ""}
          onChange={(e) =>
            setFormData({ ...formData, line2: e.target.value })
          }
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium mb-1">Suburb/City</label>
          <Input
            type="text"
            placeholder="Sydney"
            value={formData.suburb}
            onChange={(e) =>
              setFormData({ ...formData, suburb: e.target.value })
            }
            className={errors.suburb ? "border-destructive" : ""}
          />
          {errors.suburb && (
            <p className="text-xs text-destructive mt-1">{errors.suburb}</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">State</label>
          <select
            value={formData.state}
            onChange={(e) =>
              setFormData({ ...formData, state: e.target.value })
            }
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
          >
            {STATES.map((state) => (
              <option key={state} value={state}>
                {state}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Postcode</label>
        <Input
          type="text"
          placeholder="2000"
          maxLength={4}
          value={formData.postcode}
          onChange={(e) =>
            setFormData({ ...formData, postcode: e.target.value })
          }
          className={errors.postcode ? "border-destructive" : ""}
        />
        {errors.postcode && (
          <p className="text-xs text-destructive mt-1">{errors.postcode}</p>
        )}
      </div>

      <Button type="submit" className="w-full">
        Continue
      </Button>
    </form>
  );
}
