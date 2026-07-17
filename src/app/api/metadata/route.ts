import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const targetUrl = searchParams.get("url");

  if (!targetUrl) {
    return NextResponse.json({ error: "URL parameter is required" }, { status: 400 });
  }

  try {
    const formattedUrl = targetUrl.startsWith("http") ? targetUrl : `https://${targetUrl}`;
    
    // SSRF and Phishing Protection
    const parsed = new URL(formattedUrl);
    const hostname = parsed.hostname;
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      hostname.match(/^(127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2[0-9]|3[0-1])\.\d+\.\d+|169\.254\.\d+\.\d+)$/) ||
      hostname === "[::1]" ||
      hostname === "0.0.0.0" ||
      hostname.includes("::") // block IPv6 completely for metadata fetch to prevent IPv6 loopback variants
    ) {
      return NextResponse.json({ error: "Invalid or restricted URL" }, { status: 400 });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(formattedUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ClickPathBot/1.0; +https://clickpath.analytai.in)",
      },
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const html = await response.text();

    const getMatch = (regex: RegExp) => {
      const match = regex.exec(html);
      return match?.[1]?.trim() ?? "";
    };

    const title =
      getMatch(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ||
      getMatch(/<meta[^>]*name=["']twitter:title["'][^>]*content=["']([^"']+)["']/i) ||
      getMatch(/<title[^>]*>([^<]+)<\/title>/i) ||
      targetUrl;

    const description =
      getMatch(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i) ||
      getMatch(/<meta[^>]*name=["']twitter:description["'][^>]*content=["']([^"']+)["']/i) ||
      getMatch(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i) ||
      "";

    let image =
      getMatch(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ||
      getMatch(/<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i) ||
      "";

    if (image && image.startsWith("/")) {
      const urlObj = new URL(formattedUrl);
      image = `${urlObj.origin}${image}`;
    }

    const urlObj = new URL(formattedUrl);
    const favicon = `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=64`;

    return NextResponse.json({
      title: title.slice(0, 120),
      description: description.slice(0, 250),
      image,
      favicon,
    });
  } catch (error) {
    return NextResponse.json({
      title: targetUrl,
      description: "",
      image: "",
      favicon: "",
    });
  }
}
