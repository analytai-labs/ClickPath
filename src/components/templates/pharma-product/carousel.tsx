"use client";

import type { PharmaThemeTokens } from "@/lib/templates/definitions/pharma-product";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

type Props = {
  images: string[];
  productName: string;
  t: PharmaThemeTokens;
};

export function PharmaProductCarousel({ images, productName, t }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const handleScroll = () => {
      // Calculate which slide is mostly in view
      const scrollLeft = el.scrollLeft;
      const width = el.clientWidth;
      if (width === 0) return;

      const index = Math.round(scrollLeft / width);
      if (index !== currentIndex) {
        setCurrentIndex(index);
      }
    };

    el.addEventListener("scroll", handleScroll, { passive: true });
    // Run once to initialize
    handleScroll();

    return () => el.removeEventListener("scroll", handleScroll);
  }, [currentIndex]);

  const scrollTo = (index: number) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ left: index * el.clientWidth, behavior: "smooth" });
  };

  if (!images || images.length === 0) return null;

  const safeIndex = Math.min(currentIndex, images.length - 1);

  return (
    <div
      className="group relative overflow-hidden rounded-xl shadow-sm"
      style={{ border: `1px solid ${t.borderColor}` }}
    >
      {/* Scroll container */}
      <div
        ref={scrollRef}
        className="flex overflow-x-auto snap-x snap-mandatory [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {images.map((url, i) => (
          <div
            key={i}
            className="relative aspect-square min-w-full shrink-0 snap-center bg-white dark:bg-black/20"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={`${productName} image ${i + 1}`}
              className="absolute inset-0 h-full w-full object-cover"
            />
          </div>
        ))}
      </div>

      {/* Navigation arrows (desktop hover) */}
      {images.length > 1 && (
        <>
          <button
            type="button"
            onClick={() => scrollTo(Math.max(0, safeIndex - 1))}
            disabled={safeIndex === 0}
            className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full p-1.5 shadow-sm opacity-0 transition-opacity group-hover:opacity-100 disabled:cursor-not-allowed disabled:!opacity-0"
            style={{
              background: t.cardBackground,
              color: t.textColor,
              border: `1px solid ${t.borderColor}`,
            }}
            aria-label="Previous image"
          >
            <IconChevronLeft size={18} stroke={1.5} />
          </button>

          <button
            type="button"
            onClick={() => scrollTo(Math.min(images.length - 1, safeIndex + 1))}
            disabled={safeIndex === images.length - 1}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1.5 shadow-sm opacity-0 transition-opacity group-hover:opacity-100 disabled:cursor-not-allowed disabled:!opacity-0"
            style={{
              background: t.cardBackground,
              color: t.textColor,
              border: `1px solid ${t.borderColor}`,
            }}
            aria-label="Next image"
          >
            <IconChevronRight size={18} stroke={1.5} />
          </button>

          {/* Dots Indicator */}
          <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1.5 px-4">
            {images.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => scrollTo(i)}
                className="h-1.5 rounded-full transition-all duration-300 shadow-sm"
                style={{
                  width: i === safeIndex ? "16px" : "6px",
                  background: i === safeIndex ? t.accentColor : "rgba(255, 255, 255, 0.7)",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
                }}
                aria-label={`Go to image ${i + 1}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
