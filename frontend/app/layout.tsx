import type { Metadata } from "next";
import { Cinzel, Geist, Geist_Mono, IM_Fell_English } from "next/font/google";
import AppChrome from "@/components/AppChrome";
import {
    buildPageMetadata,
    siteDescription,
    siteTitle,
    siteUrl,
} from "@/lib/seo";
import "./globals.css";

const geistSans = Geist({
    variable: "--font-geist-sans",
    subsets: ["latin"],
});

const geistMono = Geist_Mono({
    variable: "--font-geist-mono",
    subsets: ["latin"],
});

/** Tipografías del HUD de combate: títulos grabados y crónica manuscrita. */
const cinzel = Cinzel({
    variable: "--font-cinzel",
    subsets: ["latin"],
    weight: ["500", "700", "900"],
});

const fell = IM_Fell_English({
    variable: "--font-fell",
    subsets: ["latin"],
    weight: "400",
    style: ["normal", "italic"],
});

export const metadata: Metadata = {
    ...buildPageMetadata({
        title: siteTitle,
        description: siteDescription,
        path: "/",
        imagePath: "/opengraph-image",
        twitterImagePath: "/twitter-image",
    }),
    metadataBase: new URL(siteUrl),
    applicationName: "AOWeb",
    title: {
        default: siteTitle,
        template: "%s | AOWeb",
    },
    description: siteDescription,
    authors: [{ name: "Damian Catanzaro" }],
    creator: "Damian Catanzaro",
    publisher: "AOWeb",
    category: "games",
    formatDetection: {
        email: false,
        address: false,
        telephone: false,
    },
    icons: {
        icon: "/favicon.ico",
        shortcut: "/favicon.ico",
        apple: "/static/imgs/logo-aoweb.png",
    },
    manifest: "/manifest.webmanifest",
    robots: {
        index: true,
        follow: true,
        googleBot: {
            index: true,
            follow: true,
            "max-image-preview": "large",
            "max-snippet": -1,
            "max-video-preview": -1,
        },
    },
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="es-AR">
            <body
                className={`${geistSans.variable} ${geistMono.variable} ${cinzel.variable} ${fell.variable} antialiased`}
            >
                <AppChrome>{children}</AppChrome>
            </body>
        </html>
    );
}
