"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  baseUrl: string;
  searchParams: Record<string, string | string[] | undefined>;
}

export function Pagination({
  currentPage,
  totalPages,
  baseUrl,
  searchParams,
}: PaginationProps) {
  const buildUrl = (page: number) => {
    const params = new URLSearchParams();

    // Preserve existing search params
    Object.entries(searchParams).forEach(([key, value]) => {
      if (key === "page") return; // Skip page param
      if (Array.isArray(value)) {
        value.forEach((v) => params.append(key, v));
      } else if (value) {
        params.append(key, String(value));
      }
    });

    params.set("page", String(page));
    return `${baseUrl}?${params.toString()}`;
  };

  const pages = [];
  const maxVisible = 5;
  const halfVisible = Math.floor(maxVisible / 2);

  let startPage = Math.max(1, currentPage - halfVisible);
  const endPage = Math.min(totalPages, startPage + maxVisible - 1);

  if (endPage - startPage + 1 < maxVisible) {
    startPage = Math.max(1, endPage - maxVisible + 1);
  }

  for (let i = startPage; i <= endPage; i++) {
    pages.push(i);
  }

  return (
    <div className="flex items-center justify-center gap-2">
      {currentPage > 1 && (
        <Link href={buildUrl(currentPage - 1)}>
          <Button variant="outline" size="icon" className="h-8 w-8">
            <ChevronLeft className="h-4 w-4" />
            <span className="sr-only">Previous page</span>
          </Button>
        </Link>
      )}

      {startPage > 1 && (
        <>
          <Link href={buildUrl(1)}>
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0"
            >
              1
            </Button>
          </Link>
          {startPage > 2 && <span className="px-1">...</span>}
        </>
      )}

      {pages.map((page) => (
        <Link key={page} href={buildUrl(page)}>
          <Button
            variant={page === currentPage ? "default" : "outline"}
            size="sm"
            className="h-8 w-8 p-0"
          >
            {page}
          </Button>
        </Link>
      ))}

      {endPage < totalPages && (
        <>
          {endPage < totalPages - 1 && <span className="px-1">...</span>}
          <Link href={buildUrl(totalPages)}>
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0"
            >
              {totalPages}
            </Button>
          </Link>
        </>
      )}

      {currentPage < totalPages && (
        <Link href={buildUrl(currentPage + 1)}>
          <Button variant="outline" size="icon" className="h-8 w-8">
            <ChevronRight className="h-4 w-4" />
            <span className="sr-only">Next page</span>
          </Button>
        </Link>
      )}
    </div>
  );
}
