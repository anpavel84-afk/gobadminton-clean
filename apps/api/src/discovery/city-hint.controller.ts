import type { DiscoveryCityHint } from "@gobadminton/contracts/game-types";
import { Controller, Get, Header } from "@nestjs/common";
import { DISCOVERY_CITY_IDS } from "../profiles/discovery-preferences.service";

@Controller("discovery")
export class CityHintController {
  @Get("city-hint")
  @Header("Cache-Control", "private, no-store")
  getCityHint(): DiscoveryCityHint {
    // No trusted ingress/local GeoIP is admitted or configured. Do not inspect
    // peer IP, forwarded headers, caller coordinates or account preferences.
    return { cityId: DISCOVERY_CITY_IDS[0], source: "default" };
  }
}
