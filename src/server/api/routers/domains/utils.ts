export interface CloudflareCustomHostnameResponse {
  success: boolean;
  errors: { code: number; message: string }[];
  messages: { code: number; message: string }[];
  result: {
    id: string;
    hostname: string;
    ssl: {
      id: string;
      type: string;
      method: string;
      status: string;
    };
    status: string;
    verification_errors?: string[];
    ownership_verification?: {
      type: string;
      name: string;
      value: string;
    };
    created_at: string;
  };
}

export async function addDomainToCloudflare(domain: string) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${process.env.CLOUDFLARE_ZONE_ID}/custom_hostnames`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        hostname: domain,
        ssl: {
          method: "txt",
          type: "dv",
        },
      }),
    },
  );

  const data = (await response.json()) as CloudflareCustomHostnameResponse;

  if (!data.success) {
    const errorMsg = data.errors?.[0]?.message || "Failed to add domain to Cloudflare";
    if (errorMsg.includes("already exists")) {
      return { alreadyExists: true as const, result: data.result };
    }
    throw new Error(errorMsg);
  }

  return {
    alreadyExists: false as const,
    result: data.result,
  };
}

export async function getCustomHostnameFromCloudflare(hostname: string) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${process.env.CLOUDFLARE_ZONE_ID}/custom_hostnames?hostname=${hostname}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
    },
  );

  const data = (await response.json()) as { success: boolean; result: CloudflareCustomHostnameResponse["result"][] };

  if (!data.success || !data.result || data.result.length === 0) {
    return null;
  }

  return data.result[0];
}

export async function deleteCustomHostnameFromCloudflare(hostnameId: string) {
  await fetch(
    `https://api.cloudflare.com/client/v4/zones/${process.env.CLOUDFLARE_ZONE_ID}/custom_hostnames/${hostnameId}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
    },
  );
}

