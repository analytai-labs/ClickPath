import { UAParser } from "ua-parser-js";

import { env } from "@/env.mjs";
import { LOCAL_DEVELOPMENT_GEOLOCATION_DATA } from "@/lib/constants/app";
import { resolveDeviceType } from "@/lib/utils/device-type";

import type { GeolocationAPIResponseType } from "./types";

const getGeolocationDetailsFromAPI = async (ip: string) => {
  const geolocationApiUrl = `https://api.findip.net/ipHere/?token=${env.GEOLOCATION_API_KEY}`;
  const response = await fetch(geolocationApiUrl.replace("ipHere", ip));
  const data = (await response.json()) as GeolocationAPIResponseType;

  return {
    city: data.city.names.en,
    country: data.country.names.en,
    continent: data.continent.names.en,
  };
};

const getGeolocationDetails = async (ip: string) => {
  const geolocationDetails = process.env.VERCEL
    ? await getGeolocationDetailsFromAPI(ip)
    : LOCAL_DEVELOPMENT_GEOLOCATION_DATA;

  return {
    city: geolocationDetails?.city ?? "Unknown",
    country: geolocationDetails?.country ?? "Unknown",
    continent: geolocationDetails.continent ?? "Unknown",
  };
};

const identifyRequestingDevice = async (headers: Headers) => {
  const userAgent = headers.get("user-agent") ?? "";

  const result = await UAParser(userAgent, headers).withClientHints();

  const osName = result.os.name ?? "Unknown";

  return {
    browser: result.browser.name ?? "Unknown",
    os: osName,
    device: resolveDeviceType(osName, result.device.type),
    model: result.device.model ?? "Unknown",
  };
};

const getUserIP = (headers: Headers) => {
  const xForwardedFor = headers.get("x-forwarded-for");
  const realIp = headers.get("x-real-ip");

  if (xForwardedFor) {
    return xForwardedFor.split(",")[0]?.trim();
  }

  return realIp?.trim() ?? "127.0.0.1";
};

export const retrieveDeviceAndGeolocationData = async (headers: Headers) => {
  const [deviceDetails, geolocationDetails] = await Promise.all([
    identifyRequestingDevice(headers),
    getGeolocationDetails(getUserIP(headers)!),
  ]);

  return {
    ...deviceDetails,
    ...geolocationDetails,
  };
};

function safeIncrement<T extends string>(record: Record<T, number>, key: T): void {
  record[key] = (record[key] || 0) + 1;
}

/**
 * One recorded visit, as far as aggregation is concerned.
 *
 * Structural on purpose: a `LinkVisit` and a `TemplatePageView` record the same
 * dimensions, so both flow through this reducer and the dashboards for links and
 * template pages can't drift apart. `verifiedAt` is link-only, hence optional.
 */
export type AggregatableVisit = {
  createdAt: Date | string | null;
  country?: string | null;
  city?: string | null;
  continent?: string | null;
  device?: string | null;
  os?: string | null;
  browser?: string | null;
  model?: string | null;
  verifiedAt?: Date | string | null;
};

export type AggregatableUniqueVisit = {
  createdAt: Date | string | null;
};

export const aggregateVisits = (
  visits: readonly AggregatableVisit[],
  uniqueVisits: readonly AggregatableUniqueVisit[] | undefined | null,
) => {
  const clicksPerDate: Record<string, number> = {};
  const uniqueClicksPerDate: Record<string, number> = {};
  const verifiedClicksPerDate: Record<string, number> = {};
  const clicksPerCountry: Record<string, number> = {};
  const clicksPerCity: Record<string, number> = {};
  const clicksPerContinent: Record<string, number> = {};
  const clicksPerDevice: Record<string, number> = {};
  const clicksPerOS: Record<string, number> = {};
  const clicksPerBrowser: Record<string, number> = {};
  const clicksPerModel: Record<string, number> = {};
  let totalClicks = 0;
  let verifiedClicks = 0;

  // biome-ignore lint/complexity/noForEach: <explanation>
  visits.forEach((visit) => {
    const date = new Date(visit.createdAt!).toISOString().split("T")[0];
    safeIncrement(clicksPerDate, date!);
    totalClicks += 1;

    if (visit.verifiedAt) {
      verifiedClicks += 1;
      safeIncrement(verifiedClicksPerDate, date!);
    }

    if (visit.country) safeIncrement(clicksPerCountry, visit.country);
    if (visit.city) safeIncrement(clicksPerCity, visit.city);
    if (visit.continent) safeIncrement(clicksPerContinent, visit.continent);
    if (visit.device) safeIncrement(clicksPerDevice, visit.device);
    if (visit.os) safeIncrement(clicksPerOS, visit.os);
    if (visit.browser) safeIncrement(clicksPerBrowser, visit.browser);
    if (visit.model) safeIncrement(clicksPerModel, visit.model);
  });

  if (!uniqueVisits)
    return {
      totalClicks,
      verifiedClicks,
      clicksPerDate,
      verifiedClicksPerDate,
      clicksPerCountry,
      clicksPerCity,
      clicksPerContinent,
      clicksPerDevice,
      clicksPerOS,
      clicksPerBrowser,
      clicksPerModel,
    };

  // biome-ignore lint/complexity/noForEach: <explanation>
  uniqueVisits.forEach((uniqueVisit) => {
    const date = new Date(uniqueVisit.createdAt!).toISOString().split("T")[0];
    safeIncrement(uniqueClicksPerDate, date!);
  });

  return {
    totalClicks,
    verifiedClicks,
    clicksPerDate,
    uniqueClicksPerDate,
    verifiedClicksPerDate,
    clicksPerCountry,
    clicksPerCity,
    clicksPerContinent,
    clicksPerDevice,
    clicksPerOS,
    clicksPerBrowser,
    clicksPerModel,
  };
};
