import { NextResponse } from "next/server";
import connectDb from "@/app/db/connectDb";
import Payment from "@/app/models/Payment";
import Razorpay from "razorpay";

export async function POST(req: Request) {
  await connectDb();

  try {
    const { name, contactNo, amount, transactionId, to_user } = await req.json();

    if (!name || !contactNo || !amount || !transactionId || !to_user) {
      return NextResponse.json({ success: false, message: "Missing required fields" }, { status: 400 });
    }

    console.log("RAZORPAY_KEY_ID:", process.env.RAZORPAY_KEY_ID);
    console.log("RAZORPAY_KEY_SECRET:", process.env.RAZORPAY_KEY_SECRET ? "****" : "undefined");

    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      console.error("Razorpay credentials missing");
      return NextResponse.json(
        { success: false, message: "Server configuration error: Razorpay credentials missing" },
        { status: 500 }
      );
    }

    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });

    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100),
      currency: "INR",
      receipt: transactionId,
    });

    const payment = new Payment({
      name,
      contactNo,
      amount,
      transactionId,
      oid: order.id,
      to_user,
      done: false,
    });
    await payment.save();

    return NextResponse.json({ success: true, orderId: order.id });
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error("Error creating order:", error.message, error.stack);
      return NextResponse.json({ success: false, message: "Server error", error: error.message }, { status: 500 });
    } else {
      console.error("Error creating order:", error);
      return NextResponse.json({ success: false, message: "Server error", error: String(error) }, { status: 500 });
    }
  }
}