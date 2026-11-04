-- Jenius's logo is now its own app icon (public/banks/jenius.webp), which fills the badge.
UPDATE banks SET logo = 'jenius.webp' WHERE id = 'jenius' AND logo = 'jenius';
