export async function fetchMetadataInfo(url: string) {
  try {
    const formattedUrl = url.startsWith("http") ? url : `https://${url}`;

    // If running inside the browser, call our internal serverless endpoint to avoid CORS issues
    if (typeof window !== "undefined") {
      const res = await fetch(`/api/metadata?url=${encodeURIComponent(formattedUrl)}`);
      if (res.ok) {
        return (await res.json()) as {
          title: string;
          description: string;
          image: string;
          favicon: string;
        };
      }
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
      url;

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
      try {
        const urlObj = new URL(formattedUrl);
        image = `${urlObj.origin}${image}`;
      } catch {
        // ignore
      }
    }

    let favicon = "";
    try {
      const urlObj = new URL(formattedUrl);
      favicon = `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=64`;
    } catch {
      favicon = "";
    }

    return {
      title: title.slice(0, 120),
      description: description.slice(0, 250),
      image,
      favicon,
    };
  } catch (error) {
    return {
      title: url,
      description: "",
      image: "",
      favicon: "",
    };
  }
}
