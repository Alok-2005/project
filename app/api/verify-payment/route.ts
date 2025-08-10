import { NextResponse } from "next/server";
import { validatePaymentVerification } from "razorpay/dist/utils/razorpay-utils";
import Payment from "@/app/models/Payment";
import Razorpay from "razorpay";
import connectDb from "@/app/db/connectDb";

export async function POST(req: Request) {
  await connectDb();

  try {
    const body = await req.json();
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, transactionId } = body;

    console.log("Razorpay Callback Body:", JSON.stringify(body, null, 2));

    const payment = await Payment.findOne({ oid: razorpay_order_id });
    if (!payment) {
      console.error("Order ID not found:", razorpay_order_id);
      return NextResponse.json({ success: false, message: "Order Id not found" }, { status: 404 });
    }

    if (!process.env.RAZORPAY_KEY_SECRET) {
      console.error("Razorpay secret missing");
      return NextResponse.json(
        { success: false, message: "Server configuration error: Razorpay secret missing" },
        { status: 500 }
      );
    }

    const isValid = validatePaymentVerification(
      { order_id: razorpay_order_id, payment_id: razorpay_payment_id },
      razorpay_signature,
      process.env.RAZORPAY_KEY_SECRET
    );

    console.log("Payment Verification Result:", isValid);

    if (isValid) {
      const razorpay = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID || "",
        key_secret: process.env.RAZORPAY_KEY_SECRET || "",
      });

      const paymentDetails = await razorpay.payments.fetch(razorpay_payment_id);
      console.log("Payment Details:", JSON.stringify(paymentDetails, null, 2));

      const isUpi = paymentDetails.method === "upi";
      const upiId = isUpi ? paymentDetails.vpa || "N/A" : paymentDetails.method;

      const updatedPayment = await Payment.findOneAndUpdate(
        { oid: razorpay_order_id },
        {
          done: true,
          upiId: upiId,
          transactionId: transactionId,
          razorpayPaymentId: razorpay_payment_id,
          updatedAt: Date.now(),
        },
        { new: true }
      );

      if (!updatedPayment) {
        console.error("Failed to update payment for order:", razorpay_order_id);
        return NextResponse.json({ success: false, message: "Failed to update payment" }, { status: 500 });
      }

      console.log("Updated Payment:", JSON.stringify(updatedPayment.toObject(), null, 2));

      try {
        console.log("Sending WhatsApp receipt directly...");
        
        // Send WhatsApp receipt directly using Twilio
        if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
          throw new Error("Twilio credentials not configured");
        }

        const Twilio = require('twilio');
        const twilioClient = Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

        // Format contact number for WhatsApp
        let whatsappNumber = updatedPayment.contactNo;
        if (!whatsappNumber.startsWith('whatsapp:')) {
          // Remove any + prefix and add whatsapp: prefix
          whatsappNumber = whatsappNumber.replace(/^\+/, '');
          whatsappNumber = `whatsapp:+${whatsappNumber}`;
        }

        console.log("Sending to WhatsApp number:", whatsappNumber);

        // Create receipt message
        const receiptMessage = `🙏 *ISKCON Payment Receipt* 🙏

✅ *Payment Successful!*

👤 *Name:* ${updatedPayment.name}
💰 *Amount:* ₹${updatedPayment.amount}
🆔 *Transaction ID:* ${updatedPayment.transactionId}
💳 *Payment ID:* ${updatedPayment.razorpayPaymentId}
📱 *Payment Method:* ${paymentDetails.method}
${updatedPayment.upiId ? `🏦 *UPI ID:* ${updatedPayment.upiId}` : ''}
📅 *Date:* ${new Date().toLocaleString('en-IN')}

Thank you for your donation to ISKCON! 🕉️

May Lord Krishna bless you! 🙏`;

        // Send WhatsApp message
        const message = await twilioClient.messages.create({
          from: process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886',
          to: whatsappNumber,
          body: receiptMessage,
        });

        console.log("WhatsApp message sent successfully! SID:", message.sid);

        return NextResponse.json({ 
          success: true, 
          message: "Payment verified and receipt sent to WhatsApp successfully!",
          paymentData: {
            name: updatedPayment.name || "Unknown",
            amount: updatedPayment.amount || 0,
            contactNo: updatedPayment.contactNo,
            transactionId: updatedPayment.transactionId || "Not available",
            razorpayPaymentId: updatedPayment.razorpayPaymentId || "Not available",
            upiId: updatedPayment.upiId || "Not available",
            paymentMethod: paymentDetails.method || "N/A",
            orderId: razorpay_order_id,
            paymentStatus: "Success",
            updatedAt: updatedPayment.updatedAt ? new Date(updatedPayment.updatedAt).toLocaleString() : "N/A",
            recipient: updatedPayment.to_user || "N/A",
          },
          whatsappMessageSid: message.sid,
        });

      } catch (whatsappError: unknown) {
        console.error("Error sending WhatsApp message:", whatsappError);
        
        // Payment is still successful, just receipt failed
        return NextResponse.json({ 
          success: true,
          message: "Payment verified successfully, but WhatsApp receipt failed to send",
          paymentData: {
            name: updatedPayment.name || "Unknown",
            amount: updatedPayment.amount || 0,
            contactNo: updatedPayment.contactNo,
            transactionId: updatedPayment.transactionId || "Not available",
            razorpayPaymentId: updatedPayment.razorpayPaymentId || "Not available",
            paymentStatus: "Success",
          },
          whatsappError: whatsappError instanceof Error ? whatsappError.message : String(whatsappError),
          note: "Payment was successful, but WhatsApp receipt failed. Please check Twilio configuration.",
        });
      }

    } else {
      console.error("Payment verification failed for order:", razorpay_order_id);
      return NextResponse.json({ success: false, message: "Payment Verification Failed" }, { status: 400 });
    }
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error("Error in payment verification:", error.message, error.stack);
      return NextResponse.json({ 
        success: false, 
        message: "Server error", 
        error: error.message,
      }, { status: 500 });
    } else {
      console.error("Unknown error in payment verification:", error);
      return NextResponse.json({ 
        success: false, 
        message: "Server error", 
        error: "Unknown error",
      }, { status: 500 });
    }
  }
}