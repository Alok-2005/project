import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export async function GET(
  request: NextRequest,
  { params }: { params: { filename: string } }
) {
  try {
    const filename = params.filename;
    
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
  const arrayBuffer = Buffer.from(fileBuffer).buffer;
  return new NextResponse(arrayBuffer, {
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