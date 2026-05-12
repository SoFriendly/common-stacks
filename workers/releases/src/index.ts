export interface Env {
  BUCKET: R2Bucket;
}

interface Latest {
  version: string;
  platforms: Record<string, { url: string; signature: string }>;
}

const APP = "CommonStacks";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const key = url.pathname.slice(1);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Access-Control-Allow-Headers": "*",
        },
      });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    if (!key) {
      return new Response(`${APP} Releases`, {
        headers: { "Content-Type": "text/plain" },
      });
    }

    // Stable "latest" download URLs that redirect to the current version's artifact.
    // Pattern: commonstacks-latest[-arm64|-amd64].<ext>
    const latestMatch = key.match(
      /^commonstacks-latest(?:-(arm64|amd64))?\.(dmg|AppImage|deb|msi|exe)$/,
    );
    if (latestMatch) {
      try {
        const latestObj = await env.BUCKET.get("latest.json");
        if (!latestObj) return new Response("No latest.json", { status: 404 });
        const latest = await latestObj.json<Latest>();

        const arch = latestMatch[1];
        const ext = latestMatch[2];
        const archSuffix = arch === "arm64" ? "arm64" : "amd64";

        const platformForExt: Record<string, string> = {
          dmg: "darwin-aarch64",
          AppImage: `linux-${arch === "arm64" ? "aarch64" : "x86_64"}`,
          deb: `linux-${arch === "arm64" ? "aarch64" : "x86_64"}`,
          msi: "windows-x86_64",
          exe: "windows-x86_64",
        };

        const extractVersion = (platformKey: string): string | null => {
          const platformUrl = latest.platforms[platformKey]?.url;
          if (!platformUrl) return null;
          const m = platformUrl.match(new RegExp(`${APP}_([\\d.]+)`));
          return m ? m[1] : null;
        };

        const platformKey = platformForExt[ext];
        const version = (platformKey && extractVersion(platformKey)) || latest.version;

        const fileMap: Record<string, string> = {
          dmg: `v${version}/${APP}_${version}_universal.dmg`,
          AppImage: `v${version}/${APP}_${version}_${archSuffix}.AppImage`,
          deb: `v${version}/${APP}_${version}_${archSuffix}.deb`,
          msi: `v${version}/${APP}_${version}_x64-setup.msi`,
          exe: `v${version}/${APP}_${version}_x64-setup.exe`,
        };

        const target = fileMap[ext];
        if (target) return Response.redirect(`${url.origin}/${target}`, 302);
      } catch (e) {
        return new Response(`Could not determine latest version: ${e}`, { status: 500 });
      }
    }

    try {
      const object = await env.BUCKET.get(key);
      if (!object) return new Response("Not Found", { status: 404 });

      const headers = new Headers();
      headers.set("Access-Control-Allow-Origin", "*");
      headers.set("etag", object.httpEtag);

      if (key.endsWith(".json")) headers.set("Content-Type", "application/json");
      else if (key.endsWith(".dmg")) headers.set("Content-Type", "application/x-apple-diskimage");
      else if (key.endsWith(".exe") || key.endsWith(".msi"))
        headers.set("Content-Type", "application/octet-stream");
      else if (key.endsWith(".AppImage")) headers.set("Content-Type", "application/x-executable");
      else if (key.endsWith(".deb")) headers.set("Content-Type", "application/vnd.debian.binary-package");
      else if (key.endsWith(".tar.gz")) headers.set("Content-Type", "application/gzip");
      else if (key.endsWith(".sig")) headers.set("Content-Type", "text/plain");

      if (!key.endsWith(".json") && !key.endsWith(".sig")) {
        const filename = key.split("/").pop();
        if (filename) headers.set("Content-Disposition", `attachment; filename="${filename}"`);
      }
      if (object.size) headers.set("Content-Length", object.size.toString());

      return new Response(object.body, { headers });
    } catch {
      return new Response("Internal Error", { status: 500 });
    }
  },
};
