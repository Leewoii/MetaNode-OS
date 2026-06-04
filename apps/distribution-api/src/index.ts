import { createHmac, timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import cors from "@fastify/cors";
import Fastify from "fastify";

type TokenType = "runtime-grant" | "core-download";

interface SignedPayload {
  type: TokenType;
  userId: string;
  ip: string;
  deviceId: string;
  requestId: string;
  exp: number;
  iat: number;
}

interface GithubAsset {
  id: number;
  name: string;
  size: number;
  content_type: string;
  browser_download_url: string;
  url: string;
  updated_at: string;
}

interface GithubRelease {
  tag_name: string;
  name: string;
  published_at: string;
  assets: GithubAsset[];
}

const env = {
  port: Number(process.env.PORT ?? process.env.DISTRIBUTION_PORT ?? 4320),
  host: process.env.DISTRIBUTION_HOST ?? "0.0.0.0",
  githubToken: process.env.GITHUB_TOKEN ?? "",
  githubOwner: process.env.GITHUB_OWNER ?? "",
  githubRepo: process.env.GITHUB_REPO ?? "",
  githubReleaseTag: process.env.GITHUB_RELEASE_TAG ?? "latest",
  gateSecret: process.env.DISTRIBUTION_SHARED_SECRET ?? ""
};

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

app.get("/health", async () => ({ ok: true, name: "metanode-distribution-api" }));

app.get("/v1/core/releases/latest", async (request, reply) => {
  const token = verifyDownloadToken(headerValue(request.headers.authorization));
  if (!token) {
    return reply.code(403).send({ error: "invalid or expired download token" });
  }
  const release = await fetchRelease();
  return {
    tag: release.tag_name,
    name: release.name,
    publishedAt: release.published_at,
    assets: release.assets.map((asset) => ({
      id: String(asset.id),
      name: asset.name,
      size: asset.size,
      contentType: asset.content_type,
      updatedAt: asset.updated_at
    }))
  };
});

app.get("/v1/core/assets/:assetId", async (request, reply) => {
  const token = verifyDownloadToken(headerValue(request.headers.authorization));
  if (!token) {
    return reply.code(403).send({ error: "invalid or expired download token" });
  }
  const params = request.params as { assetId: string };
  const release = await fetchRelease();
  const asset = release.assets.find((item) => String(item.id) === params.assetId || item.name === params.assetId);
  if (!asset) return reply.code(404).send({ error: "asset not found" });
  const assetResponse = await fetch(asset.url, {
    headers: githubHeaders({ accept: "application/octet-stream" }),
    redirect: "follow"
  });
  if (!assetResponse.ok || !assetResponse.body) {
    return reply.code(assetResponse.status).send({ error: "github asset download failed" });
  }
  reply.header("content-type", asset.content_type || "application/octet-stream");
  reply.header("content-disposition", `attachment; filename="${asset.name.replace(/"/g, "")}"`);
  return reply.send(Readable.fromWeb(assetResponse.body as unknown as NodeReadableStream<Uint8Array>));
});

await app.listen({ port: env.port, host: env.host });

async function fetchRelease(): Promise<GithubRelease> {
  if (!env.githubToken || !env.githubOwner || !env.githubRepo) {
    throw new Error("GITHUB_TOKEN, GITHUB_OWNER, and GITHUB_REPO are required");
  }
  const url =
    env.githubReleaseTag === "latest"
      ? `https://api.github.com/repos/${env.githubOwner}/${env.githubRepo}/releases/latest`
      : `https://api.github.com/repos/${env.githubOwner}/${env.githubRepo}/releases/tags/${env.githubReleaseTag}`;
  const res = await fetch(url, { headers: githubHeaders({ accept: "application/vnd.github+json" }) });
  if (!res.ok) throw new Error(`github release lookup failed: ${res.status}`);
  return (await res.json()) as GithubRelease;
}

function githubHeaders(options: { accept: string }) {
  return {
    accept: options.accept,
    authorization: `Bearer ${env.githubToken}`,
    "x-github-api-version": "2022-11-28",
    "user-agent": "metanode-os-distribution-api"
  };
}

function bearer(value: string | undefined): string {
  const header = value ?? "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function verifyDownloadToken(authorization: string | undefined): SignedPayload | null {
  const token = verifySignedPayload(bearer(authorization), env.gateSecret);
  if (!token || token.type !== "core-download" || token.exp < nowSeconds()) {
    return null;
  }
  return token;
}

function verifySignedPayload(token: string, secret: string): SignedPayload | null {
  if (!token || !secret) return null;
  const [encoded, sig] = token.split(".");
  if (!encoded || !sig) return null;
  const expected = createHmac("sha256", secret).update(encoded).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as SignedPayload;
  } catch {
    return null;
  }
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
