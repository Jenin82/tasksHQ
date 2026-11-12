import type { Metadata } from "next";
import "./globals.css";
import { Inter, JetBrains_Mono } from "next/font/google";
import { APP_URL } from "@/lib/public-urls";
import { cn } from "@/lib/utils";

// design.md's typefaces.
const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

const description = "A task manager for small teams.";
const socialImage = {
  url: "/taskshq-social.png",
  width: 1200,
  height: 630,
  alt: "TasksHQ spelled out in isometric blocks",
};

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: "TasksHQ",
  description,
  icons: { icon: { url: "/favicon.svg", type: "image/svg+xml", sizes: "any" } },
  openGraph: { type: "website", siteName: "TasksHQ", title: "TasksHQ", description, images: [socialImage] },
  twitter: { card: "summary_large_image", title: "TasksHQ", description, images: [socialImage] },
};

// PLAN §7.4: the `.dark` class is set before first paint, or the page flashes
// light. Inline and synchronous on purpose — a deferred script is too late.
// With no stored choice it also follows the OS when that changes mid-session;
// a stored choice is never overridden. Storage is read in its own `try`: if
// it throws (blocked site data), the OS preference and listener still apply.
const themeScript = `(function(){var s=null;try{s=localStorage.getItem("theme")}catch(x){}try{var m=matchMedia("(prefers-color-scheme: dark)");if(s?s==="dark":m.matches)document.documentElement.classList.add("dark");m.addEventListener("change",function(e){var t=null;try{t=localStorage.getItem("theme")}catch(x){}if(!t)document.documentElement.classList.toggle("dark",e.matches)})}catch(e){}})()`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={cn("font-sans", inter.variable, mono.variable)}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
