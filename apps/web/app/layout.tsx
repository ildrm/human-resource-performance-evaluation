import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Human Performance Intelligence",
  description: "Explainable, role-specific performance reviews",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
