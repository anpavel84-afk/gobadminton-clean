import { venueProfileEditSchema } from "../venues/venue-profile";
import { publicVenueContactsSchema } from "../venues/public-venue-contacts";
import { z } from "zod";
import { uuid, reason } from "./dto";
export const venueFields = z.object({
  cityId: uuid, name: z.string().trim().min(1).max(160), address: z.string().trim().min(1).max(500),
  timezone: z.string().min(1).max(64).refine(v => { try { new Intl.DateTimeFormat("en", {timeZone:v}); return true; } catch { return false; } }),
  latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180),
  identityDiscriminator: z.string().trim().max(80).optional(),
}).strict();
const venueCreateFields = venueFields;
const contactFields = {
  contactPhone: z.string().trim().max(40).optional(),
  contactWebsite: z.string().trim().max(300).refine(v => v === "" || /^https?:\/\//.test(v), "Нужен адрес http:// или https://").optional(),
  bookingNote: z.string().trim().max(500).optional(),
};
const venueEditFields = venueFields.extend({...contactFields, publicContacts: publicVenueContactsSchema.optional(), profile: venueProfileEditSchema.optional()}).strict();
const base = {expectedVersion:z.number().int().positive(),reasonCode:reason};
export const venueCreate = venueCreateFields.extend({reasonCode:reason}).strict();
export const venueCommand = z.discriminatedUnion("action", [
  z.object({...base,action:z.literal("edit"),fields:venueEditFields}).strict(),
  z.object({...base,action:z.enum(["verify","retire","restore"])}).strict(),
  z.object({...base,action:z.literal("merge"),targetId:uuid,expectedTargetVersion:z.number().int().positive()}).strict(),
]);
export const venuePage = z.object({cityId:uuid.optional(),status:z.enum(["unverified","verified","retired","merged"]).optional(),beforeId:uuid.optional(),limit:z.coerce.number().int().min(1).max(50).default(20)}).strict();
export type VenueFields = z.infer<typeof venueFields>;
export type VenueCommand = z.infer<typeof venueCommand>;
