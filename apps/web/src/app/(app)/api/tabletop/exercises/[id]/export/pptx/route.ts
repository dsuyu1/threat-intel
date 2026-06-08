export const runtime = "edge";

export async function GET() {
  return new Response(
    "PPTX export is not supported on Cloudflare Pages (Edge runtime). Use the PDF or DOCX export endpoint instead.",
    { status: 501, headers: { "content-type": "text/plain; charset=utf-8" } }
  );
}

