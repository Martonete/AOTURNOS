import { execSync } from "node:child_process";
import path from "node:path";
import type { NextConfig } from "next";

function resolveBuildId(): string {
    if (process.env.NEXT_BUILD_ID?.trim()) {
        return process.env.NEXT_BUILD_ID.trim();
    }

    try {
        return execSync("git rev-parse --short=12 HEAD", {
            encoding: "utf8",
        }).trim();
    } catch {
        return "development";
    }
}

const buildId = resolveBuildId();

const nextConfig: NextConfig = {
    allowedDevOrigins: ["127.0.0.1", "localhost"],
    env: {
        NEXT_PUBLIC_NEXT_BUILD_ID: buildId,
    },
    generateBuildId: async () => buildId,
    // game-core vive en ../packages y se enlaza con pnpm: la raíz tiene que incluirlo.
    outputFileTracingRoot: path.join(__dirname, ".."),
    turbopack: {
        root: path.join(__dirname, ".."),
    },
    transpilePackages: ["@aoturnos/game-core"],
};

export default nextConfig;
