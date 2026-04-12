import { prisma } from "@/lib/prisma";

export async function getSetting(key: string, defaultValue: string): Promise<string> {
  const row = await prisma.gymSettings.findUnique({ where: { key } });
  return row?.value ?? defaultValue;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.gymSettings.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}
