-- Контакты площадки: nullable-поля совместимы с прежними API-образами.
ALTER TABLE venues
 ADD COLUMN contact_phone text CHECK (char_length(contact_phone) <= 40),
 ADD COLUMN contact_website text CHECK (char_length(contact_website) <= 300 AND contact_website ~ '^https?://'),
 ADD COLUMN booking_note text CHECK (char_length(booking_note) <= 500),
 ADD COLUMN contact_updated_at timestamptz;
