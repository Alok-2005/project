import { NextResponse } from "next/server";
import connectDb from "@/app/db/connectDb";
import Payment from "@/app/models/Payment";
import Twilio from "twilio";
import PDFDocument from "pdfkit";
import { promises as fs, createWriteStream } from "fs"; // Updated import
import path from "path";

const twilioClient = Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

export async function POST(req: Request) {
  await connectDb();

  let from: string | undefined = undefined;
  try {
    let message: string;

    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const body = await req.formData();
      const params = Object.fromEntries(body);
      console.log("Twilio Webhook Body:", JSON.stringify(params, null, 2));
      from = typeof params.From === "string" ? params.From : "";
      message = typeof params.Body === "string" ? params.Body : "";
    } else {
      const body = await req.json();
      console.log("JSON POST Body:", JSON.stringify(body, null, 2));
      from = body.from;
      message = body.message;
    }

    if (!from || !message) {
      console.error("Missing from or message in request");
      await twilioClient.messages.create({
        from: process.env.TWILIO_WHATSAPP_NUMBER || "whatsapp:+14155238886",
        to: from || "whatsapp:+1234567890",
        body: "Invalid request. Please provide a valid message.",
      });
      return NextResponse.json({ success: false, message: "Missing from or message" }, { status: 400 });
    }

    const transactionIdMatch = message.match(/Transaction ID: ([^\n]+)/);
    if (!transactionIdMatch) {
      console.error("No Transaction ID found in message:", message);
      await twilioClient.messages.create({
        from: process.env.TWILIO_WHATSAPP_NUMBER || "whatsapp:+14155238886",
        to: from,
        body: "Invalid message format. Please include the Transaction ID (e.g., 'Transaction ID: ff2a24f9-2c3f-47ed-bb3e-4c9ebbf865ba').",
      });
      return NextResponse.json({ success: false, message: "Invalid message format" }, { status: 400 });
    }

    const transactionId = transactionIdMatch[1].trim();
    console.log("Extracted Transaction ID:", transactionId);

    const payment = await Payment.findOne({ transactionId, done: true });
    if (!payment) {
      console.error("Payment not found or not completed:", transactionId);
      await twilioClient.messages.create({
        from: process.env.TWILIO_WHATSAPP_NUMBER || "whatsapp:+14155238886",
        to: from,
        body: "Payment not found or not completed. Please check your Transaction ID.",
      });
      return NextResponse.json({ success: false, message: "Payment not found" }, { status: 404 });
    }

    console.log("Payment Found:", JSON.stringify(payment.toObject(), null, 2));

    const doc = new PDFDocument();
    const receiptsDir = path.join(process.cwd(), "public", "receipts");
    await fs.mkdir(receiptsDir, { recursive: true });
    const fileName = `receipt-${transactionId}.pdf`;
    const filePath = path.join(receiptsDir, fileName);

    const writeStream = createWriteStream(filePath); // Replaced require with ES import
    doc.pipe(writeStream);

    try {
      doc.font("Times-Roman");
    } catch (fontError: unknown) {
      console.error("Font loading error:", fontError instanceof Error ? fontError.message : fontError);
      await twilioClient.messages.create({
        from: process.env.TWILIO_WHATSAPP_NUMBER || "whatsapp:+14155238886",
        to: from,
        body: "Failed to generate receipt due to a server issue. Please contact support.",
      });
      return NextResponse.json(
        { success: false, message: "Failed to generate receipt due to font issue" },
        { status: 500 }
      );
    }

    doc.fontSize(20).text("ISKCON Payment Receipt", { align: "center" });
    doc.moveDown();
    doc.fontSize(12).text(`Name: ${payment.name || "Unknown"}`);
    doc.text(`Amount: ₹${payment.amount || 0}`);
    doc.text(`Message: Payment successful`);
    doc.text(`Payment Method: ${payment.upiId || "N/A"}`);
    doc.text(`UPI ID: ${payment.upiId || "Not available"}`);
    doc.text(`Transaction ID: ${payment.transactionId || "Not available"}`);
    doc.text(`Razorpay Payment ID: ${payment.razorpayPaymentId || "Not available"}`);
    doc.text(`Date: ${payment.updatedAt ? new Date(payment.updatedAt).toLocaleString() : "N/A"}`);
    doc.text(`Recipient: ${payment.to_user || "N/A"}`);

    doc.end();

    await new Promise((resolve, reject) => {
      writeStream.on("finish", () => resolve(undefined));
      writeStream.on("error", reject);
    });

    console.log("PDF Generated:", filePath);

    const pdfUrl = `https://backend-m133.onrender.com/receipts/${fileName}`;
    console.log("PDF URL:", pdfUrl);

    const twilioResponse = await twilioClient.messages.create({
      from: process.env.TWILIO_WHATSAPP_NUMBER || "whatsapp:+14155238886",
      to: from,
      body: "Thank you for your payment to ISKCON! Here is your receipt.",
      mediaUrl: [pdfUrl],
    });

    console.log("Twilio Message SID:", twilioResponse.sid);

    return NextResponse.json({ success: true, message: "Receipt sent", pdfUrl });
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error("Error in WhatsApp webhook:", error.message, error.stack);
      try {
        await twilioClient.messages.create({
          from: process.env.TWILIO_WHATSAPP_NUMBER || "whatsapp:+14155238886",
          to: from || "whatsapp:+979975175098",
          body: "An error occurred. Please try again later.",
        });
      } catch (sendError: unknown) {
        if (sendError instanceof Error) {
          console.error("Error sending error message:", sendError.message);
        } else {
          console.error("Unknown error sending error message:", sendError);
        }
      }
      return NextResponse.json({ success: false, message: "Server error", error: error.message }, { status: 500 });
    } else {
      console.error("Unknown error in WhatsApp webhook:", error);
      return NextResponse.json({ success: false, message: "Server error", error: String(error) }, { status: 500 });
    }
  }
}