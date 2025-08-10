import { NextResponse } from "next/server";
import connectDb from "@/app/db/connectDb";
import Twilio from "twilio";

const twilioClient = Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

export async function POST(req: Request) {
  await connectDb();

  try {
    // This route handles direct Twilio webhooks (when users manually send messages)
    const contentType = req.headers.get("content-type") || "";
    let from: string = "";
    let message: string = "";

    if (contentType.includes("application/x-www-form-urlencoded")) {
      // Twilio webhook format
      const body = await req.formData();
      const params = Object.fromEntries(body);
      console.log("Direct Twilio Webhook Body:", JSON.stringify(params, null, 2));
      from = typeof params.From === "string" ? params.From : "";
      message = typeof params.Body === "string" ? params.Body : "";
    } else {
      // JSON format (for testing)
      const body = await req.json();
      console.log("JSON POST Body:", JSON.stringify(body, null, 2));
      from = body.From;
      message = body.Body;
    }

    if (!from) {
      console.error("Missing 'from' field in request");
      return NextResponse.json({ success: false, message: "Missing from field" }, { status: 400 });
    }

    // Handle different types of manual messages
    if (message.toLowerCase().includes('hi') || message.toLowerCase().includes('hello') || message.toLowerCase().includes('start')) {
      // Welcome message
      await twilioClient.messages.create({
        from: process.env.TWILIO_WHATSAPP_NUMBER || "whatsapp:+14155238886",
        to: from,
        body: `🙏 Welcome to ISKCON Payment Portal!\n\nTo get your payment receipt:\n1. Make a payment through our website\n2. Your receipt will be automatically sent to this WhatsApp number\n\nFor manual receipt, send: "Transaction ID: [your-transaction-id]"`,
      });

      return NextResponse.json({ success: true, message: "Welcome message sent" });
    }

    // Check if message contains a transaction ID (manual receipt request)
    const transactionIdMatch = message.match(/Transaction ID:\s*([^\n\r]+)/i) || 
                              message.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
    
    if (transactionIdMatch) {
      console.log("Manual receipt request detected, forwarding to callback route");
      
      // Forward this to our Twilio callback route (same as automatic flow)
      try {
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 
          (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
        
        const callbackUrl = `${baseUrl}/api/twilio/send-receipt`;
        
        const callbackPayload = {
          From: from,
          Body: message,
          // No paymentData since this is a manual request
        };

        const callbackResponse = await fetch(callbackUrl, {
          method: "POST",
          headers: { 
            "Content-Type": "application/json",
          },
          body: JSON.stringify(callbackPayload),
        });

        const responseData = await callbackResponse.json();
        
        if (callbackResponse.ok) {
          return NextResponse.json({ 
            success: true, 
            message: "Manual receipt request processed",
            callbackResponse: responseData
          });
        } else {
          throw new Error(`Callback failed: ${responseData.message}`);
        }

      } catch (error) {
        console.error("Error processing manual receipt request:", error);
        
        await twilioClient.messages.create({
          from: process.env.TWILIO_WHATSAPP_NUMBER || "whatsapp:+14155238886",
          to: from,
          body: "❌ Error processing your receipt request. Please try again or contact support.",
        });

        return NextResponse.json({ 
          success: false, 
          message: "Error processing manual receipt request" 
        }, { status: 500 });
      }
    }

    // Handle other messages (help, status, etc.)
    if (message.toLowerCase().includes('help')) {
      await twilioClient.messages.create({
        from: process.env.TWILIO_WHATSAPP_NUMBER || "whatsapp:+14155238886",
        to: from,
        body: `📋 ISKCON Payment Portal Help:\n\n✅ Automatic Receipts:\nMake payment → Get receipt automatically\n\n📄 Manual Receipt:\nSend: "Transaction ID: [your-id]"\n\n🆘 Support:\nContact us through our website\n\n🙏 Thank you for supporting ISKCON!`,
      });

      return NextResponse.json({ success: true, message: "Help message sent" });
    }

    // Default response for unrecognized messages
    await twilioClient.messages.create({
      from: process.env.TWILIO_WHATSAPP_NUMBER || "whatsapp:+14155238886",
      to: from,
      body: `🙏 Thank you for contacting ISKCON!\n\n• Your receipt is automatically sent after payment\n• For specific receipt: "Transaction ID: [your-id]"\n• For help: Send "help"\n\nMay Lord Krishna bless you! 🕉️`,
    });

    return NextResponse.json({ success: true, message: "Default response sent" });

  } catch (error: unknown) {
    console.error("Error in WhatsApp webhook:", error);
    return NextResponse.json({ 
      success: false, 
      message: "Server error", 
      error: error instanceof Error ? error.message : String(error) 
    }, { status: 500 });
  }
}