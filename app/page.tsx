"use client"
import { useState, useEffect } from "react";
import Head from "next/head";
import { v4 as uuidv4 } from "uuid";

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

      const options = {
        key: "rzp_test_LauiieS7mt98Bs",
        amount: amountNum * 100,
        currency: "INR",
        name: "ISKCON Payment Portal",
        description: `Payment by ${formData.name}`,
        order_id: data.orderId,
        handler: function (response: any) {
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
              setError("Error verifying payment: " + err.message);
            });
        },
        prefill: {
          name: formData.name,
          contact: formData.contactNo.replace(/^\+/, ""),
        },
        theme: { color: "#3399cc" },
      };

      const razorpay = new (window as any).Razorpay(options);
      razorpay.open();
    } catch (err: any) {
      setError("Error initiating payment: " + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center">
      <Head>
        <title>ISKCON Payment Portal</title>
      </Head>
      <div className="bg-white p-8 rounded-lg shadow-lg w-full max-w-md">
        <h1 className="text-2xl font-bold mb-6 text-center">ISKCON Payment Form</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700">
              Name
            </label>
            <input
              type="text"
              id="name"
              name="name"
              value={formData.name}
              onChange={handleInputChange}
              className="mt-1 p-2 w-full border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>
          <div>
            <label htmlFor="contactNo" className="block text-sm font-medium text-gray-700">
              Contact Number (e.g., +91xxxxxxxxxx)
            </label>
            <input
              type="tel"
              id="contactNo"
              name="contactNo"
              value={formData.contactNo}
              onChange={handleInputChange}
              className="mt-1 p-2 w-full border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>
          <div>
            <label htmlFor="amount" className="block text-sm font-medium text-gray-700">
              Amount (₹)
            </label>
            <input
              type="number"
              id="amount"
              name="amount"
              value={formData.amount}
              onChange={handleInputChange}
              className="mt-1 p-2 w-full border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
              min="1"
              step="0.01"
            />
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-blue-500 text-white p-2 rounded-md hover:bg-blue-600 disabled:bg-blue-300"
          >
            {isLoading ? "Processing..." : "Proceed to Payment"}
          </button>
        </form>
      </div>
    </div>
  );
}