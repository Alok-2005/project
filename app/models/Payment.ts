import mongoose, { Schema } from "mongoose";

const PaymentSchema = new Schema({
  name: { type: String, required: true },
  contactNo: { type: String, required: true },
  amount: { type: Number, required: true },
  transactionId: { type: String, required: true },
  oid: { type: String, required: true },
  to_user: { type: String, required: true },
  done: { type: Boolean, default: false },
  upiId: { type: String },
  razorpayPaymentId: { type: String },
  updatedAt: { type: Date },
});

export default mongoose.models.Payment || mongoose.model("Payment", PaymentSchema);