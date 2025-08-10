import { NextResponse } from "next/server";
import connectDb from "@/app/db/connectDb";
import Payment from "@/app/models/Payment";
import Twilio from "twilio";
import PDFDocument from "pdfkit";
import { promises as fs } from "fs";
import path from "path";

// Define payment interface to replace 'any'
interface PaymentData {
  name?: string;
  amount?: number;
  message?: string;
  upiId?: string;
  transactionId: string;
  razorpayPaymentId?: string;
  updatedAt?: Date;
  to_user?: string;
  contactNo?: string;
}

const twilioClient = Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

export async function POST(req: Request) {
  // Set response timeout to 12 seconds (within Twilio's 15-second limit)
  const timeoutId = setTimeout(() => {
    console.error('Request timed out after 12 seconds');
  }, 12000);

  await connectDb();

  try {
    const startTime = Date.now();
    const body = await req.json();
    console.log('Twilio Callback Body:', JSON.stringify(body, null, 2));

    const from = body.From;
    const message = body.Body;
    const paymentData = body.paymentData;

    if (!from) {
      clearTimeout(timeoutId);
      console.error('Missing From field in request');
      return NextResponse.json({ success: false, message: 'Missing From field' }, { status: 400 });
    }

    let transactionId: string;
    let payment: PaymentData;

    // If we have paymentData from verify-payment, use it directly
    if (paymentData && paymentData.transactionId) {
      transactionId = paymentData.transactionId;
      payment = paymentData;
      console.log('Using payment data from verify-payment route');
    } else {
      // Otherwise, extract from message (for manual requests)
      const transactionIdMatch = message.match(/Transaction ID:\s*([^\n\r]+)/i);
      if (!transactionIdMatch) {
        clearTimeout(timeoutId);
        console.error('No Transaction ID found in message:', message);
        
        // Fire and forget error message
        twilioClient.messages.create({
          from: process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886',
          to: from,
          body: 'Invalid message format. Please include the Transaction ID.',
        }).catch(err => console.error('Error sending invalid format message:', err));
        
        return NextResponse.json({ success: false, message: 'Invalid message format' }, { status: 400 });
      }

      transactionId = transactionIdMatch[1].trim();
      console.log('Extracted Transaction ID:', transactionId);

      // Find payment in database
      const dbPayment = await Payment.findOne(
        { transactionId, done: true },
        'name amount message upiId transactionId razorpayPaymentId updatedAt to_user contactNo'
      ).lean() as PaymentData | null;

      if (!dbPayment) {
        clearTimeout(timeoutId);
        console.error('Payment not found or not completed:', transactionId);
        
        // Fire and forget error message
        twilioClient.messages.create({
          from: process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886',
          to: from,
          body: 'Payment not found or not completed. Please check your Transaction ID.',
        }).catch(err => console.error('Error sending not found message:', err));
        
        return NextResponse.json({ success: false, message: 'Payment not found' }, { status: 404 });
      }

      payment = dbPayment;
    }

    console.log('Payment Found:', `Time: ${Date.now() - startTime}ms`);

    // Generate PDF in memory (much faster than file operations)
    const pdfBuffer = await generatePDFBuffer(payment);
    console.log('PDF Generated in memory:', `Time: ${Date.now() - startTime}ms`);

    // Create receipts directory
    const receiptsDir = path.join(process.cwd(), "public", "receipts");
    await fs.mkdir(receiptsDir, { recursive: true });

    // Save file asynchronously (don't wait for it)
    const fileName = `receipt-${transactionId}-${Date.now()}.pdf`;
    const filePath = path.join(receiptsDir, fileName);
    
    // Fire and forget file save
    fs.writeFile(filePath, pdfBuffer).catch(err => 
      console.error('Error saving PDF file:', err)
    );

    // Create PDF URL
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
    const pdfUrl = `${baseUrl}/api/receipts/${fileName}`;
    console.log('PDF URL:', pdfUrl, `Time: ${Date.now() - startTime}ms`);

    // Send message with media - don't wait for response
    const messagePromise = twilioClient.messages.create({
      from: process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886',
      to: from,
      body: `🙏 Thank you ${payment.name || 'Customer'}!\n\nYour payment of ₹${payment.amount || 0} to ISKCON has been received successfully.\n\nHere is your payment receipt.`,
      mediaUrl: [pdfUrl],
    });

    // Respond immediately without waiting for Twilio message to send
    clearTimeout(timeoutId);
    const totalTime = Date.now() - startTime;
    console.log(`Total processing time: ${totalTime}ms`);
    
    const response = NextResponse.json({ 
      success: true, 
      message: 'Receipt sent', 
      pdfUrl,
      processingTime: totalTime 
    });

    // Handle message sending result asynchronously
    messagePromise
      .then((twilioResponse) => {
        console.log('PDF Sent to:', from, 'Message SID:', twilioResponse.sid);
      })
      .catch(err => console.error('Error sending WhatsApp message:', err));

    return response;

  } catch (error: unknown) {
    clearTimeout(timeoutId);
    console.error('Error in Twilio callback:', error);
    
    // Fire and forget error message
    const body = await req.json();
    if (body.From) {
      twilioClient.messages.create({
        from: process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886',
        to: body.From,
        body: 'An error occurred. Please try again later.',
      }).catch(sendError => console.error('Error sending error message:', sendError));
    }
    
    return NextResponse.json({ 
      success: false, 
      message: 'Server error', 
      error: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}

// Optimized PDF generation function (same as your Express.js server)
const generatePDFBuffer = (payment: PaymentData): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      bufferPages: true,
      autoFirstPage: true
    });
    
    const buffers: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    try {
      // Simplified PDF content for faster generation (same as your Express.js)
      doc.fontSize(18).text('ISKCON Payment Receipt', { align: 'center' });
      doc.moveDown(0.5);
      
      // Use simpler text formatting to reduce processing time
      const receiptData = [
        `Name: ${payment.name || 'Unknown'}`,
        `Amount: ₹${payment.amount || 0}`,
        `Message: ${payment.message || 'Payment successful'}`,
        `UPI ID: ${payment.upiId || 'Not available'}`,
        `Transaction ID: ${payment.transactionId || 'Not available'}`,
        `Razorpay Payment ID: ${payment.razorpayPaymentId || 'Not available'}`,
        `Date: ${payment.updatedAt ? new Date(payment.updatedAt).toLocaleString() : 'N/A'}`,
        `Recipient: ${payment.to_user || 'ISKCON'}`
      ];

      doc.fontSize(11);
      receiptData.forEach(line => {
        doc.text(line);
        doc.moveDown(0.2);
      });

      doc.moveDown(1);
      doc.fontSize(12).text('🙏 Thank you for your donation to ISKCON! 🙏', { align: 'center' });

      doc.end();
    } catch (pdfError: unknown) {
      console.error('PDF generation error:', pdfError);
      reject(pdfError);
    }
  });
};