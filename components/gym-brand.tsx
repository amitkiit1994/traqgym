"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

type GymBrandProps = {
  size?: "sm" | "md" | "lg";
  className?: string;
  showName?: boolean;
};

const sizeMap = {
  sm: { logo: 28, text: "text-base" },
  md: { logo: 40, text: "text-xl" },
  lg: { logo: 56, text: "text-4xl" },
};

let cachedBrand: { name: string; logo: string } | null = null;

export function GymBrand({ size = "md", className = "", showName = true }: GymBrandProps) {
  const [brand, setBrand] = useState(cachedBrand);

  useEffect(() => {
    if (cachedBrand) return;
    fetch("/api/gym-brand")
      .then((r) => r.json())
      .then((data) => {
        cachedBrand = data;
        setBrand(data);
      })
      .catch(() => {});
  }, []);

  const s = sizeMap[size];
  const name = brand?.name || process.env.NEXT_PUBLIC_GYM_NAME || "TraqGym";
  const logo = brand?.logo || "";

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {logo && (
        <Image
          src={logo}
          alt={name}
          width={s.logo}
          height={s.logo}
          className="object-contain"
          unoptimized
          priority
        />
      )}
      {showName && (
        <span className={`font-semibold ${s.text} leading-tight`}>{name}</span>
      )}
    </div>
  );
}

/** Server-side helper: returns brand data for use in API routes (e.g. invoice PDF) */
export async function getGymBrand() {
  // Dynamic import to avoid pulling prisma into client bundle
  const { getSetting } = await import("@/lib/services/settings");
  const name = await getSetting("gym_name", process.env.NEXT_PUBLIC_GYM_NAME || "TraqGym");
  const logo = await getSetting("gym_logo", "");
  return { name, logo };
}
