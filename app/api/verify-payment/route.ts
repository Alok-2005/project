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
        // Get the base URL for your Next.js app
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 
          (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
        
        // This is the Twilio callback URL - similar to your Express.js /api/whatsapp/verify
        const twilioCallbackUrl = `${baseUrl}/api/twilio/send-receipt`;
        
        console.log("Making POST request to Twilio callback URL:", twilioCallbackUrl);
        
        // Create payload similar to your Express.js server structure
        const callbackPayload = {
          From: `whatsapp:${updatedPayment.contactNo}`,
          Body: `Transaction ID: ${updatedPayment.transactionId}`,
          // Additional data for the callback route
          paymentData: {
            name: updatedPayment.name,
            amount: updatedPayment.amount,
            contactNo: updatedPayment.contactNo,
            upiId: updatedPayment.upiId,
            transactionId: updatedPayment.transactionId,
            razorpayPaymentId: updatedPayment.razorpayPaymentId,
            to_user: updatedPayment.to_user,
            updatedAt: updatedPayment.updatedAt
          }
        };
        
        console.log("Callback payload:", JSON.stringify(callbackPayload, null, 2));

        // Make POST request to the Twilio callback route (mimicking Twilio webhook)
        const callbackResponse = await fetch(twilioCallbackUrl, {
          method: "POST",
          headers: { 
            "Content-Type": "application/json",
            "Accept": "application/json",
          },
          body: JSON.stringify(callbackPayload),
        });

        console.log("Twilio callback response status:", callbackResponse.status);
        const responseText = await callbackResponse.text();
        console.log("Twilio callback response:", responseText);

        let callbackData;
        try {
          callbackData = JSON.parse(responseText);
        } catch {
          console.log("Callback response is not JSON");
          callbackData = { message: "Response received but not JSON" };
        }

        if (callbackResponse.ok) {
          console.log("Receipt sent successfully via callback:", JSON.stringify(callbackData, null, 2));
          
          return NextResponse.json({ 
            success: true, 
            message: "Payment verified and receipt sent successfully!",
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
            receiptResponse: callbackData,
          });
        } else {
          throw new Error(`Twilio callback failed with status: ${callbackResponse.status}. Response: ${responseText}`);
        }

      } catch (callbackError: unknown) {
        console.error(
          "Error calling Twilio callback:",
          callbackError instanceof Error ? callbackError.message : callbackError
        );
        
        // Payment is still successful, just receipt failed
        return NextResponse.json({ 
          success: true, 
          message: "Payment verified successfully, but receipt delivery failed",
          paymentData: {
            name: updatedPayment.name || "Unknown",
            amount: updatedPayment.amount || 0,
            contactNo: updatedPayment.contactNo,
            transactionId: updatedPayment.transactionId || "Not available",
            razorpayPaymentId: updatedPayment.razorpayPaymentId || "Not available",
            paymentStatus: "Success",
          },
          receiptError: callbackError instanceof Error ? callbackError.message : String(callbackError),
          note: "Payment was successful, but WhatsApp receipt failed. Please check configuration.",
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