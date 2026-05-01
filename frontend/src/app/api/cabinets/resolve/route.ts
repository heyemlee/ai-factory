import { NextRequest, NextResponse } from "next/server";
import { resolveCabinetDimensions } from "@/lib/cabinet_catalog";

export function GET(request: NextRequest) {
  const item = request.nextUrl.searchParams.get("item") ?? "";
  return NextResponse.json(resolveCabinetDimensions(item));
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const singleItem = typeof body?.item === "string" ? body.item : null;
  const itemList: string[] | null = Array.isArray(body?.items)
    ? body.items.filter((item: unknown): item is string => typeof item === "string")
    : null;

  if (singleItem) {
    return NextResponse.json(resolveCabinetDimensions(singleItem));
  }

  if (itemList) {
    return NextResponse.json({
      results: itemList.map((item) => resolveCabinetDimensions(item)),
    });
  }

  return NextResponse.json(
    { resolved: false, error: "Request body must include item or items." },
    { status: 400 }
  );
}
