import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { setSetting } from "@/lib/services/settings";
import { checkOrigin } from "@/lib/services/csrf";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const MAX_SIZE = 2 * 1024 * 1024; // 2MB

// MIME → file extension map. Extension is derived from MIME, not user-supplied name.
const ALLOWED: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/svg+xml": "svg",
  "image/webp": "webp",
};

export async function POST(req: Request) {
  const csrf = checkOrigin(req);
  if (!csrf.ok) return Response.json({ error: csrf.error }, { status: 403 });

  const session = await getServerSession(authOptions);
  if (
    !session ||
    (session.user as { actorType?: string }).actorType !== "worker" ||
    (session.user as { role?: string }).role !== "admin"
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("logo");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const ext = ALLOWED[file.type];
  if (!ext) {
    return NextResponse.json(
      { error: "Invalid file type. Use PNG, JPEG, SVG, or WebP." },
      { status: 400 }
    );
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "File too large. Maximum 2MB." }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "File is empty." }, { status: 400 });
  }

  // Filename is a fresh random hex + the MIME-derived extension.
  // Never trust file.name.
  const filename = `gym-logo-${crypto.randomBytes(8).toString("hex")}.${ext}`;
  const uploadDir = path.join(process.cwd(), "public", "uploads");
  const uploadPath = path.join(uploadDir, filename);

  // Defence-in-depth: confirm the resolved path is still inside uploadDir.
  const resolvedDir = path.resolve(uploadDir);
  const resolvedPath = path.resolve(uploadPath);
  if (!resolvedPath.startsWith(resolvedDir + path.sep)) {
    return NextResponse.json({ error: "Invalid upload path" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(uploadPath, buffer);
  await setSetting("gym_logo", `/uploads/${filename}`);

  return NextResponse.json({ success: true, path: `/uploads/${filename}` });
}
