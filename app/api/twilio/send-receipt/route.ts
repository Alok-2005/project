import { NextResponse } from "next/server";
import connectDb from "@/app/db/connectDb";
import Payment from "@/app/models/Payment";
import Twilio from "twilio";
import PDFDocument from "pdfkit";
import { promises as fs } from "fs";
import path from "path";

// Define payment interface
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

// Define Twilio request body interface
interface TwilioRequestBody {
  From?: string;
  Body?: string;
  paymentData?: PaymentData;
}

const twilioClient = Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

export async function POST(req: Request) {
  console.log('🚀 Starting Twilio callback processing...');
  
  // Set response timeout to 12 seconds
  const timeoutId = setTimeout(() => {
    console.error('⏰ Request timed out after 12 seconds');
  }, 12000);

  let body: TwilioRequestBody;
  
  try {
    await connectDb();
    console.log('✅ Database connected');

    // Parse request body
    try {
      body = await req.json();
      console.log('📨 Twilio Callback Body:', JSON.stringify(body, null, 2));
    } catch (parseError) {
      clearTimeout(timeoutId);
      console.error('❌ Error parsing request body:', parseError);
      return NextResponse.json(
        { success: false, message: 'Invalid request body', error: parseError instanceof Error ? parseError.message : String(parseError) },
        { status: 400 }
      );
    }

    const startTime = Date.now();
    const from = body.From;
    const message = body.Body;
    const paymentData = body.paymentData;

    if (!from) {
      clearTimeout(timeoutId);
      console.error('❌ Missing From field in request');
      return NextResponse.json({ success: false, message: 'Missing From field' }, { status: 400 });
    }

    console.log('📞 Processing request from:', from);

    let transactionId: string;
    let payment: PaymentData;

    // If we have paymentData from verify-payment, use it directly
    if (paymentData && paymentData.transactionId) {
      transactionId = paymentData.transactionId;
      payment = paymentData;
      console.log('💳 Using payment data from verify-payment route');
    } else {
      // Otherwise, extract from message (for manual requests)
      if (!message) {
        clearTimeout(timeoutId);
        console.error('❌ Missing Body field in request');
        twilioClient.messages.create({
          from: process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886',
          to: from,
          body: 'Invalid message format. Please include the Transaction ID.',
        }).catch(err => console.error('Error sending invalid format message:', err));
        
        return NextResponse.json({ success: false, message: 'Missing message body' }, { status: 400 });
      }

      const transactionIdMatch = message.match(/Transaction ID:\s*([^\n\r]+)/i);
      if (!transactionIdMatch) {
        clearTimeout(timeoutId);
        console.error('❌ No Transaction ID found in message:', message);
        
        // Fire and forget error message
        twilioClient.messages.create({
          from: process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886',
          to: from,
          body: 'Invalid message format. Please include the Transaction ID.',
        }).catch(err => console.error('Error sending invalid format message:', err));
        
        return NextResponse.json({ success: false, message: 'Invalid message format' }, { status: 400 });
      }

      transactionId = transactionIdMatch[1].trim();
      console.log('🔍 Extracted Transaction ID:', transactionId);

      // Find payment in database
      const dbPayment = await Payment.findOne(
        { transactionId, done: true },
        'name amount message upiId transactionId razorpayPaymentId updatedAt to_user contactNo'
      ).lean() as PaymentData | null;

      if (!dbPayment) {
        clearTimeout(timeoutId);
        console.error('❌ Payment not found or not completed:', transactionId);
        
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

    console.log('✅ Payment Found:', `Time: ${Date.now() - startTime}ms`);

    // Generate PDF in memory
    console.log('📄 Starting PDF generation for transaction:', transactionId);
    let pdfBuffer: Buffer;
    
    try {
      pdfBuffer = await generatePDFBuffer(payment);
      console.log('✅ PDF Generated in memory:', `Time: ${Date.now() - startTime}ms`);
    } catch (pdfError) {
      console.error('❌ Failed to generate PDF:', pdfError);
      clearTimeout(timeoutId);
      
      // Send error message to user
      twilioClient.messages.create({
        from: process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886',
        to: from,
        body: 'Sorry, there was an error generating your receipt. Please try again later.',
      }).catch(err => console.error('Error sending PDF error message:', err));
      
      return NextResponse.json({ 
        success: false, 
        message: 'PDF generation failed', 
        error: pdfError instanceof Error ? pdfError.message : String(pdfError)
      }, { status: 500 });
    }

    // Create receipts directory in /tmp for Vercel compatibility
    const receiptsDir = path.join('/tmp', 'receipts');
    console.log('📁 Creating receipts directory:', receiptsDir);
    
    try {
      await fs.mkdir(receiptsDir, { recursive: true });
      console.log('✅ Receipts directory created');
    } catch (dirError) {
      console.error('❌ Error creating receipts directory:', dirError);
      clearTimeout(timeoutId);
      return NextResponse.json({ 
        success: false, 
        message: 'Failed to create receipts directory',
        error: dirError instanceof Error ? dirError.message : String(dirError)
      }, { status: 500 });
    }

    // Save file and get URL
    const fileName = `receipt-${transactionId}-${Date.now()}.pdf`;
    const filePath = path.join(receiptsDir, fileName);
    console.log('💾 Saving PDF to:', filePath);
    
    try {
      await fs.writeFile(filePath, pdfBuffer);
      console.log('✅ PDF file saved successfully');
    } catch (saveError) {
      console.error('❌ Error saving PDF file:', saveError);
      // Continue anyway, we have the buffer
    }

    // Create PDF URL
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
    const pdfUrl = `${baseUrl}/api/receipts/${fileName}`;
    console.log('🔗 PDF URL:', pdfUrl, `Time: ${Date.now() - startTime}ms`);

    // Send message with media
    console.log('📱 Sending WhatsApp message to:', from);
    
    try {
      const twilioResponse = await twilioClient.messages.create({
        from: process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886',
        to: from,
        body: `🙏 Thank you ${payment.name || 'Customer'}!\n\nYour payment of ₹${payment.amount || 0} to ISKCON has been received successfully.\n\nHere is your payment receipt.`,
        mediaUrl: [pdfUrl],
      });

      console.log('✅ WhatsApp message sent successfully! Message SID:', twilioResponse.sid);
      
      clearTimeout(timeoutId);
      const totalTime = Date.now() - startTime;
      console.log(`⏱️ Total processing time: ${totalTime}ms`);
      
      return NextResponse.json({ 
        success: true, 
        message: 'Receipt sent successfully', 
        pdfUrl,
        messageSid: twilioResponse.sid,
        processingTime: totalTime 
      });

    } catch (twilioError) {
      console.error('❌ Error sending WhatsApp message:', twilioError);
      clearTimeout(timeoutId);
      
      return NextResponse.json({ 
        success: false, 
        message: 'Failed to send WhatsApp message',
        error: twilioError instanceof Error ? twilioError.message : String(twilioError),
        pdfUrl // Still provide PDF URL for debugging
      }, { status: 500 });
    }

  } catch (error: unknown) {
    clearTimeout(timeoutId);
    console.error('❌ Error in Twilio callback:', error);
    
    // Fire and forget error message using already-parsed body
    if (body?.From) {
      console.log('📱 Sending error message to:', body.From);
      twilioClient.messages.create({
        from: process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886',
        to: body.From,
        body: 'An error occurred while generating your receipt. Please try again later or contact support.',
      }).catch(sendError => console.error('Error sending error message:', sendError));
    }
    
    return NextResponse.json({ 
      success: false, 
      message: 'Server error', 
      error: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}

// Fixed PDF generation function
const generatePDFBuffer = (payment: PaymentData): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    try {
      console.log('📄 Initializing PDFDocument');
      const doc = new PDFDocument({
        size: 'A4',
        bufferPages: true,
        autoFirstPage: true
      });
      
      // Explicitly set font with fallback
      try {
        console.log('🔤 Setting font to Helvetica');
        doc.font('Helvetica');
      } catch (fontError) {
        console.error('❌ Font loading error, falling back to Times-Roman:', fontError);
        doc.font('Times-Roman');
      }

      const buffers: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => buffers.push(chunk));
      doc.on('end', () => {
        console.log('✅ PDF document generation completed');
        resolve(Buffer.concat(buffers));
      });
      doc.on('error', (err) => {
        console.error('❌ PDF document error:', err);
        reject(err);
      });

      console.log('📝 Generating PDF content');
      doc.fontSize(18).text('ISKCON Payment Receipt', { align: 'center' });
      doc.moveDown(0.5);
      
      // FIXED: Remove the syntax error "vr" and use proper array syntax
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

      console.log('🏁 Finalizing PDF document');
      doc.end();
    } catch (pdfError: unknown) {
      console.error('❌ PDF generation error:', pdfError);
      reject(pdfError);
    }
  });
};