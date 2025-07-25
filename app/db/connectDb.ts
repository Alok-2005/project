import mongoose from "mongoose";
import { ConnectOptions } from "mongoose"; // Import the correct type

const connectDb = async () => {
  if (mongoose.connection.readyState >= 1) return;

  try {
    await mongoose.connect(process.env.MONGODB_URI || "", {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    } as ConnectOptions); // Use ConnectOptions type
    console.log("Connected to* MongoDB");


  } catch (error) {
    console.error("MongoDB connection error:", error);
    throw error;
  }
};

export default connectDb;