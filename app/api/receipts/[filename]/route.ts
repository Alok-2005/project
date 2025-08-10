import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

// Define the params type explicitly to match Next.js expectations
interface RouteParams {
  params: {
    filename: string;
  };
}

 async function GET(
  request: NextRequest,
  // Use type assertion to ensure compatibility with Next.js internal types
  context: RouteParams & { params: unknown }
): Promise<NextResponse> {
  try {
    // Safely access params.filename
    const filename = (context.params as { filename: string }).filename;
    
    // Security check - only allow PDF files and prevent directory traversal
    if (!filename.endsWith('.pdf') || filename.includes('..')) {
      return NextResponse.json(
        { error: 'Invalid file request' },
        { status: 400 }
      );
    }

    const filePath = path.join('/tmp', 'receipts', filename);
    
    try {
      const fileBuffer = await fs.readFile(filePath);
      // Use Buffer directly with type assertion to satisfy TypeScript
      return new NextResponse(fileBuffer as unknown as BodyInit, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="${filename}"`,
          'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
        },
      });
    } catch (fileError) {
      console.error('File not found:', filePath, fileError);
      return NextResponse.json(
        { error: 'Receipt not found' },
        { status: 404 }
      );
    }
  } catch (error) {
    console.error('Error serving receipt:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}