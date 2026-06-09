export const runtime = "edge";
export const dynamic = "force-static";

import { NextResponse } from "next/server";

// Ensure /learn/search-index.json is served even though /learn is a catch-all route.
import searchIndex from "../../../../../public/learn/search-index.json";

export function GET() {
  return NextResponse.json(searchIndex);
}

