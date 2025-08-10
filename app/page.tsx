"use client";
import { useState, useEffect } from "react";
import Head from "next/head";
import { v4 as uuidv4 } from "uuid";
import { UserIcon, PhoneIcon, CurrencyRupeeIcon } from "@heroicons/react/24/outline";

// Define an interface for Razorpay's response
interface RazorpayResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

// Define Razorpay options interface
interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  handler: (response: RazorpayResponse) => void;
  prefill: {
    name: string;
    contact: string;
  };
  theme: {
    color: string;
  };
}

// Define Razorpay interface
interface Razorpay {
  new (options: RazorpayOptions): { open: () => void };
}

// Extend the global Window interface
declare global {
  interface Window {
    Razorpay: Razorpay;
  }
}

interface FormData {
  name: string;
  contactNo: string;
  amount: string;
}

export default function Home() {
  const [formData, setFormData] = useState<FormData>({
    name: "",
    contactNo: "",
    amount: "",
  });
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);

  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    document.body.appendChild(script);
    return () => {
      document.body.removeChild(script);
    };
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    if (!formData.name || !formData.contactNo || !formData.amount) {
      setError("All fields are required");
      setIsLoading(false);
      return;
    }
    if (!/^\+?\d{10,15}$/.test(formData.contactNo)) {
      setError("Invalid contact number (e.g., +91xxxxxxxxxx)");
      setIsLoading(false);
      return;
    }
    const amountNum = parseFloat(formData.amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      setError("Invalid amount");
      setIsLoading(false);
      return;
    }

    try {
      const transactionId = uuidv4();
      const response = await fetch("/api/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          amount: amountNum,
          transactionId,
          to_user: "default_user",
        }),
      });

      const data = await response.json();
      if (!data.success) {
        setError(data.message || "Failed to create order");
        setIsLoading(false);
        return;
      }

      const options: RazorpayOptions = {
        key: "rzp_test_LauiieS7mt98Bs",
        amount: amountNum * 100,
        currency: "INR",
        name: "ISKCON Payment Portal",
        description: `Payment by ${formData.name}`,
        order_id: data.orderId,
        handler: function (response: RazorpayResponse) {
          fetch("/api/verify-payment", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
              transactionId,
            }),
          })
            .then((res) => res.json())
            .then((verifyData) => {
              if (verifyData.success) {
                alert("Payment successful! Receipt has been sent to your WhatsApp.");
              } else {
                setError("Payment verification failed: " + verifyData.message);
              }
            })
            .catch((err) => {
              setError("Error verifying payment: " + (err as Error).message);
            });
        },
        prefill: {
          name: formData.name,
          contact: formData.contactNo.replace(/^\+/, ""),
        },
        theme: { color: "#3399cc" },
      };

      const razorpay = new window.Razorpay(options);
      razorpay.open();
    } catch (err: unknown) {
      setError("Error initiating payment: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-100 to-orange-100 flex items-center justify-center p-4">
      <Head>
        <title>ISKCON Payment Portal</title>
      </Head>
      <div className="bg-white p-6 sm:p-8 rounded-xl shadow-xl w-full max-w-md transform transition-all duration-300 hover:shadow-2xl">
        <h1 className="text-3xl font-bold mb-6 text-center text-black">ISKCON Payment Form</h1>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="relative">
            <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
              Name
            </label>
            <UserIcon className="absolute left-3 top-10 h-5 w-5 text-gray-400" />
            <input
              type="text"
              id="name"
              name="name"
              value={formData.name}
              onChange={handleInputChange}
              className="pl-10 mt-1 p-3 w-full border text-black border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition duration-200 placeholder:text-gray-400"
              required
              placeholder="Enter your name"
            />
          </div>
          <div className="relative">
            <label htmlFor="contactNo" className="block text-sm font-medium text-gray-700 mb-1">
              Contact Number (e.g., +91xxxxxxxxxx)
            </label>
            <PhoneIcon className="absolute left-3 top-10 h-5 w-5 text-gray-400" />
            <input
              type="tel"
              id="contactNo"
              name="contactNo"
              value={formData.contactNo}
              onChange={handleInputChange}
              className="pl-10 mt-1 p-3 w-full border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition duration-200 text-black"
              required
              placeholder="Enter your contact number"
            />
          </div>
          <div className="relative">
            <label htmlFor="amount" className="block text-sm font-medium text-gray-700 mb-1">
              Amount (₹)
            </label>
            <CurrencyRupeeIcon className="absolute left-3 top-10 h-5 w-5 text-gray-400" />
            <input
              type="number"
              id="amount"
              name="amount"
              value={formData.amount}
              onChange={handleInputChange}
              className="pl-10 mt-1 p-3 w-full border text-black border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition duration-200 placeholder:text-gray-400"
              required
              min="1"
              step="0.01"
              placeholder="Enter amount"
            />
          </div>
          {error && <p className="text-red-500 text-sm text-center animate-pulse">{error}</p>}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-orange-400 text-white p-3 rounded-lg hover:bg-orange-600 transition duration-300 font-semibold"
          >
            {isLoading ? "Processing..." : "Proceed to Payment"}
          </button>
        </form>
      </div>
    </div>
  );
}