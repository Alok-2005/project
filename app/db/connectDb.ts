import mongoose from "mongoose";

const connectDb = async () => {
  if (mongoose.connection.readyState >= 1) return;

  try {
    await mongoose.connect(process.env.MONGODB_URI || "", {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    } as any);
    console.log("Connected to MongoDB");
  } catch (error) {
    console.error("MongoDB connection error:", error);
    throw error;
  }
};

export default connectDb;