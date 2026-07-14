import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const targetUrl = searchParams.get("url");

  if (!targetUrl) {
    return NextResponse.json({ error: "URL parameter is required" }, { status: 400 });
  }

  try {
    const formattedUrl = targetUrl.startsWith("http") ? targetUrl : `https://${targetUrl}`;
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
