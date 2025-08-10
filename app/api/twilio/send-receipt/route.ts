// This route is now simplified - just handles manual receipt requests
import { NextResponse } from "next/server";
import connectDb from "@/app/db/connectDb";
import Payment from "@/app/models/Payment";
import Twilio from "twilio";

const twilioClient = Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

export async function POST(req: Request) {
  try {
    await connectDb();
    
    const body = await req.json();
    const from = body.From;
    const message = body.Body;

    if (!from || !message) {
      return NextResponse.json({ success: false, message: 'Missing required fields' }, { status: 400 });
    }

    // Extract transaction ID from message
    const transactionIdMatch = message.match(/Transaction ID:\s*([^\n\r]+)/i);
    if (!transactionIdMatch) {
      await twilioClient.messages.create({
        from: process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886',
        to: from,
        body: 'Please send your message in this format: "Transaction ID: your-transaction-id"',
      });
      return NextResponse.json({ success: false, message: 'Invalid format' }, { status: 400 });
    }

    const transactionId = transactionIdMatch[1].trim();
    
    // Find payment in database
    const payment = await Payment.findOne({ transactionId, done: true });
    if (!payment) {
      await twilioClient.messages.create({
        from: process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886',
        to: from,
        body: 'Payment not found or not completed. Please check your Transaction ID.',
      });
      return NextResponse.json({ success: false, message: 'Payment not found' }, { status: 404 });
    }

    // Send receipt message
    const receiptMessage = `🙏 *ISKCON Payment Receipt* 🙏

✅ *Payment Successful!*

👤 *Name:* ${payment.name}
💰 *Amount:* ₹${payment.amount}
🆔 *Transaction ID:* ${payment.transactionId}
💳 *Payment ID:* ${payment.razorpayPaymentId}
${payment.upiId ? `🏦 *UPI ID:* ${payment.upiId}` : ''}
📅 *Date:* ${new Date(payment.updatedAt).toLocaleString('en-IN')}

Thank you for your donation to ISKCON! 🕉️

May Lord Krishna bless you! 🙏`;

    await twilioClient.messages.create({
      from: process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886',
      to: from,
      body: receiptMessage,
    });

    return NextResponse.json({ success: true, message: 'Receipt sent successfully' });

  } catch (error: unknown) {
    console.error('Error in manual receipt:', error);
    return NextResponse.json({ 
      success: false, 
      message: 'Server error', 
      error: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}