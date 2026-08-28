import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Authorized Load Tester",
  description:
    "Authorized web load / DDoS-simulation testing platform for infrastructure you own or are explicitly authorized to test.",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
