import { NextResponse, NextRequest } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { createReadStream } from "fs"; // For creating a Node.js readable stream

export const dynamic = "force-static";

export async function generateStaticParams() {
  const receiptsDir = path.join(process.cwd(), "public", "receipts");
  try {
    await fs.access(receiptsDir);
    const files = await fs.readdir(receiptsDir);
    const pdfFiles = files.filter((file) => file.endsWith(".pdf"));
    return pdfFiles.map((file) => ({
      filename: file,
    }));
  } catch (error) {
    console.warn("Receipts directory not found, returning empty params:", error);
    return [];
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ filename: string }> }
) {
  const params = await context.params;
  const { filename } = params;

  // Enhanced validation to prevent path traversal
  if (!filename.endsWith(".pdf") || filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    return NextResponse.json({ success: false, message: "Invalid filename" }, { status: 400 });
  }

  const filePath = path.join(process.cwd(), "public", "receipts", filename);

  try {
    // Check if file exists and get stats
    const stats = await fs.stat(filePath); // This also verifies access
    if (!stats.isFile()) {
      throw new Error("Not a file");
    }

    // Create a Node.js readable stream
    const stream = createReadStream(filePath);

    // Convert to web ReadableStream (compatible with Next.js)
    const readableStream = new ReadableStream({
      start(controller) {
        stream.on("data", (chunk) => {
          controller.enqueue(chunk); // Chunk is already a Buffer, which is fine
        });

        stream.on("end", () => {
          controller.close();
        });

        stream.on("error", (error) => {
          controller.error(error);
        });
      },
      cancel() {
        stream.destroy();
      }
    });

    return new NextResponse(readableStream, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": stats.size.toString(), // Helps with progress indicators
      },
    });
  } catch (error) {
    console.error("File serving error:", error);
    return NextResponse.json(
      { success: false, message: "PDF not found or inaccessible" },
      { status: 404 }
    );
  }
}
