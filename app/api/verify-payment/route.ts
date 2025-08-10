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

    const payment = await Payment.findOne({ oid: razorpay_order_id }); // Changed 'let' to 'const'
    if (!payment) {
      console.error("Order ID not found:", razorpay_order_id);
      return NextResponse.json({ success: false, message: "Order Id not found" }, { status: 404 });
    }

    console.log("RAZORPAY_KEY_SECRET:", process.env.RAZORPAY_KEY_SECRET ? "****" : "undefined");

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

      const paymentData = {
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
      };

      const message = `Payment Successful!

ISKCON Payment Receipt
Name: ${paymentData.name}
Amount: Rs.${paymentData.amount}
Contact: ${paymentData.contactNo}
Transaction ID: ${paymentData.transactionId}
Payment Method: ${paymentData.paymentMethod}
UPI ID: ${paymentData.upiId}
Razorpay Payment ID: ${paymentData.razorpayPaymentId}
Date: ${paymentData.updatedAt}
Recipient: ${paymentData.recipient}

Thank you for your donation to ISKCON!`;

      try {
        console.log("Sending webhook to:", "https://backend-m133.onrender.com/api/whatsapp/verify");
        
        const webhookPayload = {
          message: message,
          from: `whatsapp:${updatedPayment.contactNo}`,
          paymentData: paymentData,
        };
        
        console.log("Webhook payload:", JSON.stringify(webhookPayload, null, 2));

        const webhookResponse = await fetch("https://backend-m133.onrender.com/api/whatsapp/verify", {
          method: "POST",
          headers: { 
            "Content-Type": "application/json",
            "Accept": "application/json",
          },
          body: JSON.stringify(webhookPayload),
        });

        console.log("Webhook response status:", webhookResponse.status);
        console.log("Webhook response headers:", Object.fromEntries(webhookResponse.headers.entries()));

        const responseText = await webhookResponse.text();
        console.log("Webhook response body:", responseText);

        if (!webhookResponse.ok) {
          throw new Error(`Webhook failed with status: ${webhookResponse.status}. Response: ${responseText}`);
        }

        let webhookData;
        try {
          webhookData = JSON.parse(responseText);
        } catch {
          console.log("Webhook response is not JSON, treating as success");
          webhookData = { message: "Response received but not JSON" };
        }

        console.log("Webhook Success:", JSON.stringify(webhookData, null, 2));
        
        return NextResponse.json({ 
          success: true, 
          message: "Payment verified and receipt sent successfully",
          paymentData: paymentData,
          webhookResponse: webhookData,
        });

      } catch (webhookError: unknown) {
        console.error(
          "Error sending webhook to /api/whatsapp/verify:",
          webhookError instanceof Error ? webhookError.message : webhookError
        );
        
        try {
          console.log("Trying alternative webhook format...");
          
          const simplePayload = {
            Body: message,
            From: `whatsapp:${updatedPayment.contactNo}`,
            To: "whatsapp:+14155238886",
          };
          
          console.log("Simple webhook payload:", JSON.stringify(simplePayload, null, 2));
          
          const fallbackResponse = await fetch("https://backend-m133.onrender.com/api/whatsapp/verify", {
            method: "POST",
            headers: { 
              "Content-Type": "application/json",
              "Accept": "application/json",
            },
            body: JSON.stringify(simplePayload),
          });
          
          console.log("Fallback webhook response status:", fallbackResponse.status);
          const fallbackText = await fallbackResponse.text();
          console.log("Fallback webhook response:", fallbackText);
          
          if (fallbackResponse.ok) {
            console.log("Fallback webhook succeeded");
            return NextResponse.json({ 
              success: true, 
              message: "Payment verified and receipt sent via fallback method",
              paymentData: paymentData,
              webhookMethod: "fallback",
            });
          }
        } catch (fallbackError: unknown) {
          if (fallbackError instanceof Error) {
            console.error("Fallback webhook also failed:", fallbackError.message);
          } else {
            console.error("Fallback webhook also failed:", fallbackError);
          }
        }
        
        return NextResponse.json({ 
          success: true, 
          message: "Payment verified successfully, but receipt delivery failed",
          paymentData: paymentData,
          webhookError: webhookError instanceof Error ? webhookError.message : String(webhookError),
          note: "Payment was successful, but WhatsApp notification failed. Please check Twilio configuration.",
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